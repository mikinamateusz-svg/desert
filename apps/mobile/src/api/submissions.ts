import type { QueueRow } from '../services/queueDb';

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

export class PermanentUploadError extends Error {
  constructor(public readonly statusCode: number) {
    super(`Permanent upload failure: ${statusCode}`);
    this.name = 'PermanentUploadError';
  }
}

/**
 * Upload a queued photo to the server.
 * Returns normally on 202. Throws PermanentUploadError on 400/401/403.
 * Throws a generic Error on 5xx or network failure (caller retries).
 *
 * Story 3.3 implements the server endpoint — until then this will throw
 * a network error and the queue processor retries with exponential backoff.
 */
export async function uploadSubmission(
  accessToken: string,
  entry: QueueRow,
): Promise<void> {
  const formData = new FormData();
  // React Native's FormData accepts { uri, type, name } for file parts
  formData.append('photo', {
    uri: entry.photo_uri,
    type: 'image/jpeg',
    name: 'photo.jpg',
  } as unknown as Blob);
  formData.append('fuel_type', entry.fuel_type);
  if (entry.manual_price != null) formData.append('manual_price', String(entry.manual_price));
  if (entry.preselected_station_id) formData.append('preselected_station_id', entry.preselected_station_id);
  if (entry.gps_lat != null) formData.append('gps_lat', String(entry.gps_lat));
  if (entry.gps_lng != null) formData.append('gps_lng', String(entry.gps_lng));
  formData.append('captured_at', entry.captured_at);

  // Do NOT set Content-Type — let fetch set multipart/form-data with boundary automatically
  const res = await fetch(`${API_BASE}/v1/submissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formData,
  });

  if (res.status === 202) return;

  if (res.status === 400 || res.status === 401 || res.status === 403) {
    throw new PermanentUploadError(res.status);
  }

  throw new Error(`Upload failed: ${res.status}`);
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
