import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_PATHS = new Set(['/login']);
const ACCESS_COOKIE = 'admin_token';
const REFRESH_COOKIE = 'admin_refresh_token';
const ACCESS_MAX_AGE = 60 * 60 * 8;        // 8 h — matches login action
const REFRESH_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

// Prefer internal API_URL (server-side only) so Vercel→Railway traffic
// stays on the internal network; fall back to the public URL.
const API_URL =
  process.env.API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:3001';

interface AdminTokenClaims {
  role?: string;
  exp?: number;
}

/**
 * Decodes the JWT payload without signature verification.
 * Security is enforced by the API guards on every API call.
 * This is purely a UX redirect gate.
 */
function decodeJwtPayload(token: string): AdminTokenClaims | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(payload);
    return JSON.parse(decoded) as AdminTokenClaims;
  } catch {
    return null;
  }
}

function cookieOpts(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
    maxAge,
  };
}

function clearAndRedirect(req: NextRequest): NextResponse {
  const res = NextResponse.redirect(new URL('/login', req.url));
  res.cookies.delete(ACCESS_COOKIE);
  res.cookies.delete(REFRESH_COOKIE);
  return res;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  const token = req.cookies.get(ACCESS_COOKIE)?.value;

  if (!token) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  const claims = decodeJwtPayload(token);

  if (!claims || claims.role !== 'ADMIN') {
    return clearAndRedirect(req);
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (claims.exp && claims.exp < nowSec) {
    // Access token expired — try silent refresh before forcing re-login
    const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value;
    if (!refreshToken) return clearAndRedirect(req);

    try {
      const refreshRes = await fetch(`${API_URL}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!refreshRes.ok) return clearAndRedirect(req);

      const body = (await refreshRes.json()) as {
        accessToken?: string;
        refreshToken?: string;
      };
      if (!body.accessToken) return clearAndRedirect(req);

      const newClaims = decodeJwtPayload(body.accessToken);
      if (!newClaims || newClaims.role !== 'ADMIN') return clearAndRedirect(req);

      const response = NextResponse.next();
      response.cookies.set(ACCESS_COOKIE, body.accessToken, cookieOpts(ACCESS_MAX_AGE));
      if (body.refreshToken) {
        response.cookies.set(REFRESH_COOKIE, body.refreshToken, cookieOpts(REFRESH_MAX_AGE));
      }
      return response;
    } catch {
      return clearAndRedirect(req);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
