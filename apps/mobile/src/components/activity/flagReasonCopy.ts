import type { TFunction } from 'i18next';

/**
 * Story 3.17 — pure helper that maps a `flag_reason` + status onto inline
 * copy and a CTA hint for the tap-to-explain modal. Keeping this in a
 * separate module so it can be unit-tested without rendering the row.
 *
 * The full known taxonomy is enumerated below as a const set so TypeScript
 * narrows the lookup. Anything not in the set falls through to the generic
 * fallback (`underReviewGeneric` for shadow_rejected, `rejectedGeneric` for
 * rejected). The fallback's CTA is always 'dismiss' — we don't have enough
 * context to suggest a retake when we don't know what went wrong.
 */

export type FlagReasonCta = 'retake' | 'dismiss' | 'support';

/**
 * P-13 (3.17 review) — KnownFlagReason is a literal-union type derived from
 * a single `as const` array of codes. Both `CTA_BY_CODE` and `KNOWN_CODES`
 * draw from this list, so a contributor adding a new code must touch one
 * source of truth — TypeScript then enforces that `CTA_BY_CODE` is
 * exhaustive over the union via `Record<KnownFlagReason, FlagReasonCta>`.
 */
const KNOWN_FLAG_REASONS = [
  'user_flagged_wrong',
  'price_conflict',
  'pb95_outside_rack_band',
  'on_outside_rack_band',
  'lpg_outside_rack_band',
  'low_trust',
  'logo_mismatch',
  'dlq_final_failure',
  'auto_resolved_by_resubmit',
  'auto_resolved_by_newer',
  'auto_resolved_by_older',
  'admin_marked_unusable',
  'duplicate_submission',
  'no_prices_extracted',
  'no_station_match',
  'price_out_of_range',
  'no_gps_coordinates',
  'dead_letter_discarded',
] as const;

export type KnownFlagReason = (typeof KNOWN_FLAG_REASONS)[number];

export interface FlagReasonCopy {
  /** Short italic line on the activity row. */
  label: string;
  /** Longer plain-language explanation for the modal body. */
  explanation: string;
  /** Which primary CTA the modal should render. */
  cta: FlagReasonCta;
}

// CTA mapping per code. Centralised so a future tweak is one place.
// `Record<KnownFlagReason, ...>` enforces every code in KNOWN_FLAG_REASONS
// has an entry — adding a code without picking its CTA is a compile error.
const CTA_BY_CODE: Record<KnownFlagReason, FlagReasonCta> = {
  user_flagged_wrong: 'retake',
  price_conflict: 'dismiss',
  pb95_outside_rack_band: 'dismiss',
  on_outside_rack_band: 'dismiss',
  lpg_outside_rack_band: 'dismiss',
  low_trust: 'support',
  logo_mismatch: 'retake',
  dlq_final_failure: 'retake',
  auto_resolved_by_resubmit: 'dismiss',
  auto_resolved_by_newer: 'dismiss',
  auto_resolved_by_older: 'dismiss',
  admin_marked_unusable: 'dismiss',
  duplicate_submission: 'dismiss',
  no_prices_extracted: 'retake',
  no_station_match: 'retake',
  price_out_of_range: 'retake',
  no_gps_coordinates: 'retake',
  dead_letter_discarded: 'dismiss',
};

const KNOWN_CODES: ReadonlySet<string> = new Set(KNOWN_FLAG_REASONS);

function isKnownFlagReason(value: string): value is KnownFlagReason {
  return KNOWN_CODES.has(value);
}

/**
 * Resolve copy for a row.
 *
 * - When `flagReason` is in the known taxonomy: pulls the matching
 *   `contribution.flagReason.<code>.{label,explanation}` and the matching
 *   CTA from {@link CTA_BY_CODE}.
 * - When `flagReason` is null OR an unknown code: falls back to the
 *   generic `underReviewGeneric` (for `shadow_rejected`) or `rejectedGeneric`
 *   (for `rejected`), with `cta: 'dismiss'`.
 *
 * Story 4.3 caveat: rows with `flag_reason: 'shadow_banned'` are laundered
 * to `pending` on the wire by the backend, so this helper never sees them
 * for shadow-banned users. Kept out of the taxonomy by design.
 */
export function flagReasonCopy(
  flagReason: string | null,
  status: 'shadow_rejected' | 'rejected',
  t: TFunction,
): FlagReasonCopy {
  if (flagReason && isKnownFlagReason(flagReason)) {
    return {
      label: t(`contribution.flagReason.${flagReason}.label`),
      explanation: t(`contribution.flagReason.${flagReason}.explanation`),
      cta: CTA_BY_CODE[flagReason],
    };
  }
  const genericKey = status === 'shadow_rejected' ? 'underReviewGeneric' : 'rejectedGeneric';
  return {
    label: t(`contribution.flagReason.${genericKey}.label`),
    explanation: t(`contribution.flagReason.${genericKey}.explanation`),
    cta: 'dismiss',
  };
}
