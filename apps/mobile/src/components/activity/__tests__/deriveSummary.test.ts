import { deriveSummary } from '../deriveSummary';
import type { Submission } from '../../../api/submissions';

function sub(overrides: Partial<Submission>): Submission {
  return {
    id: 'id',
    station: null,
    price_data: [],
    status: 'verified',
    created_at: '2026-04-22T10:00:00Z',
    ...overrides,
  };
}

describe('deriveSummary', () => {
  it('returns zeros and null activeSince for empty list', () => {
    expect(deriveSummary([])).toEqual({
      verifiedCount: 0,
      stationsCovered: 0,
      activeSince: null,
    });
  });

  it('counts only verified submissions', () => {
    const summary = deriveSummary([
      sub({ id: '1', status: 'verified', station: { id: 's1', name: 'A' } }),
      sub({ id: '2', status: 'pending', station: { id: 's2', name: 'B' } }),
      sub({ id: '3', status: 'rejected', station: { id: 's3', name: 'C' } }),
      sub({ id: '4', status: 'verified', station: { id: 's4', name: 'D' } }),
    ]);
    expect(summary.verifiedCount).toBe(2);
  });

  it('counts unique stations across verified submissions only', () => {
    // Same station twice — only counted once. Pending/rejected rows ignored
    // even when they match a distinct station_id.
    const summary = deriveSummary([
      sub({ id: '1', status: 'verified', station: { id: 's1', name: 'A' } }),
      sub({ id: '2', status: 'verified', station: { id: 's1', name: 'A' } }),
      sub({ id: '3', status: 'pending', station: { id: 's2', name: 'B' } }),
    ]);
    expect(summary.stationsCovered).toBe(1);
  });

  it('ignores verified rows without a station_id', () => {
    const summary = deriveSummary([
      sub({ id: '1', status: 'verified', station: null }),
    ]);
    expect(summary.verifiedCount).toBe(1);
    expect(summary.stationsCovered).toBe(0);
  });

  it('picks the earliest created_at across ALL loaded rows (including pending/rejected)', () => {
    // activeSince reflects when the driver started contributing, regardless of
    // outcome — a rejected first attempt still counts as the start of activity.
    const summary = deriveSummary([
      sub({ id: '1', status: 'verified', created_at: '2026-04-22T10:00:00Z' }),
      sub({ id: '2', status: 'rejected', created_at: '2026-04-10T08:00:00Z' }),
      sub({ id: '3', status: 'pending', created_at: '2026-04-15T12:00:00Z' }),
    ]);
    expect(summary.activeSince?.toISOString()).toBe('2026-04-10T08:00:00.000Z');
  });

  it('skips unparseable created_at values instead of returning NaN', () => {
    const summary = deriveSummary([
      sub({ id: '1', created_at: 'not-a-date' }),
      sub({ id: '2', created_at: '2026-04-22T10:00:00Z' }),
    ]);
    expect(summary.activeSince?.toISOString()).toBe('2026-04-22T10:00:00.000Z');
  });
});
