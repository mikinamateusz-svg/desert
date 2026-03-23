import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { User } from '@prisma/client';

type AuthenticatedRequest = FastifyRequest & {
  currentUser: User;
  sessionHandle: string;
};

export const CurrentUser = createParamDecorator(
  (key: string | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (key === 'sessionHandle') return req.sessionHandle;
    if (key) return req.currentUser?.[key as keyof User];
    return req.currentUser;
  },
);
