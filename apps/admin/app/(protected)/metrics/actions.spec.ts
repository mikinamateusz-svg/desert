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
import { fetchFunnelMetrics, fetchFreshnessData } from './actions';

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

describe('metrics actions — fetchFreshnessData (story 4.8)', () => {
  beforeEach(() => {
    (cookies as jest.Mock).mockReset();
    (cookies as jest.Mock).mockResolvedValue(mockCookies({ admin_token: 'tok' }));
    resetFetchMock();
  });

  afterAll(() => {
    restoreFetch();
  });

  it('returns { data } on 2xx with the FreshnessDashboardDto shape', async () => {
    mockFetchOnce({
      status: 200,
      body: {
        data: [
          {
            stationId: 's1',
            stationName: 'Test',
            address: null,
            voivodeship: null,
            priceSource: null,
            lastPriceAt: null,
            isStale: true,
          },
        ],
        total: 1,
        page: 1,
        limit: 50,
        staleCount: 1,
      },
    });

    const result = await fetchFreshnessData({});
    expect(result.error).toBeUndefined();
    expect(result.data?.staleCount).toBe(1);
    expect(result.data?.data[0].isStale).toBe(true);
  });

  it('omits all query params when called with empty options', async () => {
    mockFetchOnce({ status: 200, body: { data: [], total: 0, page: 1, limit: 50, staleCount: 0 } });
    await fetchFreshnessData({});
    const calls = getFetchCalls();
    // No '?' suffix when no params — keeps the URL clean and matches the API default behaviour
    expect(calls[0].url).toMatch(/\/v1\/admin\/metrics\/freshness$/);
  });

  it('serialises voivodeship + sortBy + order + page + limit into the query string', async () => {
    mockFetchOnce({ status: 200, body: { data: [], total: 0, page: 2, limit: 25, staleCount: 0 } });
    await fetchFreshnessData({
      voivodeship: 'mazowieckie',
      sortBy: 'voivodeship',
      order: 'desc',
      page: 2,
      limit: 25,
    });
    const calls = getFetchCalls();
    expect(calls[0].url).toContain('voivodeship=mazowieckie');
    expect(calls[0].url).toContain('sortBy=voivodeship');
    expect(calls[0].url).toContain('order=desc');
    expect(calls[0].url).toContain('page=2');
    expect(calls[0].url).toContain('limit=25');
  });

  it('skips falsy voivodeship (null) without sending an empty param', async () => {
    mockFetchOnce({ status: 200, body: { data: [], total: 0, page: 1, limit: 50, staleCount: 0 } });
    await fetchFreshnessData({ voivodeship: null, sortBy: 'lastPriceAt' });
    const calls = getFetchCalls();
    expect(calls[0].url).not.toContain('voivodeship=');
    expect(calls[0].url).toContain('sortBy=lastPriceAt');
  });

  it('returns { error } on API failure (does not throw)', async () => {
    mockFetchOnce({ status: 500, textBody: 'boom' });
    const result = await fetchFreshnessData({});
    expect(result.data).toBeUndefined();
    expect(result.error).toBeDefined();
  });
});
