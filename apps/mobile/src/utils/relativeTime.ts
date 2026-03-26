/**
 * Returns a short human-readable token representing elapsed time since `isoString`.
 *
 * Examples: 'just now', '5m', '3h', '2d'
 *
 * Returns '?' if `isoString` is unparseable (NaN guard).
 */
export function relativeTime(isoString: string): string {
  const ts = new Date(isoString).getTime();
  if (isNaN(ts)) return '?';

  const diffMs  = Date.now() - ts;
  if (diffMs < 0) return 'just now'; // future timestamp (clock skew)

  const minutes = Math.floor(diffMs / 60_000);
  const hours   = Math.floor(diffMs / 3_600_000);
  const days    = Math.floor(diffMs / 86_400_000);

  if (minutes < 2)  return 'just now';
  if (minutes < 60) return `${minutes}m`;
  if (hours   < 24) return `${hours}h`;
  return `${days}d`;
}
