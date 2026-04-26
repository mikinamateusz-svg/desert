/**
 * Tests for metrics server actions. Covers the GET-with-params shape via
 * fetchFunnelMetrics(period) — the 'period' must be interpolated into the
 * query string correctly.
 *
 * fetchPipelineHealth, fetchProductMetrics(period), fetchApiCostMetrics, and
 * fetchFunnelDrilldown follow the same patterns covered here + by
 * station-sync/actions.spec.ts; not explicitly retested.
 */
import { mockFetchOnce, resetFetchMock, getFetchCalls, restoreFetch } from '../../../test/fetch-mock';
import { mockCookies } from '../../../test/cookie-mock';

jest.mock('next/headers', () => ({
  cookies: jest.fn(),
}));

import { cookies } from 'next/headers';
import { fetchFunnelMetrics } from './actions';

describe('metrics actions — fetchFunnelMetrics (GET-with-params shape)', () => {
  beforeEach(() => {
    (cookies as jest.Mock).mockReset();
    (cookies as jest.Mock).mockResolvedValue(mockCookies({ admin_token: 'tok' }));
    resetFetchMock();
  });

  afterAll(() => {
    restoreFetch();
  });

  it('returns { data } on 2xx with the typed payload', async () => {
    mockFetchOnce({
      status: 200,
      body: {
        period: '7d',
        total: 100,
        verified: 80,
        rejected: 15,
        shadowRejected: 5,
        rejectionBreakdown: [],
      },
    });

    const result = await fetchFunnelMetrics('7d');
    expect(result.error).toBeUndefined();
    expect(result.data).toMatchObject({ period: '7d', total: 100, verified: 80 });
  });

  it('interpolates the period parameter into the query string', async () => {
    mockFetchOnce({ status: 200, body: { period: '30d' } });
    await fetchFunnelMetrics('30d');
    const calls = getFetchCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toMatch(/\/v1\/admin\/metrics\/funnel\?period=30d$/);
  });

  it('returns { error } on API failure (does not throw)', async () => {
    mockFetchOnce({ status: 500, textBody: 'boom' });
    const result = await fetchFunnelMetrics('today');
    expect(result.data).toBeUndefined();
    expect(result.error).toBeDefined();
  });
});
