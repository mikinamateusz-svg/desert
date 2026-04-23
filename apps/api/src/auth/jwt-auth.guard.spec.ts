import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard.js';

// ── SuperTokens mock ──────────────────────────────────────────────────────────

const mockGetSessionWithoutRequestResponse = jest.fn();
const mockGetSessionInformation = jest.fn();

jest.mock('supertokens-node/recipe/session/index.js', () => ({
  __esModule: true,
  default: {
    getSessionWithoutRequestResponse: (...args: unknown[]) =>
      mockGetSessionWithoutRequestResponse(...args),
    getSessionInformation: (...args: unknown[]) =>
      mockGetSessionInformation(...args),
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

const mockPrisma = {
  user: { findUnique: jest.fn() },
};

function makeCtx(authHeader: string | undefined): ExecutionContext {
  const req = { headers: authHeader !== undefined ? { authorization: authHeader } : {} };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: Reflector;

  beforeEach(() => {
    jest.clearAllMocks();
    reflector = new Reflector();
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    guard = new JwtAuthGuard(mockPrisma as any, reflector);
    // Silence the unexpected-error logger during tests.
    jest.spyOn(guard['logger'], 'error').mockImplementation(() => undefined);
  });

  it('throws UnauthorizedException when Authorization header is missing', async () => {
    await expect(guard.canActivate(makeCtx(undefined))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('throws UnauthorizedException when Authorization header is not Bearer', async () => {
    await expect(guard.canActivate(makeCtx('Basic abc123'))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('surfaces TRY_REFRESH_TOKEN in the 401 body when access token is expired', async () => {
    // Reproduces the exact SuperTokens SessionError shape seen in Railway logs:
    // { type: 'TRY_REFRESH_TOKEN', fromRecipe: 'session', errMagic: '...' }
    mockGetSessionWithoutRequestResponse.mockRejectedValueOnce({
      type: 'TRY_REFRESH_TOKEN',
      fromRecipe: 'session',
      errMagic: 'ndskajfasndlfkj435234krjdsa',
    });

    await expect(
      guard.canActivate(makeCtx('Bearer stale-access-token')),
    ).rejects.toMatchObject({
      status: 401,
      response: expect.objectContaining({
        type: 'TRY_REFRESH_TOKEN',
        statusCode: 401,
      }),
    });
  });

  it('does NOT surface TRY_REFRESH_TOKEN for unknown SuperTokens errors', async () => {
    // Generic session failure (e.g. TOKEN_THEFT_DETECTED or UNAUTHORISED) — the
    // client should re-login, not try to refresh. Body must not leak the
    // TRY_REFRESH_TOKEN marker.
    mockGetSessionWithoutRequestResponse.mockRejectedValueOnce({
      type: 'UNAUTHORISED',
      fromRecipe: 'session',
    });

    await expect(
      guard.canActivate(makeCtx('Bearer truly-invalid')),
    ).rejects.toMatchObject({ status: 401 });

    // Build an exception to read its body shape and assert it's the plain form
    try {
      await guard.canActivate(makeCtx('Bearer truly-invalid'));
    } catch (e) {
      const body = (e as UnauthorizedException).getResponse();
      const bodyText = typeof body === 'string' ? body : JSON.stringify(body);
      expect(bodyText).not.toMatch(/TRY_REFRESH_TOKEN/i);
    }
  });

  it('throws plain UnauthorizedException when user is soft-deleted', async () => {
    mockGetSessionWithoutRequestResponse.mockResolvedValueOnce({
      getHandle: () => 'sess-handle',
    });
    mockGetSessionInformation.mockResolvedValueOnce({
      sessionHandle: 'sess-handle',
      customClaimsInAccessTokenPayload: { userId: 'user-1' },
    });
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: 'user-1',
      deleted_at: new Date(),
    });

    await expect(
      guard.canActivate(makeCtx('Bearer valid')),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('returns true for a valid session with a healthy user', async () => {
    mockGetSessionWithoutRequestResponse.mockResolvedValueOnce({
      getHandle: () => 'sess-handle',
    });
    mockGetSessionInformation.mockResolvedValueOnce({
      sessionHandle: 'sess-handle',
      customClaimsInAccessTokenPayload: { userId: 'user-1' },
    });
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: 'user-1',
      deleted_at: null,
    });

    await expect(guard.canActivate(makeCtx('Bearer valid'))).resolves.toBe(true);
  });
});
