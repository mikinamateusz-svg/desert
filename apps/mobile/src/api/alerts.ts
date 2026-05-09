/**
 * Story 6.10 — premium alerts status fetch. Tiny payload; safe to poll on
 * app foreground and after submission verification events. Server-side
 * value comes from the User row's `premium_alerts_active_until` column —
 * extended +30d on every verified submission.
 *
 * Story 6.11 — alerts inbox endpoints + types.
 */
const API_BASE = process.env['EXPO_PUBLIC_API_URL'] ?? 'http://localhost:3000';

export interface PremiumAlertsStatus {
  /** ISO timestamp string, or null when the user has never earned a premium window. */
  premiumAlertsActiveUntil: string | null;
}

export async function apiGetPremiumAlertsStatus(
  accessToken: string,
): Promise<PremiumAlertsStatus> {
  const res = await fetch(`${API_BASE}/v1/me/alerts-status`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`alerts-status fetch failed: ${res.status}`);
  }
  const json = (await res.json()) as { premium_alerts_active_until: string | null };
  return { premiumAlertsActiveUntil: json.premium_alerts_active_until };
}

// ── Story 6.11 inbox ────────────────────────────────────────────────────────

/** Known alert types. The backend stores `alert_type` as free-form text so
 * future stories (6.1 / 6.2 / 6.5) can add new types via additive code
 * change with no migration. The UI treats unknown types gracefully. */
export type KnownAlertType = 'price_rise' | 'premium_expiring_warning';

export interface AlertRow {
  id: string;
  alert_type: string;
  title: string;
  body: string;
  sent_at: string;
  read_at: string | null;
  payload: Record<string, unknown> | null;
}

export interface AlertListResult {
  data: AlertRow[];
  total: number;
  unread_count: number;
  page: number;
  limit: number;
}

export async function apiGetAlerts(
  accessToken: string,
  page = 1,
  limit = 20,
): Promise<AlertListResult> {
  const url = new URL(`${API_BASE}/v1/alerts`);
  url.searchParams.set('page', String(page));
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`alerts fetch failed: ${res.status}`);
  }
  return (await res.json()) as AlertListResult;
}

/**
 * P8 (6.11 review) — error surface includes the HTTP status so callers can
 * branch on 404 (alert was deleted server-side or never belonged to this
 * user). The inbox uses this to remove the row from the list rather than
 * rolling back to unread, which would cause an infinite re-tap loop.
 */
export class AlertsApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'AlertsApiError';
  }
}

export async function apiMarkAlertRead(accessToken: string, id: string): Promise<AlertRow> {
  const res = await fetch(`${API_BASE}/v1/alerts/${encodeURIComponent(id)}/read`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new AlertsApiError(res.status, `mark-read failed: ${res.status}`);
  }
  return (await res.json()) as AlertRow;
}

export async function apiMarkAllAlertsRead(
  accessToken: string,
): Promise<{ marked_read: number }> {
  const res = await fetch(`${API_BASE}/v1/alerts/read-all`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`mark-all-read failed: ${res.status}`);
  }
  return (await res.json()) as { marked_read: number };
}
