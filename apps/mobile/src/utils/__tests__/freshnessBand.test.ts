import { freshnessBand } from '../freshnessBand';

describe('freshnessBand', () => {
  // ── time-only path (no rack-stale flag) ───────────────────────────────
  it('returns fresh for timestamp less than 3 days old', () => {
    const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString();
    expect(freshnessBand(oneHourAgo)).toBe('fresh');
  });

  it('returns fresh for timestamp exactly now', () => {
    expect(freshnessBand(new Date().toISOString())).toBe('fresh');
  });

  it('returns fresh for timestamp 2 days old (under new 3d recent threshold)', () => {
    // Story 2.17 recalibration: 2d→3d threshold (was 2d under pre-2.17).
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
    expect(freshnessBand(twoDaysAgo)).toBe('fresh');
  });

  it('returns fresh for future timestamp (clock skew)', () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    expect(freshnessBand(tomorrow)).toBe('fresh');
  });

  it('returns recent for timestamp 3 days old', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString();
    expect(freshnessBand(threeDaysAgo)).toBe('recent');
  });

  it('returns recent for timestamp 6 days old (still under stale threshold)', () => {
    const sixDaysAgo = new Date(Date.now() - 6 * 86_400_000).toISOString();
    expect(freshnessBand(sixDaysAgo)).toBe('recent');
  });

  it('returns stale for timestamp 10 days old', () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000).toISOString();
    expect(freshnessBand(tenDaysAgo)).toBe('stale');
  });

  it('returns unknown for invalid string', () => {
    expect(freshnessBand('not-a-date')).toBe('unknown');
    expect(freshnessBand('')).toBe('unknown');
  });

  // ── Story 2.17: rack-stale flag override ───────────────────────────────
  it('returns stale when isStale flag is true, regardless of timestamp age', () => {
    const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString();
    // Without flag → fresh
    expect(freshnessBand(oneHourAgo)).toBe('fresh');
    // With flag → stale (rack moved since verification)
    expect(freshnessBand(oneHourAgo, true)).toBe('stale');
  });

  it('treats isStale=false the same as omitted (time-only path)', () => {
    const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString();
    expect(freshnessBand(oneHourAgo, false)).toBe('fresh');
    expect(freshnessBand(oneHourAgo)).toBe('fresh');
  });

  it('rack-stale override wins even for recent-band timestamps', () => {
    const fourDaysAgo = new Date(Date.now() - 4 * 86_400_000).toISOString();
    expect(freshnessBand(fourDaysAgo)).toBe('recent');
    expect(freshnessBand(fourDaysAgo, true)).toBe('stale');
  });

  it('rack-stale + invalid timestamp → still stale (override applies first)', () => {
    // Override is checked before parse; even invalid input becomes stale.
    expect(freshnessBand('not-a-date', true)).toBe('stale');
  });
});
