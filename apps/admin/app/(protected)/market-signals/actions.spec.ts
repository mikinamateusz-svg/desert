/**
 * Story 4.12 — server-action contract tests for the Market Signals
 * dashboard. Mirrors the station-sync test shape: GET-only fetchers,
 * surfaces AdminApiError messages cleanly, no-throw on failure.
 */
import { mockFetchOnce, resetFetchMock, restoreFetch } from '../../../test/fetch-mock';
import { mockCookies } from '../../../test/cookie-mock';

jest.mock('next/headers', () => ({
  cookies: jest.fn(),
}));

import { cookies } from 'next/headers';
import { fetchHistory, fetchSummary } from './actions';

describe('market-signals actions', () => {
  beforeEach(() => {
    (cookies as jest.Mock).mockReset();
    (cookies as jest.Mock).mockResolvedValue(mockCookies({ admin_token: 'tok' }));
    resetFetchMock();
  });

  afterAll(() => {
    restoreFetch();
  });

  describe('fetchSummary', () => {
    it('returns { data } on 2xx with the typed payload', async () => {
      mockFetchOnce({
        status: 200,
        body: {
          signals: [
            {
              signalType: 'orlen_rack_pb95',
              value: 6.20,
              pctChange: 0.012,
              recordedAt: '2026-05-09T06:00:00.000Z',
              rateSource: null,
            },
            {
              signalType: 'brent_crude_pln',
              value: 1.7754,
              pctChange: 0.04,
              recordedAt: '2026-05-09T06:00:01.000Z',
              rateSource: 'live',
            },
          ],
        },
      });

      const result = await fetchSummary();

      expect(result.data?.signals).toHaveLength(2);
      expect(result.data?.signals[1].rateSource).toBe('live');
    });

    it('returns { error } on API failure (does not throw)', async () => {
      mockFetchOnce({ status: 500, textBody: 'boom' });

      const result = await fetchSummary();

      expect(result.data).toBeUndefined();
      expect(result.error).toBeDefined();
    });
  });

  describe('fetchHistory', () => {
    it('hits the per-signal-type history endpoint with limit query param', async () => {
      mockFetchOnce({
        status: 200,
        body: { signalType: 'orlen_rack_pb95', rows: [] },
      });

      await fetchHistory('orlen_rack_pb95', 30);

      const fetchMock = global.fetch as jest.Mock;
      // Use the LAST call — earlier `fetchSummary` tests in this describe
      // accumulate calls in the shared mock that resetFetchMock doesn't
      // wipe (it only resets the response queue, not call history).
      const lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
      const calledUrl = String(lastCall[0]);
      expect(calledUrl).toContain('/v1/admin/market-signals/orlen_rack_pb95/history');
      expect(calledUrl).toContain('limit=30');
    });

    it('returns { error } on 400 (unknown signal type)', async () => {
      mockFetchOnce({ status: 400, textBody: 'Unknown signalType' });

      const result = await fetchHistory('orlen_rack_pb95', 30);

      expect(result.data).toBeUndefined();
      expect(result.error).toBeDefined();
    });
  });
});
