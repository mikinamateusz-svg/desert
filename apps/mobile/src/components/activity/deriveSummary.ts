import type { Submission } from '../../api/submissions';

export interface ActivitySummary {
  /** Count of submissions with status === 'verified'. Drives "{{count}} zgłoszeń". */
  verifiedCount: number;
  /** Unique station_id count across verified submissions. */
  stationsCovered: number;
  /**
   * Earliest created_at across the loaded submissions. Null if no submissions
   * have loaded yet. Callers render "Aktywny od X" — and should suffix with `+`
   * (via `activeSinceApprox`) when `hasMore === true`, since the oldest page
   * may not be on screen yet.
   */
  activeSince: Date | null;
}

export function deriveSummary(submissions: Submission[]): ActivitySummary {
  let verifiedCount = 0;
  const stationIds = new Set<string>();
  let earliestMs: number | null = null;

  for (const s of submissions) {
    if (s.status === 'verified') {
      verifiedCount += 1;
      if (s.station?.id) stationIds.add(s.station.id);
    }
    const ms = Date.parse(s.created_at);
    if (!Number.isNaN(ms) && (earliestMs === null || ms < earliestMs)) {
      earliestMs = ms;
    }
  }

  return {
    verifiedCount,
    stationsCovered: stationIds.size,
    activeSince: earliestMs === null ? null : new Date(earliestMs),
  };
}
