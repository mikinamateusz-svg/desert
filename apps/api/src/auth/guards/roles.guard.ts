import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole, User } from '@prisma/client';
import { FastifyRequest } from 'fastify';
import { ROLES_KEY } from '../decorators/roles.decorator.js';

type AuthenticatedRequest = FastifyRequest & {
  currentUser: User;
};

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No @Roles() decorator → allow any authenticated user through
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!req.currentUser) throw new ForbiddenException();
    return requiredRoles.includes(req.currentUser.role);
  }
}
