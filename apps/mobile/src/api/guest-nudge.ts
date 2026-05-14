/**
 * Story 6.9 — guest-nudge API helpers. All three endpoints are
 * unauthenticated (no Authorization header). Best-effort callers
 * should `.catch(() => {})` since these are analytics + nudge flows
 * that must never block the UX.
 */
const API_BASE = process.env['EXPO_PUBLIC_API_URL'] ?? 'http://localhost:3000';

/** Used by the analytics event sink — keep in sync with the backend allowlist. */
export type GuestNudgeType = 'engagement' | 'market_event';
export type GuestNudgeEventName =
  | 'guest_nudge_shown'
  | 'guest_nudge_dismissed'
  | 'guest_nudge_cta_tapped';

export interface MarketEventNudge {
  active: boolean;
  eventId: string | null;
}

/** Registers an Expo push token for an unauthenticated guest. */
export async function apiRegisterGuestPushToken(token: string): Promise<void> {
  await fetch(`${API_BASE}/v1/guest/push-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
}

/** Reads the current market-event nudge state (the in-app banner fallback). */
export async function apiGetMarketEventNudge(): Promise<MarketEventNudge> {
  const res = await fetch(`${API_BASE}/v1/nudge/market-event`, { method: 'GET' });
  if (!res.ok) {
    // Fail-CLOSED on the client — suppress the banner rather than
    // surfacing a misleading display on a partial response.
    return { active: false, eventId: null };
  }
  return (await res.json()) as MarketEventNudge;
}

/**
 * Posts a guest analytics event. Best-effort fire-and-forget — callers
 * should `.catch(() => {})` and never await this in a critical path.
 */
export async function apiLogGuestNudgeEvent(
  nudgeType: GuestNudgeType,
  eventName: GuestNudgeEventName,
): Promise<void> {
  await fetch(`${API_BASE}/v1/nudge/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nudgeType, eventName }),
  });
}
