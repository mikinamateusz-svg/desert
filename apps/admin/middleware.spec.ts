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

function makeRequest(pathname: string, opts: { token?: string } = {}): NextRequest {
  const url = `https://admin.example.com${pathname}`;
  const req = new NextRequest(url);
  if (opts.token) {
    req.cookies.set('admin_token', opts.token);
  }
  return req;
}

describe('admin middleware', () => {
  const validAdminToken = makeJwt({
    role: 'ADMIN',
    exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
  });

  it('passes through requests to /login (public path)', () => {
    const res = middleware(makeRequest('/login'));
    // NextResponse.next() returns a response with no Location header
    expect(res.headers.get('Location')).toBeNull();
  });

  it('redirects to /login when no admin_token cookie is present on a protected path', () => {
    const res = middleware(makeRequest('/submissions'));
    expect(res.status).toBe(307);
    expect(res.headers.get('Location')).toContain('/login');
  });

  it('passes through requests with a valid ADMIN admin_token cookie', () => {
    const res = middleware(makeRequest('/submissions', { token: validAdminToken }));
    expect(res.headers.get('Location')).toBeNull();
  });

  it('redirects to /login when admin_token is malformed (not a JWT)', () => {
    const res = middleware(makeRequest('/submissions', { token: 'not-a-jwt' }));
    expect(res.status).toBe(307);
    expect(res.headers.get('Location')).toContain('/login');
  });

  it('redirects to /login when admin_token has expired', () => {
    const expired = makeJwt({
      role: 'ADMIN',
      exp: Math.floor(Date.now() / 1000) - 60, // 1 min ago
    });
    const res = middleware(makeRequest('/submissions', { token: expired }));
    expect(res.status).toBe(307);
    expect(res.headers.get('Location')).toContain('/login');
  });

  it('redirects to /login when admin_token has a non-ADMIN role (e.g., DRIVER)', () => {
    const driverToken = makeJwt({
      role: 'DRIVER',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const res = middleware(makeRequest('/submissions', { token: driverToken }));
    expect(res.status).toBe(307);
    expect(res.headers.get('Location')).toContain('/login');
  });
});
