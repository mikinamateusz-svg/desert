import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { RolesGuard } from './roles.guard.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';

function makeContext(role: UserRole | null, handlerRoles?: UserRole[]): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({
        currentUser: role !== null ? { role } : undefined,
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: jest.Mocked<Reflector>;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    } as unknown as jest.Mocked<Reflector>;
    guard = new RolesGuard(reflector);
  });

  it('should allow access when no @Roles() decorator is set', () => {
    reflector.getAllAndOverride.mockReturnValueOnce(undefined);
    const ctx = makeContext(UserRole.DRIVER);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should allow access when @Roles() is an empty array', () => {
    reflector.getAllAndOverride.mockReturnValueOnce([]);
    const ctx = makeContext(UserRole.DRIVER);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should deny access when user role is not in @Roles()', () => {
    reflector.getAllAndOverride.mockReturnValueOnce([UserRole.ADMIN]);
    const ctx = makeContext(UserRole.DRIVER);
    expect(guard.canActivate(ctx)).toBe(false);
  });

  it('should allow access when user role matches @Roles()', () => {
    reflector.getAllAndOverride.mockReturnValueOnce([UserRole.ADMIN]);
    const ctx = makeContext(UserRole.ADMIN);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should allow access when user role matches one of multiple @Roles()', () => {
    reflector.getAllAndOverride.mockReturnValueOnce([UserRole.DRIVER, UserRole.ADMIN]);
    const ctx = makeContext(UserRole.DRIVER);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should deny access when user role is not in a multi-role @Roles()', () => {
    reflector.getAllAndOverride.mockReturnValueOnce([UserRole.ADMIN, UserRole.FLEET_MANAGER]);
    const ctx = makeContext(UserRole.DRIVER);
    expect(guard.canActivate(ctx)).toBe(false);
  });

  it('should throw ForbiddenException when @Roles() is set but currentUser is undefined', () => {
    reflector.getAllAndOverride.mockReturnValueOnce([UserRole.ADMIN]);
    const ctx = makeContext(null);
    expect(() => guard.canActivate(ctx)).toThrow();
  });

  it('should verify reflector is called with correct key', () => {
    reflector.getAllAndOverride.mockReturnValueOnce(undefined);
    const ctx = makeContext(UserRole.DRIVER);
    guard.canActivate(ctx);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(ROLES_KEY, expect.any(Array));
  });
});
