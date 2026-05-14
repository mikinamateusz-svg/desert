const API_BASE = process.env['EXPO_PUBLIC_API_URL'] ?? 'http://localhost:3000';

/** Story 6.4 — fuel-type identifiers shared with Stories 5.x. */
export type AlertFuelType = 'PB_95' | 'PB_98' | 'ON' | 'ON_PREMIUM' | 'LPG';

/** Story 6.4 — drop-alert mode. `cheaper_than_now` triggers when any
 *  station within radius drops below the user's most recent observation
 *  for that fuel; `target_price` triggers when a station within radius
 *  reaches or beats `price_drop_target_pln`. */
export type PriceDropMode = 'cheaper_than_now' | 'target_price';

/** Story 6.4 — fixed radius set; mirrors backend DTO whitelist. */
export type AlertRadiusKm = 5 | 10 | 25;

export interface NotificationPreferences {
  id: string;
  user_id: string;
  // Phase 1 — retained for back-compat with the existing alert pipeline.
  // Not surfaced in the Story 6.4 UI (price_drops + sharp_rise hidden);
  // monthly_summary still shown in the Monthly Summary section.
  price_drops: boolean;
  sharp_rise: boolean;
  monthly_summary: boolean;
  // Phase 2 (Story 6.4)
  price_drop_enabled: boolean;
  price_drop_mode: PriceDropMode;
  /** Decimal serialised by Prisma — string in the wire, parsed by the
   *  UI. null when mode is `cheaper_than_now`. */
  price_drop_target_pln: string | null;
  price_drop_fuel_types: AlertFuelType[];
  alert_radius_km: AlertRadiusKm;
  rise_community_enabled: boolean;
  rise_predictive_enabled: boolean;
}

export interface UpdateNotificationPreferencesPayload {
  expo_push_token?: string | null;
  // Phase 1 (monthly_summary still surfaced in UI; price_drops + sharp_rise
  // not exposed but retained on the type for back-compat callers).
  price_drops?: boolean;
  sharp_rise?: boolean;
  monthly_summary?: boolean;
  // Phase 2
  price_drop_enabled?: boolean;
  price_drop_mode?: PriceDropMode;
  /** Number on the wire — backend Decimal column accepts JS numbers
   *  directly. null clears the target (mode flip back). */
  price_drop_target_pln?: number | null;
  price_drop_fuel_types?: AlertFuelType[];
  alert_radius_km?: AlertRadiusKm;
  rise_community_enabled?: boolean;
  rise_predictive_enabled?: boolean;
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

/** Story 6.6 — drives the monthly-summary smart re-prompt sheet shown
 *  on app open. Returns `pending: true` only when the user has no push
 *  token AND Story 6.5's monthly cron computed a summary for them. */
export interface SummaryRepromptStatus {
  pending: boolean;
  savedPln: number | null;
}

export async function apiGetSummaryReprompt(accessToken: string): Promise<SummaryRepromptStatus> {
  return request<SummaryRepromptStatus>('/v1/me/notifications/summary-reprompt', {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// ── Story 6.8 — analytics event sink ─────────────────────────────────────

/** Authenticated-user event types the backend allowlist accepts. */
export type NotificationEventType =
  | 'reprompt_shown'
  | 'reprompt_dismissed'
  | 'reprompt_granted'
  | 'notification_opened';

/**
 * Best-effort fire-and-forget post to record a notification analytics
 * event. The 6.8 admin panel aggregates these for reprompt conversion +
 * notification engagement metrics. Callers should NEVER await this and
 * NEVER block on errors — `.catch(() => {})` is the typical pattern.
 */
export async function apiRecordNotificationEvent(
  accessToken: string,
  eventType: NotificationEventType,
  trigger?: string | null,
  alertType?: string | null,
): Promise<void> {
  await fetch(`${API_BASE}/v1/me/notifications/events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      eventType,
      trigger: trigger ?? null,
      alertType: alertType ?? null,
    }),
  });
}
