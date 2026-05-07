import { staleness } from '../staleness';

// Mock t: returns the key + interpolated count so we can assert exactly
// which plural-template key fired.
const t = ((key: string, opts?: { count?: number }) =>
  opts?.count !== undefined ? `${key}:${opts.count}` : key) as unknown as Parameters<typeof staleness>[2];

const createdAt = new Date('2026-05-07T10:00:00Z');

function ageHours(h: number): Date {
  return new Date(createdAt.getTime() + h * 3600 * 1000);
}

describe('staleness', () => {
  it('returns null for fresh rows (<6h)', () => {
    expect(staleness(createdAt, createdAt, t)).toBeNull();
    expect(staleness(createdAt, ageHours(1), t)).toBeNull();
    expect(staleness(createdAt, ageHours(5.5), t)).toBeNull();
  });

  it('returns null at exactly 5h59m', () => {
    const justUnder = new Date(createdAt.getTime() + 6 * 3600 * 1000 - 1);
    expect(staleness(createdAt, justUnder, t)).toBeNull();
  });

  it('returns hours suffix at 6h boundary', () => {
    expect(staleness(createdAt, ageHours(6), t)).toBe('contribution.flagReason.stalenessHours:6');
  });

  it('returns hours suffix at 47h', () => {
    expect(staleness(createdAt, ageHours(47), t)).toBe('contribution.flagReason.stalenessHours:47');
  });

  it('returns days suffix at 48h boundary (= 2 dni)', () => {
    expect(staleness(createdAt, ageHours(48), t)).toBe('contribution.flagReason.stalenessDays:2');
  });

  it('returns days suffix at 7d2h (rounded down to 7 dni)', () => {
    expect(staleness(createdAt, ageHours(7 * 24 + 2), t)).toBe(
      'contribution.flagReason.stalenessDays:7',
    );
  });

  it('returns days suffix at 1 year (365 dni)', () => {
    expect(staleness(createdAt, ageHours(365 * 24), t)).toBe(
      'contribution.flagReason.stalenessDays:365',
    );
  });

  it('returns null when now is BEFORE createdAt (clock skew defense)', () => {
    const before = new Date(createdAt.getTime() - 60_000);
    expect(staleness(createdAt, before, t)).toBeNull();
  });

  it('returns null when ageMs is non-finite (defensive)', () => {
    const invalid = new Date(NaN);
    expect(staleness(invalid, createdAt, t)).toBeNull();
  });
});
