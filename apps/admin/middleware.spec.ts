/**
 * Tests for the admin auth middleware. The middleware is the first line of
 * UX defense — actual security is enforced by API guards on every call, but
 * a broken middleware would leak protected pages to unauthenticated users.
 *
 * Note: NextRequest / NextResponse are constructible in Node 22 (no jsdom
 * needed). NextResponse.redirect returns a Response with `Location` header
 * and status 307; we assert on those.
 */
import { NextRequest } from 'next/server';
import { middleware } from './middleware';

function makeJwt(payload: Record<string, unknown>): string {
  const b64 = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.signature`;
}

function makeRequest(
  pathname: string,
  opts: { token?: string; refreshToken?: string } = {},
): NextRequest {
  const url = `https://admin.example.com${pathname}`;
  const req = new NextRequest(url);
  if (opts.token) req.cookies.set('admin_token', opts.token);
  if (opts.refreshToken) req.cookies.set('admin_refresh_token', opts.refreshToken);
  return req;
}

describe('admin middleware', () => {
  const validAdminToken = makeJwt({
    role: 'ADMIN',
    exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
  });

  it('passes through requests to /login (public path)', async () => {
    const res = await middleware(makeRequest('/login'));
    expect(res.headers.get('Location')).toBeNull();
  });

  it('redirects to /login when no admin_token cookie is present on a protected path', async () => {
    const res = await middleware(makeRequest('/submissions'));
    expect(res.status).toBe(307);
    expect(res.headers.get('Location')).toContain('/login');
  });

  it('passes through requests with a valid ADMIN admin_token cookie', async () => {
    const res = await middleware(makeRequest('/submissions', { token: validAdminToken }));
    expect(res.headers.get('Location')).toBeNull();
  });

  it('redirects to /login when admin_token is malformed (not a JWT)', async () => {
    const res = await middleware(makeRequest('/submissions', { token: 'not-a-jwt' }));
    expect(res.status).toBe(307);
    expect(res.headers.get('Location')).toContain('/login');
  });

  it('redirects to /login when admin_token has expired and no refresh token is present', async () => {
    const expired = makeJwt({
      role: 'ADMIN',
      exp: Math.floor(Date.now() / 1000) - 60,
    });
    const res = await middleware(makeRequest('/submissions', { token: expired }));
    expect(res.status).toBe(307);
    expect(res.headers.get('Location')).toContain('/login');
  });

  it('silently refreshes and passes through when access token is expired but refresh token is valid', async () => {
    const expired = makeJwt({ role: 'ADMIN', exp: Math.floor(Date.now() / 1000) - 60 });
    const newAccess = makeJwt({ role: 'ADMIN', exp: Math.floor(Date.now() / 1000) + 3600 });

    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ accessToken: newAccess, refreshToken: 'new-refresh' }),
    } as Response);

    const res = await middleware(
      makeRequest('/submissions', { token: expired, refreshToken: 'old-refresh' }),
    );
    expect(res.headers.get('Location')).toBeNull();
    expect(res.cookies.get('admin_token')?.value).toBe(newAccess);
  });

  it('redirects to /login when refresh API call fails', async () => {
    const expired = makeJwt({ role: 'ADMIN', exp: Math.floor(Date.now() / 1000) - 60 });

    global.fetch = jest.fn().mockResolvedValueOnce({ ok: false } as Response);

    const res = await middleware(
      makeRequest('/submissions', { token: expired, refreshToken: 'old-refresh' }),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get('Location')).toContain('/login');
  });

  it('redirects to /login when admin_token has a non-ADMIN role (e.g., DRIVER)', async () => {
    const driverToken = makeJwt({
      role: 'DRIVER',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const res = await middleware(makeRequest('/submissions', { token: driverToken }));
    expect(res.status).toBe(307);
    expect(res.headers.get('Location')).toContain('/login');
  });
});
