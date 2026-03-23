const API_BASE = process.env['EXPO_PUBLIC_API_URL'] ?? 'http://localhost:3000';

export interface AuthUser {
  id: string;
  email: string | null;
  display_name: string | null;
  role: string;
}

export interface AuthResponse {
  user: AuthUser;
  accessToken: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly error: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  path: string,
  options: RequestInit,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  const body = await res.json() as Record<string, unknown>;

  if (!res.ok) {
    const message =
      typeof body['message'] === 'string' ? body['message'] : 'An error occurred';
    const errorCode =
      typeof body['error'] === 'string' ? body['error'] : 'UNKNOWN_ERROR';
    throw new ApiError(message, res.status, errorCode);
  }

  return body as T;
}

export async function apiRegister(
  email: string,
  password: string,
  displayName: string,
): Promise<AuthResponse> {
  return request<AuthResponse>('/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, displayName }),
  });
}

export async function apiLogin(
  email: string,
  password: string,
): Promise<AuthResponse> {
  return request<AuthResponse>('/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function apiLogout(accessToken: string): Promise<void> {
  await request<void>('/v1/auth/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function apiGetMe(accessToken: string): Promise<AuthUser> {
  return request<AuthUser>('/v1/auth/me', {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function apiGoogleSignIn(idToken: string): Promise<AuthResponse> {
  return request<AuthResponse>('/v1/auth/google', {
    method: 'POST',
    body: JSON.stringify({ idToken }),
  });
}

export async function apiAppleSignIn(
  identityToken: string,
  fullName?: { givenName?: string | null; familyName?: string | null } | null,
): Promise<AuthResponse> {
  return request<AuthResponse>('/v1/auth/apple', {
    method: 'POST',
    body: JSON.stringify({ identityToken, fullName }),
  });
}
