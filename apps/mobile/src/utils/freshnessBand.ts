export type FreshnessBand = 'fresh' | 'recent' | 'stale' | 'unknown';

/**
 * Categorises elapsed time since an ISO timestamp.
 *
 * fresh:   < 2 days
 * recent:  2–7 days
 * stale:   > 7 days
 * unknown: unparseable isoString (NaN guard)
 */
export function freshnessBand(isoString: string): FreshnessBand {
  const ts = new Date(isoString).getTime();
  if (isNaN(ts)) return 'unknown';

  const diffMs = Date.now() - ts;
  if (diffMs < 0) return 'fresh'; // future timestamp (clock skew)

  const days = diffMs / 86_400_000;
  if (days < 2) return 'fresh';
  if (days < 7) return 'recent';
  return 'stale';
}
