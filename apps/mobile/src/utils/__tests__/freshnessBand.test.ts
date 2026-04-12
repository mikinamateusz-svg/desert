import { freshnessBand } from '../freshnessBand';

describe('freshnessBand', () => {
  it('returns fresh for timestamp less than 2 days old', () => {
    const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString();
    expect(freshnessBand(oneHourAgo)).toBe('fresh');
  });

  it('returns fresh for timestamp exactly now', () => {
    expect(freshnessBand(new Date().toISOString())).toBe('fresh');
  });

  it('returns fresh for future timestamp (clock skew)', () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    expect(freshnessBand(tomorrow)).toBe('fresh');
  });

  it('returns recent for timestamp 3 days old', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString();
    expect(freshnessBand(threeDaysAgo)).toBe('recent');
  });

  it('returns stale for timestamp 10 days old', () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000).toISOString();
    expect(freshnessBand(tenDaysAgo)).toBe('stale');
  });

  it('returns unknown for invalid string', () => {
    expect(freshnessBand('not-a-date')).toBe('unknown');
    expect(freshnessBand('')).toBe('unknown');
  });
});
