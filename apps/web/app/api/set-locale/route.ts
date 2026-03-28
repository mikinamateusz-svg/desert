import { NextRequest, NextResponse } from 'next/server';

export function GET(request: NextRequest) {
  const locale = request.nextUrl.searchParams.get('l');
  if (locale !== 'pl' && locale !== 'en' && locale !== 'uk') {
    return NextResponse.json({ error: 'Invalid locale' }, { status: 400 });
  }
  const referer = request.headers.get('referer');
  let redirectTo = '/';
  if (referer) {
    try {
      const refUrl = new URL(referer);
      if (refUrl.origin === request.nextUrl.origin) {
        redirectTo = refUrl.pathname + refUrl.search;
      }
    } catch {
      // malformed referer — fall back to '/'
    }
  }
  const response = NextResponse.redirect(new URL(redirectTo, request.nextUrl.origin));
  response.cookies.set('locale', locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });
  return response;
}
