/**
 * Tests for adminFetch — the shared API wrapper used by every admin server
 * action. Coverage here transitively protects every action's error paths
 * (401 / 409 / 5xx / network) without per-action duplication.
 *
 * Pattern (replicate in any new server-action test file):
 *   1. jest.mock('next/headers', () => ({ cookies: jest.fn() }));
 *   2. (cookies as jest.Mock).mockResolvedValue(mockCookies({ admin_token: 'tok' }));
 *   3. mockFetchOnce({ status: 200, body: { ... } }); // queue the response
 *   4. assert on the return value or thrown AdminApiError;
 *      use getFetchCalls() to inspect the request that was made.
 */
import {
  mockFetchOnce,
  mockFetchErrorOnce,
  resetFetchMock,
  getFetchCalls,
  restoreFetch,
} from '../test/fetch-mock';
import { mockCookies } from '../test/cookie-mock';

jest.mock('next/headers', () => ({
  cookies: jest.fn(),
}));

import { cookies } from 'next/headers';
import { adminFetch, AdminApiError } from './admin-api';

describe('adminFetch', () => {
  beforeEach(() => {
    (cookies as jest.Mock).mockReset();
    (cookies as jest.Mock).mockResolvedValue(mockCookies({ admin_token: 'tok-123' }));
    resetFetchMock();
  });

  afterAll(() => {
    restoreFetch();
  });

  it('returns parsed JSON on 2xx', async () => {
    mockFetchOnce({ status: 200, body: { ok: true, value: 42 } });
    const result = await adminFetch<{ ok: boolean; value: number }>('/v1/test');
    expect(result).toEqual({ ok: true, value: 42 });
  });

  it('throws AdminApiError with status 401 on 401', async () => {
    mockFetchOnce({ status: 401, textBody: 'Unauthorized' });
    await expect(adminFetch('/v1/test')).rejects.toMatchObject({
      name: 'AdminApiError',
      status: 401,
    });
  });

  it('throws AdminApiError with status 409 on 409 (used by triggerSync for already-running)', async () => {
    mockFetchOnce({ status: 409, textBody: 'Conflict' });
    let caught: AdminApiError | undefined;
    try {
      await adminFetch('/v1/test', { method: 'POST' });
    } catch (e) {
      caught = e as AdminApiError;
    }
    expect(caught).toBeInstanceOf(AdminApiError);
    expect(caught?.status).toBe(409);
  });

  it('throws AdminApiError with status 500 on 5xx', async () => {
    mockFetchOnce({ status: 500, textBody: 'boom' });
    await expect(adminFetch('/v1/test')).rejects.toMatchObject({
      name: 'AdminApiError',
      status: 500,
    });
  });

  it('propagates a thrown error when fetch itself fails (network error)', async () => {
    mockFetchErrorOnce(new Error('TypeError: fetch failed'));
    await expect(adminFetch('/v1/test')).rejects.toThrow('fetch failed');
  });

  it('attaches Authorization: Bearer <token> from the admin_token cookie', async () => {
    mockFetchOnce({ status: 200, body: {} });
    await adminFetch('/v1/test');
    const calls = getFetchCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].headers['Authorization']).toBe('Bearer tok-123');
  });

  it('sends Authorization: "Bearer " when cookie is absent (admin_token not set)', async () => {
    (cookies as jest.Mock).mockResolvedValue(mockCookies({}));
    mockFetchOnce({ status: 200, body: {} });
    await adminFetch('/v1/test');
    const calls = getFetchCalls();
    expect(calls[0].headers['Authorization']).toBe('Bearer ');
  });

  it('sets cache: "no-store" so admin pages never serve stale data', async () => {
    mockFetchOnce({ status: 200, body: {} });
    await adminFetch('/v1/test');
    const calls = getFetchCalls();
    expect(calls[0].cache).toBe('no-store');
  });

  it('targets API_URL from env (or http://localhost:3001 default)', async () => {
    mockFetchOnce({ status: 200, body: {} });
    await adminFetch('/v1/some/path');
    const calls = getFetchCalls();
    // API_URL is read at module load; in tests it's either unset (localhost default) or test-set
    expect(calls[0].url).toMatch(/\/v1\/some\/path$/);
  });
});
