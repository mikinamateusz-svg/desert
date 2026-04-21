import {
  Injectable,
  ConflictException,
  Logger,
  UnauthorizedException,
  InternalServerErrorException,
} from '@nestjs/common';
import { OAuth2Client, type LoginTicket } from 'google-auth-library';
import appleSignin from 'apple-signin-auth';
import ThirdParty from 'supertokens-node/recipe/thirdparty/index.js';
import EmailPassword from 'supertokens-node/recipe/emailpassword/index.js';
import Session from 'supertokens-node/recipe/session/index.js';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { UserService } from '../user/user.service.js';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly googleClient = new OAuth2Client();

  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
  ) {}

  async register(email: string, password: string, displayName: string) {
    const result = await EmailPassword.signUp('public', email, password);

    if (result.status !== 'OK') {
      if (result.status === 'EMAIL_ALREADY_EXISTS_ERROR') {
        throw new ConflictException({
          statusCode: 409,
          error: 'EMAIL_ALREADY_EXISTS',
          message: 'Email already registered',
        });
      }
      throw new Error('SuperTokens signUp failed');
    }

    const { user: stUser, recipeUserId } = result;

    const user = await this.prisma.user.create({
      data: {
        supertokens_id: stUser.id,
        email,
        display_name: displayName,
        role: 'DRIVER',
      },
    });

    // Consent creation — best effort (non-fatal if it fails)
    try {
      await this.userService.createCoreServiceConsent(user.id);
    } catch (err) {
      this.logger.warn(`Failed to create consent for user ${user.id}: ${err}`);
    }

    const session = await Session.createNewSessionWithoutRequestResponse(
      'public',
      recipeUserId,
      { userId: user.id, role: user.role },
    );

    const { id, email: userEmail, display_name, role } = user;
    const tokens = session.getAllSessionTokensDangerously();
    return {
      user: { id, email: userEmail, display_name, role },
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? null,
    };
  }

  async login(email: string, password: string) {
    const result = await EmailPassword.signIn('public', email, password);

    if (result.status !== 'OK') {
      if (result.status === 'WRONG_CREDENTIALS_ERROR') {
        throw new UnauthorizedException({
          statusCode: 401,
          error: 'WRONG_CREDENTIALS',
          message: 'Invalid email or password',
        });
      }
      throw new Error('SuperTokens signIn failed');
    }

    const { user: stUser, recipeUserId } = result;

    const user = await this.prisma.user.findUnique({
      where: { supertokens_id: stUser.id },
    });
    if (!user) {
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'WRONG_CREDENTIALS',
        message: 'Invalid email or password',
      });
    }

    const session = await Session.createNewSessionWithoutRequestResponse(
      'public',
      recipeUserId,
      { userId: user.id, role: user.role },
    );

    const { id, email: safeEmail, display_name, role } = user;
    const tokens = session.getAllSessionTokensDangerously();
    return {
      user: { id, email: safeEmail, display_name, role },
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? null,
    };
  }

  async logout(sessionHandle: string) {
    await Session.revokeSession(sessionHandle);
  }

  async googleSignIn(idToken: string) {
    // 1. Verify Google ID token
    const audience = [
      process.env['GOOGLE_WEB_CLIENT_ID'],
      process.env['GOOGLE_ANDROID_CLIENT_ID'],
      process.env['GOOGLE_IOS_CLIENT_ID'],
    ].filter(Boolean) as string[];

    if (audience.length === 0) {
      throw new InternalServerErrorException('No Google client IDs configured');
    }

    let ticket: LoginTicket;
    try {
      ticket = await this.googleClient.verifyIdToken({ idToken, audience });
    } catch {
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'INVALID_GOOGLE_TOKEN',
        message: 'Invalid Google ID token',
      });
    }

    const payload = ticket.getPayload();
    if (!payload) {
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'INVALID_GOOGLE_TOKEN',
        message: 'Invalid Google ID token',
      });
    }

    if (!payload.email) {
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'GOOGLE_EMAIL_MISSING',
        message: 'Google account has no email address',
      });
    }

    // 2. Create or find SuperTokens ThirdParty user
    const result = await ThirdParty.manuallyCreateOrUpdateUser(
      'public',
      'google',
      payload.sub,
      payload.email,
      payload.email_verified ?? false,
      undefined,
      {},
    );

    if (result.status === 'SIGN_IN_UP_NOT_ALLOWED') {
      throw new ConflictException({
        statusCode: 409,
        error: 'SOCIAL_EMAIL_CONFLICT',
        message: result.reason,
      });
    }

    if (result.status !== 'OK') {
      throw new Error(`SuperTokens ThirdParty signInUp failed: ${result.status}`);
    }

    const { user: stUser, recipeUserId, createdNewRecipeUser } = result;

    // 3. Find or create our User record
    let user;
    if (createdNewRecipeUser) {
      try {
        user = await this.prisma.user.create({
          data: {
            supertokens_id: stUser.id,
            email: payload.email,
            display_name: payload.name ?? null,
            role: 'DRIVER',
          },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          // Concurrent sign-in already created the record
          user = await this.prisma.user.findUniqueOrThrow({
            where: { supertokens_id: stUser.id },
          });
        } else {
          throw e;
        }
      }

      // Consent creation — best effort (non-fatal if it fails)
      try {
        await this.userService.createCoreServiceConsent(user.id);
      } catch (err) {
        this.logger.warn(`Failed to create consent for user ${user.id}: ${err}`);
      }
    } else {
      const found = await this.prisma.user.findUnique({
        where: { supertokens_id: stUser.id },
      });
      if (!found) {
        throw new UnauthorizedException({
          statusCode: 401,
          error: 'INVALID_GOOGLE_TOKEN',
          message: 'User record not found',
        });
      }
      user = found;
    }

    // 4. Create SuperTokens session
    const session = await Session.createNewSessionWithoutRequestResponse(
      'public',
      recipeUserId,
      { userId: user.id, role: user.role },
    );

    const { id, email: safeEmail, display_name, role } = user;
    const tokens = session.getAllSessionTokensDangerously();
    return {
      user: { id, email: safeEmail, display_name, role },
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? null,
    };
  }

  async appleSignIn(
    identityToken: string,
    fullName?: { givenName?: string | null; familyName?: string | null } | null,
  ) {
    // 1. Verify Apple identity token
    const appleBundleId = process.env['APPLE_APP_BUNDLE_ID'];
    if (!appleBundleId) {
      throw new InternalServerErrorException('APPLE_APP_BUNDLE_ID is not configured');
    }

    let applePayload: { sub: string; email?: string };
    try {
      applePayload = (await appleSignin.verifyIdToken(identityToken, {
        audience: appleBundleId,
        ignoreExpiration: false,
      })) as { sub: string; email?: string };
    } catch {
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'INVALID_APPLE_TOKEN',
        message: 'Invalid Apple identity token',
      });
    }

    if (!applePayload.email) {
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'APPLE_EMAIL_MISSING',
        message: 'Apple account has no email address',
      });
    }

    // 2. Create or find SuperTokens ThirdParty user
    const result = await ThirdParty.manuallyCreateOrUpdateUser(
      'public',
      'apple',
      applePayload.sub,
      applePayload.email,
      true, // Apple emails are pre-verified
      undefined,
      {},
    );

    if (result.status === 'SIGN_IN_UP_NOT_ALLOWED') {
      throw new ConflictException({
        statusCode: 409,
        error: 'SOCIAL_EMAIL_CONFLICT',
        message: result.reason,
      });
    }

    if (result.status !== 'OK') {
      throw new Error(`SuperTokens Apple signInUp failed: ${result.status}`);
    }

    const { user: stUser, recipeUserId, createdNewRecipeUser } = result;

    // 3. Find or create our User record
    let user;
    if (createdNewRecipeUser) {
      // First sign-in only — fullName will be null on all subsequent sign-ins
      const displayName =
        [fullName?.givenName, fullName?.familyName].filter(Boolean).join(' ') ||
        null;

      try {
        user = await this.prisma.user.create({
          data: {
            supertokens_id: stUser.id,
            email: applePayload.email,
            display_name: displayName,
            role: 'DRIVER',
          },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          // Concurrent sign-in already created the record
          user = await this.prisma.user.findUniqueOrThrow({
            where: { supertokens_id: stUser.id },
          });
        } else {
          throw e;
        }
      }

      // Consent creation — best effort (non-fatal if it fails)
      try {
        await this.userService.createCoreServiceConsent(user.id);
      } catch (err) {
        this.logger.warn(`Failed to create consent for user ${user.id}: ${err}`);
      }
    } else {
      const found = await this.prisma.user.findUnique({
        where: { supertokens_id: stUser.id },
      });
      if (!found) {
        throw new UnauthorizedException({
          statusCode: 401,
          error: 'INVALID_APPLE_TOKEN',
          message: 'User record not found',
        });
      }
      user = found;
    }

    // 4. Create SuperTokens session
    const session = await Session.createNewSessionWithoutRequestResponse(
      'public',
      recipeUserId,
      { userId: user.id, role: user.role },
    );

    const { id, email: safeEmail, display_name, role } = user;
    const tokens = session.getAllSessionTokensDangerously();
    return {
      user: { id, email: safeEmail, display_name, role },
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? null,
    };
  }

  /**
   * Exchange a refresh token for a fresh access token. Also rotates the refresh
   * token per SuperTokens best practice. Throws 401 if the refresh token is
   * invalid/expired — client must force re-login.
   */
  async refreshSession(refreshToken: string) {
    try {
      const session = await Session.refreshSessionWithoutRequestResponse(
        refreshToken,
        true, // disableAntiCsrf — we use Bearer tokens on mobile, no CSRF surface
      );
      const tokens = session.getAllSessionTokensDangerously();
      return {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken ?? refreshToken,
      };
    } catch (err) {
      this.logger.warn(`refreshSession failed: ${err instanceof Error ? err.message : String(err)}`);
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'REFRESH_TOKEN_INVALID',
        message: 'Refresh token is invalid or expired — please sign in again',
      });
    }
  }
}
