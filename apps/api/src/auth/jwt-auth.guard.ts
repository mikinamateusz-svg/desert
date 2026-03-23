import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import Session from 'supertokens-node/recipe/session/index.js';
import { FastifyRequest } from 'fastify';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  async canActivate(context: ExecutionContext): Promise<boolean> {
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

      (req as FastifyRequest & { currentUser: Record<string, unknown>; sessionHandle: string }).currentUser =
        sessionInfo.customClaimsInAccessTokenPayload as Record<string, unknown>;
      (req as FastifyRequest & { currentUser: Record<string, unknown>; sessionHandle: string }).sessionHandle =
        sessionInfo.sessionHandle;

      return true;
    } catch (err) {
      if (!(err instanceof UnauthorizedException)) {
        this.logger.error('JwtAuthGuard unexpected error', err);
      }
      throw new UnauthorizedException();
    }
  }
}
