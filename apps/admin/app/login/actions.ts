'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const COOKIE_NAME = 'admin_token';
const REFRESH_COOKIE_NAME = 'admin_refresh_token';
const COOKIE_MAX_AGE = 60 * 60 * 8;        // 8 h — access token window
const REFRESH_MAX_AGE = 60 * 60 * 24 * 30; // 30 days — refresh token window

export async function loginAction(formData: FormData): Promise<{ error: string } | never> {
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      cache: 'no-store',
    });
  } catch {
    return { error: 'generic' };
  }

  if (res.status === 401 || res.status === 400) {
    return { error: 'invalid' };
  }

  if (!res.ok) {
    return { error: 'generic' };
  }

  const body = (await res.json()) as { accessToken?: string; refreshToken?: string; user?: { role?: string } };

  if (!body.accessToken) {
    return { error: 'generic' };
  }

  if (body.user?.role !== 'ADMIN') {
    return { error: 'notAdmin' };
  }

  const cookieOpts = (maxAge: number) => ({
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
    maxAge,
  });

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, body.accessToken, cookieOpts(COOKIE_MAX_AGE));
  if (body.refreshToken) {
    cookieStore.set(REFRESH_COOKIE_NAME, body.refreshToken, cookieOpts(REFRESH_MAX_AGE));
  }

  redirect('/submissions');
}

export async function logoutAction(): Promise<never> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;

  if (token) {
    // Best-effort session revocation — fire and forget
    fetch(`${API_URL}/v1/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    }).catch(() => undefined);

    cookieStore.delete(COOKIE_NAME);
    cookieStore.delete(REFRESH_COOKIE_NAME);
  }

  redirect('/login');
}
