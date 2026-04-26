/**
 * Helper to mock Next.js `cookies()` from `next/headers` in server-action tests.
 *
 * `cookies()` returns a ReadonlyRequestCookies-shaped object. Tests need to
 * control three things: read a cookie value, observe a `set` call, observe a
 * `delete` call. This helper exposes those as plain Jest mocks so individual
 * tests can assert without re-implementing the boilerplate.
 *
 * Usage in a test file:
 *
 *   jest.mock('next/headers', () => ({ cookies: jest.fn() }));
 *   import { cookies } from 'next/headers';
 *   import { mockCookies } from '../../../test/cookie-mock';
 *
 *   const cookieStore = mockCookies({ admin_token: 'tok-123' });
 *   (cookies as jest.Mock).mockResolvedValue(cookieStore);
 *
 *   // ...action under test...
 *
 *   expect(cookieStore.set).toHaveBeenCalledWith('admin_token', 'new-tok', expect.any(Object));
 */

export interface MockCookieStore {
  get: jest.Mock<{ value: string } | undefined, [string]>;
  set: jest.Mock<void, [string, string, Record<string, unknown>?]>;
  delete: jest.Mock<void, [string]>;
}

export function mockCookies(initial: Record<string, string> = {}): MockCookieStore {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    get: jest.fn((name: string) => {
      const value = store.get(name);
      return value === undefined ? undefined : { value };
    }),
    set: jest.fn((name: string, value: string) => {
      store.set(name, value);
    }),
    delete: jest.fn((name: string) => {
      store.delete(name);
    }),
  };
}
