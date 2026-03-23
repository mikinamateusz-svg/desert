const API_BASE = process.env['EXPO_PUBLIC_API_URL'] ?? 'http://localhost:3000';

export interface PriceEntry {
  fuel_type: string;
  price_per_litre: number;
}

export interface Submission {
  id: string;
  station: { id: string; name: string } | null;
  price_data: PriceEntry[];
  status: 'pending' | 'verified' | 'rejected';
  created_at: string;
}

export interface SubmissionsResponse {
  data: Submission[];
  total: number;
  page: number;
  limit: number;
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
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  const body = (await res.json()) as Record<string, unknown>;

  if (!res.ok) {
    const message =
      typeof body['message'] === 'string' ? body['message'] : 'An error occurred';
    const errorCode =
      typeof body['error'] === 'string' ? body['error'] : 'UNKNOWN_ERROR';
    throw new ApiError(message, res.status, errorCode);
  }

  return body as T;
}

export async function apiGetSubmissions(
  accessToken: string,
  page = 1,
  limit = 20,
): Promise<SubmissionsResponse> {
  return request<SubmissionsResponse>(`/v1/submissions?page=${page}&limit=${limit}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}
