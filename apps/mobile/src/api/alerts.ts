/**
 * Story 6.10 — premium alerts status fetch. Tiny payload; safe to poll on
 * app foreground and after submission verification events. Server-side
 * value comes from the User row's `premium_alerts_active_until` column —
 * extended +30d on every verified submission.
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
