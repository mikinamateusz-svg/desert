import type { FuelType } from '@desert/types';

const API_BASE = process.env['EXPO_PUBLIC_API_URL'] ?? 'http://localhost:3001';

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

export type StationPriceDto = {
  stationId: string;
  prices: Partial<Record<FuelType, number>>;
  updatedAt: string;
};

export async function apiGetNearbyPrices(
  accessToken: string,
  lat: number,
  lng: number,
  radiusMeters?: number,
  signal?: AbortSignal,
): Promise<StationPriceDto[]> {
  const params = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    ...(radiusMeters !== undefined ? { radius: String(radiusMeters) } : {}),
  });
  return request<StationPriceDto[]>(`/v1/prices/nearby?${params.toString()}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
    signal,
  });
}
