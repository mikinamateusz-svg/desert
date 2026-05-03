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
  /** Story 5.4: l/100km set when an odometer reading closes the segment. */
  consumption_l_per_100km: number | null;
  odometer_km: number | null;
  voivodeship: string | null;
  filled_at: string;
  created_at: string;
}

/**
 * History list payload (Story 5.5). Joined vehicle + station are returned
 * inline so the FillUpCard can render labels without a per-row fetch.
 * Vehicle is always present (every fill-up has a vehicle); station is
 * null when GPS match failed at fill-up time OR when the station was
 * deleted afterwards (FK SetNull).
 */
export interface FillupListItem extends FillUp {
  vehicle: {
    id: string;
    nickname: string | null;
    make: string;
    model: string;
  };
  station: { id: string; name: string } | null;
}

export type FillupPeriod = '30d' | '3m' | '12m' | 'all';

export interface FillupSummary {
  totalSpendPln: number;
  totalLitres: number;
  /** Null when no fill-ups in period — UI hides the card. */
  avgPricePerLitrePln: number | null;
  /** Null when no fill-ups in period have area_avg_at_fillup. */
  totalSavingsPln: number | null;
  /** Null when no fill-ups in period have a consumption value. */
  avgConsumptionL100km: number | null;
  fillupCount: number;
}

/**
 * Story 5.7: calendar-month summary feeding the savings-summary screen
 * + ShareableCard. Empty months are a valid response (totals at 0,
 * `totalSavingsPln: null`).
 */
export interface MonthlySummaryDto {
  year: number;
  /** 1–12. */
  month: number;
  totalSavingsPln: number | null;
  fillupCount: number;
  totalSpendPln: number;
  totalLitres: number;
  avgPricePerLitrePln: number | null;
  /** Story 6.7: e.g. 20 = "top 20% in your voivodeship". null until 6.7. */
  rankingPercentile: number | null;
  rankingVoivodeship: string | null;
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
  data: FillupListItem[];
  total: number;
  page: number;
  limit: number;
  summary: FillupSummary;
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

export interface ListFillupsParams {
  /** Vehicle UUID, or 'all' / undefined for cross-vehicle history. */
  vehicleId?: string;
  /** Defaults server-side to '3m' if omitted — match if you change the UI default. */
  period?: FillupPeriod;
  page?: number;
  limit?: number;
}

export async function apiListFillups(
  accessToken: string,
  params: ListFillupsParams = {},
): Promise<ListFillupsResponse> {
  const { vehicleId, period, page = 1, limit = 20 } = params;
  const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (vehicleId) qs.set('vehicleId', vehicleId);
  if (period) qs.set('period', period);
  return request<ListFillupsResponse>(`/v1/me/fillups?${qs.toString()}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

/**
 * Story 5.7: month-bounded summary for the savings-summary screen.
 * `month` is 1-based (1–12) to match the human calendar — server-side
 * we convert to 0-based for Date.UTC.
 */
export async function apiGetMonthlySummary(
  accessToken: string,
  year: number,
  month: number,
): Promise<MonthlySummaryDto> {
  const qs = new URLSearchParams({ year: String(year), month: String(month) });
  return request<MonthlySummaryDto>(`/v1/me/fillups/monthly-summary?${qs.toString()}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}
