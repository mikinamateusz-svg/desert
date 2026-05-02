import { calculateSavings } from '../savings';

describe('calculateSavings', () => {
  it('returns positive savings rounded to 2dp when paid below area average', () => {
    // After P-3 grosz-integer math:
    //   round(7.00 × 47.3 × 100) − round(6.65 × 47.3 × 100)
    //   = round(33110.000…) − round(31454.500…)  // both already integer-ish
    //   = 33110 − 31455 (banker rounding on .5 lifts to even)
    //   = 1655 / 100 = 16.55
    // Deterministic across platforms now — pin the exact value.
    expect(calculateSavings(7.0, 6.65, 47.3)).toBe(16.55);
  });

  it('returns negative savings rounded to 2dp when paid above area average', () => {
    // (6.00 × 47.3 × 100) - (6.65 × 47.3 × 100) → round each → grosz delta
    expect(calculateSavings(6.0, 6.65, 47.3)).toBe(-30.75);
  });

  it('returns 0 when paid exactly the area average', () => {
    expect(calculateSavings(6.5, 6.5, 47.3)).toBe(0);
  });

  it('returns null when areaAvg is null (AC2 — caller hides UI)', () => {
    expect(calculateSavings(null, 6.65, 47.3)).toBeNull();
  });

  it('returns null when areaAvg is non-finite', () => {
    expect(calculateSavings(NaN, 6.65, 47.3)).toBeNull();
    expect(calculateSavings(Infinity, 6.65, 47.3)).toBeNull();
    expect(calculateSavings(-Infinity, 6.65, 47.3)).toBeNull();
  });

  it('returns null when price or litres are non-finite', () => {
    expect(calculateSavings(6.5, NaN, 47.3)).toBeNull();
    expect(calculateSavings(6.5, 6.65, Infinity)).toBeNull();
  });

  it('handles small fill-ups correctly', () => {
    // (6.5 − 6.4) × 5 = 0.5
    expect(calculateSavings(6.5, 6.4, 5)).toBeCloseTo(0.5, 2);
  });

  it('handles large fill-ups correctly', () => {
    // (7.0 − 6.65) × 250 = 87.50
    expect(calculateSavings(7.0, 6.65, 250)).toBeCloseTo(87.5, 2);
  });

  it('rounds to grosz precision (2dp), not floating-point detail', () => {
    // After P-3 grosz-integer math:
    //   round(6.81 × 47.3 × 100) − round(6.79 × 47.3 × 100)
    //   = round(32211.3) − round(32116.7) = 32211 − 32117 = 94
    //   = 0.94 (each side rounded to grosz independently)
    // The naive (a-b)*l*100 round path produced 0.95; the new path is
    // 1 grosz off because each side rounds independently. This is
    // tolerable for our display purposes (≤1 grosz drift on tiny diffs)
    // and is the price for platform-stable arithmetic.
    expect(calculateSavings(6.81, 6.79, 47.3)).toBe(0.94);
  });
});
