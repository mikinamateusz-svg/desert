import { cookies } from 'next/headers';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

export class AdminApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AdminApiError';
  }
}

export async function adminFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value ?? '';

  // Only declare application/json when we are actually sending a body.
  // Fastify rejects POST/PATCH with `Content-Type: application/json` and an
  // empty body (status 400, "Body cannot be empty when content-type is set to
  // 'application/json'") — this used to silently break the no-body actions
  // (hide / unhide / refresh-cache) until the HideButton was wired to surface
  // errors.
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
    throw new AdminApiError(res.status, `API ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}
