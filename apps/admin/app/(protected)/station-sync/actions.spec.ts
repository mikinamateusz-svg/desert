/**
 * Tests for the station-sync server actions. Two shapes covered here:
 *  - GET-only fetcher (fetchSyncStatus)
 *  - POST trigger with 409 mapping (triggerSync)
 *
 * Other GET fetchers (e.g., fetchPipelineHealth, fetchProductMetrics) follow
 * the same pattern as fetchSyncStatus — coverage is via this representative.
 *
 * Notes:
 *  - revalidatePath is mocked because it requires a Next.js request context.
 *  - The 409 → 'already_running' mapping is the only non-trivial business
 *    logic in any admin server action; covered explicitly.
 */
import { mockFetchOnce, resetFetchMock, restoreFetch } from '../../../test/fetch-mock';
import { mockCookies } from '../../../test/cookie-mock';

jest.mock('next/headers', () => ({
  cookies: jest.fn(),
}));
jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
}));

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { fetchSyncStatus, triggerSync } from './actions';

describe('station-sync actions', () => {
  beforeEach(() => {
    (cookies as jest.Mock).mockReset();
    (cookies as jest.Mock).mockResolvedValue(mockCookies({ admin_token: 'tok' }));
    (revalidatePath as jest.Mock).mockClear();
    resetFetchMock();
  });

  afterAll(() => {
    restoreFetch();
  });

  describe('fetchSyncStatus (GET-only fetcher shape)', () => {
    it('returns { data } on 2xx with the typed payload', async () => {
      mockFetchOnce({
        status: 200,
        body: {
          status: 'idle',
          lastCompletedAt: '2026-04-26T10:00:00.000Z',
          lastFailedAt: null,
          stationCount: 1234,
        },
      });

      const result = await fetchSyncStatus();
      expect(result).toEqual({
        data: {
          status: 'idle',
          lastCompletedAt: '2026-04-26T10:00:00.000Z',
          lastFailedAt: null,
          stationCount: 1234,
        },
      });
    });

    it('returns { error } on API failure (does not throw)', async () => {
      mockFetchOnce({ status: 500, textBody: 'boom' });
      const result = await fetchSyncStatus();
      expect(result.data).toBeUndefined();
      expect(result.error).toBeDefined();
    });
  });

  describe('triggerSync (POST trigger with 409 mapping shape)', () => {
    it('returns {} on 2xx (sync queued successfully)', async () => {
      mockFetchOnce({ status: 202, body: { status: 'queued', jobId: 'j1' } });
      const result = await triggerSync();
      expect(result).toEqual({});
      expect(revalidatePath).toHaveBeenCalledWith('/station-sync');
    });

    it('returns { error: "already_running" } on 409 (sync already in progress)', async () => {
      mockFetchOnce({ status: 409, textBody: 'Conflict' });
      const result = await triggerSync();
      expect(result).toEqual({ error: 'already_running' });
      // revalidatePath should NOT be called when the trigger was rejected
      expect(revalidatePath).not.toHaveBeenCalled();
    });

    it('returns { error: <message> } on other API errors (e.g. 500)', async () => {
      mockFetchOnce({ status: 500, textBody: 'boom' });
      const result = await triggerSync();
      expect(result.error).toBeDefined();
      expect(result.error).not.toBe('already_running');
      expect(revalidatePath).not.toHaveBeenCalled();
    });
  });
});
