# Admin app tests

Jest + ts-jest, no msw (msw v2's ESM internals don't play with Jest's CommonJS runtime without significant config gymnastics — we use a small fetch-mock helper instead).

## Run

```bash
pnpm --filter @desert/admin test          # one-shot
pnpm --filter @desert/admin test:watch    # watch mode
```

Also runs as part of root `pnpm test` (via turbo) and in CI.

## Layout

```
apps/admin/
  test/
    fetch-mock.ts        # jest.spyOn(global, 'fetch') wrapper with a queue API
    cookie-mock.ts       # Mock for Next.js cookies() — get/set/delete spies
    README.md            # you are here
  lib/
    admin-api.spec.ts    # adminFetch tests — covers every action's error paths transitively
  app/
    login/
      actions.spec.ts    # loginAction tests — security-critical (role gating, cookie set)
    (protected)/
      station-sync/
        actions.spec.ts  # GET-only fetcher + POST trigger with 409 mapping shapes
      metrics/
        actions.spec.ts  # GET-with-params fetcher shape
  middleware.spec.ts     # auth gate (public path, no token, valid/expired/wrong-role JWT)
```

## Adding a test for a new server action

For most new actions you don't need a test — `adminFetch` already covers every error path (401, 409, 5xx, network) for any action that uses it. Add an action-specific test when the action has its **own** non-trivial logic, such as:

- A non-default error mapping (e.g. `triggerSync`'s 409 → `'already_running'`)
- Query-string interpolation that could break (escape sequences, missing params)
- A side effect like `revalidatePath()` or `redirect()` you want to assert on

Pattern (copy from `station-sync/actions.spec.ts`):

```ts
import { mockFetchOnce, resetFetchMock, restoreFetch } from '../../../test/fetch-mock';
import { mockCookies } from '../../../test/cookie-mock';

jest.mock('next/headers', () => ({ cookies: jest.fn() }));
// jest.mock('next/cache', () => ({ revalidatePath: jest.fn() })); // if needed
// jest.mock('next/navigation', () => ({                            // if needed
//   redirect: jest.fn((p: string) => { throw new Error(`__redirect:${p}`); }),
// }));

import { cookies } from 'next/headers';
import { yourAction } from './actions';

describe('yourAction', () => {
  beforeEach(() => {
    (cookies as jest.Mock).mockReset();
    (cookies as jest.Mock).mockResolvedValue(mockCookies({ admin_token: 'tok' }));
    resetFetchMock();
  });
  afterAll(() => { restoreFetch(); });

  it('happy path', async () => {
    mockFetchOnce({ status: 200, body: { /* shape */ } });
    const result = await yourAction(/* args */);
    expect(result).toEqual({ data: { /* shape */ } });
  });

  it('error path', async () => {
    mockFetchOnce({ status: 500, textBody: 'boom' });
    const result = await yourAction(/* args */);
    expect(result.error).toBeDefined();
  });
});
```

## Mocking notes

### Why fetch-spy and not msw

msw v2 ships ESM-only files (`.mjs`) inside `node_modules/msw` that Jest's CommonJS runtime can't transform via `transformIgnorePatterns` whitelisting alone. Switching the whole admin app to ESM would touch Next.js config and tsconfig in ways that aren't worth the trade for ~30 tests. `jest.spyOn(global, 'fetch')` covers the same ground.

### Why cookie-mock instead of jest.fn() inline

Server actions call `cookies()` once, sometimes read multiple keys, and may call `set()` / `delete()`. The helper bundles that into a single source of truth that asserts cleanly.

### `redirect()` mock pattern

Next.js's actual `redirect()` throws to interrupt control flow. We mirror that:

```ts
jest.mock('next/navigation', () => ({
  redirect: jest.fn((path: string) => {
    throw new Error(`__redirect:${path}`);
  }),
}));
```

In the test, wrap the action call in try/catch and assert on the message:

```ts
let thrownPath: string | null = null;
try {
  await loginAction(formData);
} catch (e) {
  thrownPath = (e as Error).message;
}
expect(thrownPath).toBe('__redirect:/submissions');
```

## Coverage philosophy

The test suite is intentionally **not** exhaustive across every action. The bet:

- `adminFetch` is covered for every status class (200/401/409/500/network)
- Login is covered fully (security-critical — role gating, cookie set)
- Middleware is covered (security-critical — UX gate)
- One action per "shape" (GET / GET-with-params / POST-trigger-with-409) is covered

Adding tests for the remaining 18+ actions × 3 cases each was scoped explicitly out — see Story 0.2 for the cost-benefit reasoning. Open the next story for re-prioritisation if a bug class slips through that this strategy doesn't catch.
