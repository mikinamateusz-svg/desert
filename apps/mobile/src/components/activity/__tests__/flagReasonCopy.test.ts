import { flagReasonCopy } from '../flagReasonCopy';

// Minimal `t` stub: returns the requested key path so we can assert
// flagReasonCopy looked up the right string. Real i18next resolution is
// covered by integration / manual regression — the unit job here is to
// verify the lookup logic, not the translations.
const t = ((key: string) => key) as unknown as Parameters<typeof flagReasonCopy>[2];

describe('flagReasonCopy', () => {
  it('returns retake CTA for user_flagged_wrong', () => {
    const r = flagReasonCopy('user_flagged_wrong', 'shadow_rejected', t);
    expect(r.cta).toBe('retake');
    expect(r.label).toBe('contribution.flagReason.user_flagged_wrong.label');
    expect(r.explanation).toBe('contribution.flagReason.user_flagged_wrong.explanation');
  });

  it('returns dismiss CTA for price_conflict', () => {
    expect(flagReasonCopy('price_conflict', 'shadow_rejected', t).cta).toBe('dismiss');
  });

  it('returns dismiss CTA for the three rack-band codes', () => {
    expect(flagReasonCopy('pb95_outside_rack_band', 'shadow_rejected', t).cta).toBe('dismiss');
    expect(flagReasonCopy('on_outside_rack_band', 'shadow_rejected', t).cta).toBe('dismiss');
    expect(flagReasonCopy('lpg_outside_rack_band', 'shadow_rejected', t).cta).toBe('dismiss');
  });

  it('returns support CTA for low_trust', () => {
    expect(flagReasonCopy('low_trust', 'shadow_rejected', t).cta).toBe('support');
  });

  it('returns retake CTA for retake-able terminal cases', () => {
    expect(flagReasonCopy('logo_mismatch', 'shadow_rejected', t).cta).toBe('retake');
    expect(flagReasonCopy('dlq_final_failure', 'shadow_rejected', t).cta).toBe('retake');
    expect(flagReasonCopy('no_prices_extracted', 'rejected', t).cta).toBe('retake');
    expect(flagReasonCopy('no_station_match', 'rejected', t).cta).toBe('retake');
    expect(flagReasonCopy('price_out_of_range', 'rejected', t).cta).toBe('retake');
    expect(flagReasonCopy('no_gps_coordinates', 'rejected', t).cta).toBe('retake');
  });

  it('returns dismiss CTA for terminal auto-resolve cases', () => {
    expect(flagReasonCopy('auto_resolved_by_resubmit', 'rejected', t).cta).toBe('dismiss');
    expect(flagReasonCopy('auto_resolved_by_newer', 'rejected', t).cta).toBe('dismiss');
    expect(flagReasonCopy('auto_resolved_by_older', 'rejected', t).cta).toBe('dismiss');
    expect(flagReasonCopy('admin_marked_unusable', 'rejected', t).cta).toBe('dismiss');
    expect(flagReasonCopy('duplicate_submission', 'rejected', t).cta).toBe('dismiss');
    expect(flagReasonCopy('dead_letter_discarded', 'rejected', t).cta).toBe('dismiss');
  });

  it('falls back to underReviewGeneric for null flag_reason on shadow_rejected', () => {
    const r = flagReasonCopy(null, 'shadow_rejected', t);
    expect(r.cta).toBe('dismiss');
    expect(r.label).toBe('contribution.flagReason.underReviewGeneric.label');
    expect(r.explanation).toBe('contribution.flagReason.underReviewGeneric.explanation');
  });

  it('falls back to rejectedGeneric for null flag_reason on rejected', () => {
    const r = flagReasonCopy(null, 'rejected', t);
    expect(r.cta).toBe('dismiss');
    expect(r.label).toBe('contribution.flagReason.rejectedGeneric.label');
  });

  it('falls back to underReviewGeneric for unknown flag_reason on shadow_rejected', () => {
    const r = flagReasonCopy('future_unknown_code', 'shadow_rejected', t);
    expect(r.cta).toBe('dismiss');
    expect(r.label).toBe('contribution.flagReason.underReviewGeneric.label');
  });

  it('falls back to rejectedGeneric for unknown flag_reason on rejected', () => {
    const r = flagReasonCopy('future_unknown_code', 'rejected', t);
    expect(r.cta).toBe('dismiss');
    expect(r.label).toBe('contribution.flagReason.rejectedGeneric.label');
  });
});
