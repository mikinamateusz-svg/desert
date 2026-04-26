/**
 * Tests for the login server action — security-critical because role gating
 * happens here (a non-ADMIN user must NOT get an admin_token cookie).
 *
 * Note on redirect(): Next.js's redirect() throws a special error to
 * interrupt control flow. We mock it to throw a tagged Error so tests can
 * catch and assert on the destination path.
 */
import { mockFetchOnce, mockFetchErrorOnce, resetFetchMock, restoreFetch } from '../../test/fetch-mock';
import { mockCookies, type MockCookieStore } from '../../test/cookie-mock';

jest.mock('next/headers', () => ({
  cookies: jest.fn(),
}));

jest.mock('next/navigation', () => ({
  redirect: jest.fn((path: string) => {
    throw new Error(`__redirect:${path}`);
  }),
}));

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { loginAction } from './actions';

function makeFormData(email: string, password: string): FormData {
  const fd = new FormData();
  fd.set('email', email);
  fd.set('password', password);
  return fd;
}

describe('loginAction', () => {
  let cookieStore: MockCookieStore;

  beforeEach(() => {
    (cookies as jest.Mock).mockReset();
    (redirect as unknown as jest.Mock).mockClear();
    cookieStore = mockCookies({});
    (cookies as jest.Mock).mockResolvedValue(cookieStore);
    resetFetchMock();
  });

  afterAll(() => {
    restoreFetch();
  });

  it('sets admin_token cookie + redirects to /submissions on ADMIN success', async () => {
    mockFetchOnce({
      status: 200,
      body: { accessToken: 'jwt-abc', user: { role: 'ADMIN' } },
    });

    let thrownPath: string | null = null;
    try {
      await loginAction(makeFormData('admin@example.com', 'pw'));
    } catch (e) {
      thrownPath = (e as Error).message; // __redirect:/submissions
    }

    expect(cookieStore.set).toHaveBeenCalledWith(
      'admin_token',
      'jwt-abc',
      expect.objectContaining({ httpOnly: true, sameSite: 'strict', path: '/' }),
    );
    expect(thrownPath).toBe('__redirect:/submissions');
  });

  it('returns { error: "notAdmin" } and does NOT set cookie when user.role is DRIVER', async () => {
    mockFetchOnce({
      status: 200,
      body: { accessToken: 'jwt-abc', user: { role: 'DRIVER' } },
    });

    const result = await loginAction(makeFormData('driver@example.com', 'pw'));
    expect(result).toEqual({ error: 'notAdmin' });
    expect(cookieStore.set).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('returns { error: "generic" } when API responds 2xx without accessToken', async () => {
    mockFetchOnce({ status: 200, body: { user: { role: 'ADMIN' } } });

    const result = await loginAction(makeFormData('a@b.com', 'pw'));
    expect(result).toEqual({ error: 'generic' });
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it('returns { error: "invalid" } on 401', async () => {
    mockFetchOnce({ status: 401, textBody: 'Unauthorized' });
    const result = await loginAction(makeFormData('a@b.com', 'wrong'));
    expect(result).toEqual({ error: 'invalid' });
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it('returns { error: "invalid" } on 400', async () => {
    mockFetchOnce({ status: 400, textBody: 'Bad Request' });
    const result = await loginAction(makeFormData('not-an-email', 'pw'));
    expect(result).toEqual({ error: 'invalid' });
  });

  it('returns { error: "generic" } on 5xx', async () => {
    mockFetchOnce({ status: 500, textBody: 'boom' });
    const result = await loginAction(makeFormData('a@b.com', 'pw'));
    expect(result).toEqual({ error: 'generic' });
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it('returns { error: "generic" } when fetch throws (network error)', async () => {
    mockFetchErrorOnce(new Error('TypeError: fetch failed'));
    const result = await loginAction(makeFormData('a@b.com', 'pw'));
    expect(result).toEqual({ error: 'generic' });
    expect(cookieStore.set).not.toHaveBeenCalled();
  });
});
