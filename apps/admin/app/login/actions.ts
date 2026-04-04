'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const COOKIE_NAME = 'admin_token';
const COOKIE_MAX_AGE = 60 * 60 * 8; // 8 hours

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

  const body = (await res.json()) as { accessToken?: string; user?: { role?: string } };

  if (!body.accessToken) {
    return { error: 'generic' };
  }

  if (body.user?.role !== 'ADMIN') {
    return { error: 'notAdmin' };
  }

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, body.accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });

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
  }

  redirect('/login');
}
