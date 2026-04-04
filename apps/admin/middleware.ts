import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_PATHS = ['/login'];

interface AdminTokenClaims {
  role?: string;
  exp?: number;
}

/**
 * Decodes the JWT payload without signature verification.
 * Actual security is enforced by the API guards on every API call.
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

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = req.cookies.get('admin_token')?.value;

  if (!token) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  const claims = decodeJwtPayload(token);

  if (!claims) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (claims.exp && claims.exp < nowSec) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  if (claims.role !== 'ADMIN') {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
