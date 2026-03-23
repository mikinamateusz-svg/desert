import {
  Injectable,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { OAuth2Client, type LoginTicket } from 'google-auth-library';
import appleSignin from 'apple-signin-auth';
import ThirdParty from 'supertokens-node/recipe/thirdparty/index.js';
import EmailPassword from 'supertokens-node/recipe/emailpassword/index.js';
import Session from 'supertokens-node/recipe/session/index.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AuthService {
  private readonly googleClient = new OAuth2Client();

  constructor(private readonly prisma: PrismaService) {}

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

    const session = await Session.createNewSessionWithoutRequestResponse(
      'public',
      recipeUserId,
      { userId: user.id, role: user.role },
    );

    return { user, accessToken: session.getAccessToken() };
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

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { supertokens_id: stUser.id },
    });

    const session = await Session.createNewSessionWithoutRequestResponse(
      'public',
      recipeUserId,
      { userId: user.id, role: user.role },
    );

    return { user, accessToken: session.getAccessToken() };
  }

  async logout(sessionHandle: string) {
    await Session.revokeSession(sessionHandle);
  }

  async getMe(userId: string) {
    return this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
  }

  async googleSignIn(idToken: string) {
    // 1. Verify Google ID token
    let ticket: LoginTicket;
    try {
      ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: [
          process.env['GOOGLE_WEB_CLIENT_ID'],
          process.env['GOOGLE_ANDROID_CLIENT_ID'],
          process.env['GOOGLE_IOS_CLIENT_ID'],
        ].filter(Boolean) as string[],
      });
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
      user = await this.prisma.user.create({
        data: {
          supertokens_id: stUser.id,
          email: payload.email,
          display_name: payload.name ?? null,
          role: 'DRIVER',
        },
      });
    } else {
      user = await this.prisma.user.findUniqueOrThrow({
        where: { supertokens_id: stUser.id },
      });
    }

    // 4. Create SuperTokens session
    const session = await Session.createNewSessionWithoutRequestResponse(
      'public',
      recipeUserId,
      { userId: user.id, role: user.role },
    );

    return { user, accessToken: session.getAccessToken() };
  }

  async appleSignIn(
    identityToken: string,
    fullName?: { givenName?: string | null; familyName?: string | null } | null,
  ) {
    // 1. Verify Apple identity token
    let applePayload: { sub: string; email?: string };
    try {
      applePayload = (await appleSignin.verifyIdToken(identityToken, {
        audience: process.env['APPLE_APP_BUNDLE_ID'] ?? 'com.desert.app',
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

      user = await this.prisma.user.create({
        data: {
          supertokens_id: stUser.id,
          email: applePayload.email,
          display_name: displayName,
          role: 'DRIVER',
        },
      });
    } else {
      user = await this.prisma.user.findUniqueOrThrow({
        where: { supertokens_id: stUser.id },
      });
    }

    // 4. Create SuperTokens session
    const session = await Session.createNewSessionWithoutRequestResponse(
      'public',
      recipeUserId,
      { userId: user.id, role: user.role },
    );

    return { user, accessToken: session.getAccessToken() };
  }
}
