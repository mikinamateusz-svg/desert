import { cookies } from 'next/headers';

const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export class PartnerApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'PartnerApiError';
  }
}

/**
 * Server-side API helper for the partner portal. Mirrors apps/admin's
 * adminFetch — same cookie-based token attach + same Content-Type rule
 * (Fastify rejects empty-body POST/PATCH if Content-Type is set, so
 * only attach the header when there's actually a body).
 *
 * Token cookie is `partner_token` (not `admin_token`) so the two
 * portals don't collide if a user happens to have accounts in both.
 */
export async function partnerFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const cookieStore = await cookies();
  const token = cookieStore.get('partner_token')?.value ?? '';

  const hasBody = options?.body !== undefined && options.body !== null;

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...(options?.headers ?? {}),
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new PartnerApiError(res.status, `API ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

/**
 * Public version of partnerFetch — no auth header. Used for the pre-
 * login claim-search page that hits the public station search endpoint.
 */
export async function partnerFetchPublic<T>(path: string, options?: RequestInit): Promise<T> {
  const hasBody = options?.body !== undefined && options.body !== null;
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...(options?.headers ?? {}),
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new PartnerApiError(res.status, `API ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}
