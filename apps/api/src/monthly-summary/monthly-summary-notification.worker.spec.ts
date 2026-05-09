import { previousMonth } from './monthly-summary-notification.worker.js';

describe('previousMonth', () => {
  it('returns the prior month when called mid-year', () => {
    expect(previousMonth(new Date(2026, 5, 1))).toEqual({ year: 2026, month: 5 });
  });

  it('rolls year back when called in January', () => {
    // January 1 2026 → previous month is December 2025
    expect(previousMonth(new Date(2026, 0, 1))).toEqual({ year: 2025, month: 12 });
  });

  it('uses the same month no matter which day of the month it is called', () => {
    expect(previousMonth(new Date(2026, 5, 30))).toEqual({ year: 2026, month: 5 });
    expect(previousMonth(new Date(2026, 5, 1))).toEqual({ year: 2026, month: 5 });
  });
});
