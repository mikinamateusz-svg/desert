export type FreshnessBand = 'fresh' | 'recent' | 'stale' | 'unknown';

/**
 * Story 2.17 — freshness band derived from BOTH elapsed time AND the
 * server-side rack-staleness flag.
 *
 *   isStale === true     → 'stale' (rack moved since last verification —
 *                          the price is suspect regardless of how recent
 *                          the verification timestamp looks)
 *   age ≥ STALE_DAYS     → 'stale'
 *   age ≥ RECENT_DAYS    → 'recent'
 *   otherwise            → 'fresh'
 *
 * Thresholds recalibrated 2026-05-13: 2d → 3d (recent), 7d (stale)
 * unchanged. The shorter "recent" band reflects how often Polish rack
 * prices move — even a 2-3 day old verification can be sketchy now
 * that rack moves are daily during volatile weeks.
 */
const RECENT_THRESHOLD_DAYS = 3;
const STALE_THRESHOLD_DAYS = 7;

export function freshnessBand(isoString: string, isStale?: boolean): FreshnessBand {
  // Rack-event override wins over time-based bands. Even a 1-hour-old
  // price is stale if rack has moved against it since recording.
  if (isStale === true) return 'stale';

  const ts = new Date(isoString).getTime();
  if (isNaN(ts)) return 'unknown';

  const diffMs = Date.now() - ts;
  if (diffMs < 0) return 'fresh'; // future timestamp (clock skew)

  const days = diffMs / 86_400_000;
  if (days < RECENT_THRESHOLD_DAYS) return 'fresh';
  if (days < STALE_THRESHOLD_DAYS) return 'recent';
  return 'stale';
}
