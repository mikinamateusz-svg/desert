const API_BASE = process.env['EXPO_PUBLIC_API_URL'] ?? 'http://localhost:3000';

export interface OdometerOcrResult {
  km: number | null;
  /** 0 → caller must fall back to manual entry. */
  confidence: number;
}

export interface OdometerReading {
  id: string;
  user_id: string;
  vehicle_id: string;
  fillup_id: string | null;
  km: number;
  recorded_at: string;
  created_at: string;
}

/**
 * Returned only when the just-saved reading had a previous reading on the
 * same vehicle (i.e. not the baseline). Baseline reads return
 * `consumption: null` on `CreateOdometerResponse` and skip this object.
 * So `kmDelta` is always populated; the consumption / litres pair is null
 * only when no fill-ups fell in the segment between the two readings.
 */
export interface ConsumptionResult {
  /** Null when no fill-ups in segment. */
  consumptionL100km: number | null;
  kmDelta: number;
  /** Null when no fill-ups in segment. */
  litresInSegment: number | null;
}

export interface CreateOdometerPayload {
  vehicleId: string;
  km: number;
  fillupId?: string;
  recordedAt?: string;
}

export interface CreateOdometerResponse {
  reading: OdometerReading;
  consumption: ConsumptionResult | null;
}

export interface ListOdometerResponse {
  data: OdometerReading[];
  total: number;
  page: number;
  limit: number;
}

class ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly error: string,
    public readonly previousKm?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, options: RequestInit): Promise<T> {
  // Same Content-Type-only-when-body-present rule the rest of the mobile
  // clients use — Fastify rejects an empty-body request that declares
  // application/json with a 400. No DELETE caller in this client today
  // but the rule keeps future additions safe.
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
    // 422 NEGATIVE_DELTA carries previousKm so the UI can render the
    // targeted "must be greater than {{previous}}" copy. Anything else
    // gets the generic message.
    const previousKm = typeof body['previousKm'] === 'number' ? body['previousKm'] : undefined;
    throw new ApiError(message, res.status, errorCode, previousKm);
  }
  return body as T;
}

/**
 * Synchronous odometer OCR. Server uses Gemini Flash with a 10s wall-clock
 * cap and the always-200 contract — even on timeout / parse failure the
 * response is `{ km: null, confidence: 0 }`, so the caller always falls
 * back to manual entry on a low/zero confidence reply.
 *
 * Endpoint accepts multipart/form-data with a single `photo` field; do NOT
 * set Content-Type — fetch derives the multipart boundary automatically.
 */
export async function apiRunOdometerOcr(
  accessToken: string,
  photoUri: string,
): Promise<OdometerOcrResult> {
  const formData = new FormData();
  formData.append('photo', {
    uri: photoUri,
    type: 'image/jpeg',
    name: 'odometer.jpg',
  } as unknown as Blob);

  const res = await fetch(`${API_BASE}/v1/me/odometer/ocr`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(`OCR upload failed (${res.status})`, res.status, text || 'OCR_FAILED');
  }

  return (await res.json()) as OdometerOcrResult;
}

export async function apiCreateOdometer(
  accessToken: string,
  payload: CreateOdometerPayload,
): Promise<CreateOdometerResponse> {
  return request<CreateOdometerResponse>('/v1/me/odometer', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
}

export async function apiListOdometer(
  accessToken: string,
  vehicleId?: string,
  page = 1,
  limit = 20,
): Promise<ListOdometerResponse> {
  const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (vehicleId) qs.set('vehicleId', vehicleId);
  return request<ListOdometerResponse>(`/v1/me/odometer?${qs.toString()}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export { ApiError as OdometerApiError };
