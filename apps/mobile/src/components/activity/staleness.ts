import type { TFunction } from 'i18next';

/**
 * Story 3.17 — humanise the time since a row went `shadow_rejected` for
 * the inline activity-row staleness suffix. Returns:
 *
 * - `null` when the row is younger than 6 hours — staleness suffix is
 *   noise on freshly-flagged rows. AC3 sets the threshold deliberately.
 * - `Od X godz.` (PL) when between 6h and 47h59m, where `X` is the floor
 *   of hours elapsed.
 * - `Od X dni` when ≥48h, where `X` is the floor of days.
 *
 * EN/UK strings come from i18n; the helper is locale-agnostic — it picks
 * the right plural-template key and lets `i18next` interpolate `{{count}}`.
 */

const SIX_HOURS_MS = 6 * 3600 * 1000;
const FORTY_EIGHT_HOURS_MS = 48 * 3600 * 1000;
const ONE_HOUR_MS = 3600 * 1000;
const ONE_DAY_MS = 24 * 3600 * 1000;

export function staleness(createdAt: Date, now: Date, t: TFunction): string | null {
  const ageMs = now.getTime() - createdAt.getTime();
  // Future timestamps (clock skew) and non-finite ages — treat as "fresh"
  // so we don't emit a nonsensical "Od -2 godz." string. The single
  // `< SIX_HOURS_MS` check covers both the negative-age clock-skew case
  // and the in-window fresh case in one branch.
  if (!Number.isFinite(ageMs) || ageMs < SIX_HOURS_MS) {
    return null;
  }
  if (ageMs < FORTY_EIGHT_HOURS_MS) {
    const hours = Math.floor(ageMs / ONE_HOUR_MS);
    return t('contribution.flagReason.stalenessHours', { count: hours });
  }
  const days = Math.floor(ageMs / ONE_DAY_MS);
  return t('contribution.flagReason.stalenessDays', { count: days });
}
