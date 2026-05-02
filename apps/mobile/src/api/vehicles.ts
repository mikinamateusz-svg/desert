import type { VehicleFuelType } from '@desert/types';

const API_BASE = process.env['EXPO_PUBLIC_API_URL'] ?? 'http://localhost:3000';

export interface Vehicle {
  id: string;
  user_id: string;
  make: string;
  model: string;
  year: number;
  engine_variant: string | null;
  displacement_cc: number | null;
  power_kw: number | null;
  fuel_type: VehicleFuelType;
  nickname: string | null;
  is_locked: boolean;
  user_entered: boolean;
  created_at: string;
}

export interface CreateVehiclePayload {
  make: string;
  model: string;
  year: number;
  engine_variant?: string;
  displacement_cc?: number;
  power_kw?: number;
  fuel_type: VehicleFuelType;
  nickname?: string;
  user_entered?: boolean;
}

export type UpdateVehiclePayload = Partial<CreateVehiclePayload>;

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
  // Only declare application/json when we actually send a body. Fastify
  // rejects POST/PATCH/DELETE requests with `Content-Type: application/json`
  // and an empty body (status 400, "Body cannot be empty when content-type
  // is set to 'application/json'") — this used to silently break the
  // no-body DELETE /v1/me/vehicles/:id endpoint until the alert was wired
  // to surface real errors. Same fix applied to admin-api.ts.
  const hasBody = options.body !== undefined && options.body !== null;
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
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

export async function apiListVehicles(accessToken: string): Promise<Vehicle[]> {
  return request<Vehicle[]>('/v1/me/vehicles', {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function apiGetVehicle(accessToken: string, id: string): Promise<Vehicle> {
  return request<Vehicle>(`/v1/me/vehicles/${id}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function apiCreateVehicle(
  accessToken: string,
  payload: CreateVehiclePayload,
): Promise<Vehicle> {
  return request<Vehicle>('/v1/me/vehicles', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
}

export async function apiUpdateVehicle(
  accessToken: string,
  id: string,
  payload: UpdateVehiclePayload,
): Promise<Vehicle> {
  return request<Vehicle>(`/v1/me/vehicles/${id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
}

export async function apiDeleteVehicle(accessToken: string, id: string): Promise<void> {
  await request<void>(`/v1/me/vehicles/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}
