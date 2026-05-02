const API_BASE = process.env['EXPO_PUBLIC_API_URL'] ?? 'http://localhost:3000';

export type FillupFuelType = 'PB_95' | 'PB_98' | 'ON' | 'ON_PREMIUM' | 'LPG';

export interface FillupOcrResult {
  totalCostPln: number | null;
  litres: number | null;
  pricePerLitrePln: number | null;
  fuelTypeSuggestion: FillupFuelType | null;
  /** 0 → caller must fall back to manual entry. */
  confidence: number;
}

export interface FillUp {
  id: string;
  user_id: string;
  vehicle_id: string;
  station_id: string | null;
  fuel_type: FillupFuelType;
  litres: number;
  total_cost_pln: number;
  price_per_litre_pln: number;
  area_avg_at_fillup: number | null;
  odometer_km: number | null;
  filled_at: string;
  created_at: string;
}

export interface CreateFillupPayload {
  vehicleId: string;
  fuelType: FillupFuelType;
  litres: number;
  totalCostPln: number;
  pricePerLitrePln: number;
  gpsLat?: number;
  gpsLng?: number;
  odometerKm?: number;
  filledAt?: string;
}

export interface CreateFillupResponse {
  fillUp: FillUp;
  stationMatched: boolean;
  stationName: string | null;
  communityUpdated: boolean;
  /**
   * Pre-computed savings vs area average (Story 5.3). null when the server
   * couldn't resolve a benchmark for this fill-up's voivodeship × fuel_type.
   * Mobile renders nothing for null per AC2.
   */
  savingsPln: number | null;
}

export interface ListFillupsResponse {
  data: FillUp[];
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
  // Same Content-Type-when-body-present rule as admin-api.ts and vehicles.ts.
  // No DELETE callers in this client today, but a future "delete a fill-up"
  // endpoint would otherwise hit the same Fastify 400.
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

/**
 * Synchronous pump-meter OCR. Server uses Claude Haiku with a 10s wall-clock
 * cap and never throws — even on timeout / parse failure / API error the
 * response is `{ confidence: 0, ...nulls }`. Caller routes the user to manual
 * entry whenever confidence < 0.6 OR any required value is null.
 *
 * Endpoint accepts multipart/form-data with a single `photo` field; do NOT
 * set Content-Type — fetch derives the multipart boundary automatically.
 */
export async function apiRunFillupOcr(
  accessToken: string,
  photoUri: string,
): Promise<FillupOcrResult> {
  const formData = new FormData();
  // React Native's FormData accepts { uri, type, name } for file parts.
  formData.append('photo', {
    uri: photoUri,
    type: 'image/jpeg',
    name: 'pump-meter.jpg',
  } as unknown as Blob);

  const res = await fetch(`${API_BASE}/v1/me/fillups/ocr`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(`OCR upload failed (${res.status})`, res.status, text || 'OCR_FAILED');
  }

  return (await res.json()) as FillupOcrResult;
}

export async function apiCreateFillup(
  accessToken: string,
  payload: CreateFillupPayload,
): Promise<CreateFillupResponse> {
  return request<CreateFillupResponse>('/v1/me/fillups', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
}

export async function apiListFillups(
  accessToken: string,
  vehicleId?: string,
  page = 1,
  limit = 20,
): Promise<ListFillupsResponse> {
  const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (vehicleId) qs.set('vehicleId', vehicleId);
  return request<ListFillupsResponse>(`/v1/me/fillups?${qs.toString()}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}
