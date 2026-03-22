import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { FastifyRequest } from 'fastify';

type AuthenticatedRequest = FastifyRequest & {
  currentUser: Record<string, unknown>;
  sessionHandle: string;
};

export const CurrentUser = createParamDecorator(
  (key: string | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (key === 'sessionHandle') return req.sessionHandle;
    if (key) return req.currentUser?.[key];
    return req.currentUser;
  },
);
