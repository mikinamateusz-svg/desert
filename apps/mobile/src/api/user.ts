const API_BASE = process.env['EXPO_PUBLIC_API_URL'] ?? 'http://localhost:3000';

class ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly error: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, options: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  if (res.status === 204) return undefined as unknown as T;
  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const message = typeof body['message'] === 'string' ? body['message'] : 'An error occurred';
    const errorCode = typeof body['error'] === 'string' ? body['error'] : 'UNKNOWN_ERROR';
    throw new ApiError(message, res.status, errorCode);
  }
  return body as T;
}

export async function apiDeleteAccount(accessToken: string): Promise<void> {
  await request<void>('/v1/me', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function apiRequestDataExport(accessToken: string): Promise<{ message: string }> {
  return request<{ message: string }>('/v1/me/export', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export type ConsentRecord = {
  id: string;
  type: string;
  consented_at: string;
  withdrawn_at: string | null;
};

export async function apiGetConsents(accessToken: string): Promise<ConsentRecord[]> {
  return request<ConsentRecord[]>('/v1/me/consents', {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function apiWithdrawConsent(
  accessToken: string,
  type: string,
): Promise<void> {
  await request<void>(`/v1/me/consents/${type}/withdraw`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function apiSubmitFeedback(
  accessToken: string,
  payload: { message: string; app_version: string; os: string },
): Promise<{ message: string }> {
  return request<{ message: string }>('/v1/feedback', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
}
