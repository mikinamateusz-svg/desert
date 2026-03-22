import {
  Injectable,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import EmailPassword from 'supertokens-node/recipe/emailpassword/index.js';
import Session from 'supertokens-node/recipe/session/index.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AuthService {
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
}
