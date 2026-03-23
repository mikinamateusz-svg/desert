const API_BASE = process.env['EXPO_PUBLIC_API_URL'] ?? 'http://localhost:3000';

export interface NotificationPreferences {
  id: string;
  user_id: string;
  price_drops: boolean;
  sharp_rise: boolean;
  monthly_summary: boolean;
}

export interface UpdateNotificationPreferencesPayload {
  expo_push_token?: string | null;
  price_drops?: boolean;
  sharp_rise?: boolean;
  monthly_summary?: boolean;
}

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
  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const message = typeof body['message'] === 'string' ? body['message'] : 'An error occurred';
    const errorCode = typeof body['error'] === 'string' ? body['error'] : 'UNKNOWN_ERROR';
    throw new ApiError(message, res.status, errorCode);
  }
  return body as T;
}

export async function apiGetNotificationPreferences(
  accessToken: string,
): Promise<NotificationPreferences> {
  return request<NotificationPreferences>('/v1/me/notifications', {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function apiUpdateNotificationPreferences(
  accessToken: string,
  payload: UpdateNotificationPreferencesPayload,
): Promise<NotificationPreferences> {
  return request<NotificationPreferences>('/v1/me/notifications', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
}
