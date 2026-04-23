import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import Session from 'supertokens-node/recipe/session/index.js';
import { FastifyRequest } from 'fastify';
import { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { IS_PUBLIC_KEY } from './decorators/public.decorator.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Skip auth for routes decorated with @Public()
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const authHeader = req.headers['authorization'];

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException();
    }

    const token = authHeader.substring(7);

    try {
      const sessionObj =
        await Session.getSessionWithoutRequestResponse(token);
      const sessionInfo = await Session.getSessionInformation(
        sessionObj.getHandle(),
      );

      if (!sessionInfo) {
        throw new UnauthorizedException();
      }

      const claims = sessionInfo.customClaimsInAccessTokenPayload as Record<string, unknown>;
      const userId = claims['userId'] as string | undefined;
      if (!userId) {
        throw new UnauthorizedException();
      }

      // Load full User record from DB (AC5)
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        throw new UnauthorizedException();
      }
      if (user.deleted_at) {
        throw new UnauthorizedException();
      }

      (req as FastifyRequest & { currentUser: User; sessionHandle: string }).currentUser = user;
      (req as FastifyRequest & { currentUser: User; sessionHandle: string }).sessionHandle =
        sessionInfo.sessionHandle;

      return true;
    } catch (err) {
      // Preserve UnauthorizedException thrown from inside the try block (bad
      // header, missing user, deleted_at set) — those are terminal 401s.
      if (err instanceof UnauthorizedException) {
        throw err;
      }

      // SuperTokens SessionError carries a `type` field: 'TRY_REFRESH_TOKEN'
      // means the access token is expired but the session is still valid and
      // the client should call POST /v1/auth/refresh and retry. We surface
      // that marker in the 401 response body so the mobile client's
      // `is401RefreshSignal` (submissions.ts) detects it and drives the
      // refresh-and-retry path in the upload queue. Without this, every
      // expired-access-token 401 looked like a permanent auth failure and
      // queued uploads silently died. (Story 3.11 follow-up.)
      const stType = (err as { type?: string } | null | undefined)?.type;
      if (stType === 'TRY_REFRESH_TOKEN') {
        throw new UnauthorizedException({
          statusCode: 401,
          message: 'Access token expired — refresh required',
          type: 'TRY_REFRESH_TOKEN',
        });
      }

      this.logger.error('JwtAuthGuard unexpected error', err);
      throw new UnauthorizedException();
    }
  }
}
