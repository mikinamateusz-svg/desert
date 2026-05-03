'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const COOKIE_NAME = 'partner_token';
const REFRESH_COOKIE_NAME = 'partner_refresh_token';
const COOKIE_MAX_AGE = 60 * 60 * 8;
const REFRESH_MAX_AGE = 60 * 60 * 24 * 30;

export async function registerAction(
  formData: FormData,
): Promise<{ error: string } | never> {
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
  const displayName = formData.get('displayName') as string;

  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, displayName }),
      cache: 'no-store',
    });
  } catch {
    return { error: 'generic' };
  }

  // The API surfaces conflicts as 409 (email-already-exists). DTO
  // validation failures (weak password, malformed email) come back as 400.
  if (res.status === 409) return { error: 'emailExists' };
  if (res.status === 400) return { error: 'weakPassword' };
  if (!res.ok) return { error: 'generic' };

  const body = (await res.json()) as { accessToken?: string; refreshToken?: string };
  if (!body.accessToken) return { error: 'generic' };

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

  // Land newly-registered partners on the claim search — first thing
  // they want to do after signing up is find their station.
  redirect('/claim');
}
