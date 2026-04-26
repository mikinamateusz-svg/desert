# Story 0.2 — Admin Test Infrastructure

**Epic:** 0 (cross-cutting)
**Status:** ready-for-dev
**Created:** 2026-04-26
**Trigger:** Two prod-affecting bugs in admin app shipped this week with only manual smoke as the safety net (story 4.7 metrics actions.ts ReferenceError; missing `API_URL` env var on staging Vercel). Both are unit-testable. Cost of catching them in CI < cost of finding in staging or prod.

---

## Overview

The `apps/admin` Next.js app has zero automated test coverage today — no Jest/Vitest config, no Playwright config, no test files. Every other app in the monorepo has at least minimal coverage:

- `apps/api` — ~850 Jest unit tests across 51 suites
- `apps/mobile` — 14 Jest unit tests for utility functions
- `apps/web` — 12 Playwright E2E tests in CI

This story bootstraps a **lightweight** Jest + msw test setup for the admin app and writes a focused initial suite that covers the highest-value surfaces: the shared `adminFetch` helper, the security-critical login flow, and one example server action per "shape" (GET-only, GET+params, POST trigger). Subsequent stories that introduce new server actions will add tests using the established pattern.

**Why lightweight, not full backfill?** Once `adminFetch` is tested for status mapping and error handling, every server action that uses it inherits coverage for the dangerous paths. Adding tests for each of the 21 existing server actions × 3 cases each (~10–12h) returns diminishing value vs. testing the helper + one representative action per pattern (~5h, ~80% of the value).

---

## Acceptance Criteria

### AC-1: Jest + ts-jest configured for admin app

**Given** the admin app at `apps/admin/`
**When** `pnpm --filter @desert/admin test` is run
**Then** Jest discovers and executes `*.spec.ts` / `*.spec.tsx` files under `apps/admin/`
**And** ts-jest compiles them with the same `tsconfig.json` as the app (path mappings, JSX, Next.js types)
**And** the test runner exits 0 when all tests pass
**And** Node-environment tests (server actions, lib utilities) and jsdom-environment tests (if any) can coexist via per-file `@jest-environment` hints

### AC-2: msw set up to mock the API layer

**Given** server actions call the API via `adminFetch` → `fetch('${API_URL}/...')`
**When** a test imports the msw setup
**Then** msw intercepts `fetch` calls and returns mocked responses without hitting the real API
**And** the setup supports per-test handler overrides (e.g., `server.use(http.get('/v1/...', () => ...))`) for status-code variations
**And** the global setup is in a single shared file (e.g., `apps/admin/test/msw-setup.ts`) so test files don't repeat boilerplate

### AC-3: `adminFetch` test coverage

**Given** `apps/admin/lib/admin-api.ts` is the shared fetch wrapper used by every server action
**When** unit tests exercise it
**Then** the following paths have explicit assertions:
- 2xx response → returns parsed JSON
- 401 response → throws `AdminApiError` with `status: 401`
- 409 response → throws `AdminApiError` with `status: 409` (used by `triggerSync` for "already running")
- 5xx response → throws `AdminApiError` with `status: 500`
- Network error (fetch throws) → propagates as a thrown error
- Authorization header includes `Bearer <token>` from the `admin_token` cookie
- Authorization header is `Bearer ` (empty) when cookie is absent (unauthenticated path)
- `cache: 'no-store'` is set on every request

### AC-4: Login action test coverage (security-critical)

**Given** `apps/admin/app/login/actions.ts` handles authentication
**When** unit tests exercise `loginAction()`
**Then** the following paths have explicit assertions:
- 2xx response with `accessToken` and `user.role: 'ADMIN'` → sets `admin_token` cookie + redirects to `/submissions`
- 2xx response with `user.role: 'DRIVER'` → returns `{ error: 'notAdmin' }` and does NOT set cookie
- 2xx response missing `accessToken` → returns `{ error: 'generic' }`
- 401 / 400 response → returns `{ error: 'invalid' }`
- 5xx response → returns `{ error: 'generic' }`
- Network error → returns `{ error: 'generic' }`

### AC-5: One server action per shape covered

**Given** the admin server actions follow three repeating shapes
**When** unit tests cover one representative per shape
**Then** the following are tested with happy path + 1 error case each:
- **GET-only fetcher:** `fetchSyncStatus()` from `app/(protected)/station-sync/actions.ts` — returns `{ data }` on 2xx, `{ error }` on failure
- **GET-with-params fetcher:** `fetchFunnelMetrics(period)` from `app/(protected)/metrics/actions.ts` — interpolates the `period` query param correctly + same return shape
- **POST trigger with 409 mapping:** `triggerSync()` from `app/(protected)/station-sync/actions.ts` — 2xx returns `{}`, 409 returns `{ error: 'already_running' }`, other errors return `{ error: <message> }`

### AC-6: Middleware auth gate covered

**Given** `apps/admin/middleware.ts` redirects unauthenticated requests to `/login`
**When** unit tests exercise the middleware
**Then** the following are asserted:
- Request with no `admin_token` cookie + path under `/(protected)` → redirected to `/login`
- Request with `admin_token` cookie + path under `/(protected)` → passes through (no redirect)
- Request to `/login` (no cookie) → passes through (no redirect)

### AC-7: CI integration

**Given** the existing `.github/workflows/ci.yml`
**When** the CI pipeline runs
**Then** `pnpm --filter @desert/admin test` runs as part of the test job
**And** failures fail the build (exit code propagates)
**And** the admin test run completes in under 30 seconds locally on cold cache

### AC-8: Document the pattern

**Given** future stories will add new server actions
**When** a developer adds a new server action
**Then** there is a clear example to follow — either as a comment in the existing test files OR a `apps/admin/test/README.md` showing:
- How to add a new test file
- How to mock a new API endpoint with msw
- The shared helper imports (server-side cookie mocks, msw handlers)

---

## Tasks / Subtasks

- [ ] T1: Bootstrap Jest + ts-jest in `apps/admin/`
  - [ ] T1a: Add `jest`, `ts-jest`, `@types/jest`, `msw` to `apps/admin/package.json` devDependencies
  - [ ] T1b: Create `apps/admin/jest.config.js` mirroring `apps/api/`'s pattern (rootDir, testRegex, transform, moduleNameMapper for `.js` imports)
  - [ ] T1c: Add `"test": "jest"` and `"test:watch": "jest --watch"` to `apps/admin/package.json` scripts
  - [ ] T1d: Verify `pnpm --filter @desert/admin test` runs (will report 0 tests, exit 0)

- [ ] T2: Set up msw shared infrastructure
  - [ ] T2a: Create `apps/admin/test/msw-setup.ts` exporting a configured `setupServer()` instance
  - [ ] T2b: Add a default-deny handler so any unmocked API call fails the test loudly (not silently)
  - [ ] T2c: Add `beforeAll`/`afterEach`/`afterAll` lifecycle helpers that tests can import
  - [ ] T2d: Create `apps/admin/test/cookie-mock.ts` — small helper to mock Next.js `cookies()` in tests (returns a controllable cookie store)

- [ ] T3: `adminFetch` tests (AC-3)
  - [ ] T3a: Create `apps/admin/lib/admin-api.spec.ts`
  - [ ] T3b: Cover 2xx, 401, 409, 500, network-error, with-cookie, without-cookie, cache header

- [ ] T4: Login action tests (AC-4)
  - [ ] T4a: Create `apps/admin/app/login/actions.spec.ts`
  - [ ] T4b: Cover ADMIN success, non-ADMIN role, missing accessToken, 401/400, 5xx, network error
  - [ ] T4c: Mock `cookies()` and assert cookie set/not-set per case
  - [ ] T4d: Mock `redirect()` to assert call without throwing test runner

- [ ] T5: Server action shape tests (AC-5)
  - [ ] T5a: `apps/admin/app/(protected)/station-sync/actions.spec.ts` — `fetchSyncStatus` happy + error; `triggerSync` happy + 409 + error
  - [ ] T5b: `apps/admin/app/(protected)/metrics/actions.spec.ts` — `fetchFunnelMetrics(period)` happy + period interpolation + error

- [ ] T6: Middleware tests (AC-6)
  - [ ] T6a: Create `apps/admin/middleware.spec.ts`
  - [ ] T6b: Cover unauthenticated → redirect, authenticated → pass-through, /login → pass-through

- [ ] T7: CI integration (AC-7)
  - [ ] T7a: Add `pnpm --filter @desert/admin test` to the `test` job in `.github/workflows/ci.yml`
  - [ ] T7b: Verify CI run on a test branch before merge

- [ ] T8: Documentation (AC-8)
  - [ ] T8a: Add a top-of-file comment to `admin-api.spec.ts` showing the msw + cookie-mock pattern
  - [ ] T8b: Optionally a short `apps/admin/test/README.md` with the same example

---

## Dev Notes

### Why Jest (not Vitest)?

Mirrors `apps/api` (Jest + ts-jest) and `apps/mobile` (Jest + ts-jest). Adding Vitest would be a third test runner in the monorepo. Jest works fine for Next.js server actions and lib utilities — the testEnvironment is `node` for these (no React render).

If a future story adds React component tests for admin, jsdom environment can be set per-file via `@jest-environment jsdom` pragma at the top.

### Why msw, not raw `jest.spyOn(global, 'fetch')`?

msw intercepts at the network layer using Service Workers (browser) or fetch-interception (Node). It gives a clean handler-based API that matches per-URL, per-method, with response-shape control. Raw `jest.spyOn(fetch)` works but turns into spaghetti as test counts grow.

Cost: one new dep (`msw`). Bundle size: zero impact (devDep only).

### Mocking Next.js `cookies()` and `redirect()`

Server actions use `import { cookies } from 'next/headers'` and `import { redirect } from 'next/navigation'`. Both must be mocked:

```ts
jest.mock('next/headers', () => ({
  cookies: jest.fn(),
}));
jest.mock('next/navigation', () => ({
  redirect: jest.fn((path: string) => {
    throw new Error(`__redirect:${path}`); // pattern Next.js uses internally
  }),
}));
```

The `redirect()` mock that throws is critical — Next.js's actual `redirect` throws to interrupt control flow. Tests should catch the thrown error and assert on the path.

### Default-deny msw handler

Without this, a test that forgets to mock an endpoint would silently make a real network request (or hit `localhost` and time out). Add a catch-all that throws:

```ts
import { http, HttpResponse } from 'msw';

server.use(
  http.all('*', ({ request }) => {
    throw new Error(`Unmocked request: ${request.method} ${request.url}`);
  }),
);
```

Tests then override with `server.use(http.get('/v1/...', () => HttpResponse.json({ ... })))` per case.

### Path mapping gotcha

`apps/api` jest.config has `moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' }` to handle `.js` imports being remapped to `.ts` source. Admin will need the same — server actions and lib files use the `.js` extension in imports (e.g., `import { adminFetch } from '../../../lib/admin-api'` works without `.js` because Next.js resolution, but if any file does use `.js` the mapper covers it).

### Why deferred from 4.10 (and 4.7)

Both stories' specs include "T4: Tests" but admin had no infra to run them. Rather than ship a one-off Jest config bolted onto whichever story landed first, this story sets up the infra cleanly once.

---

## Non-Goals

- **React component tests for admin pages** — admin is mostly thin server-rendered pages + small client components. Test the server actions; rely on `tsc` + manual smoke for rendering. Revisit if a complex admin UI ships.
- **E2E tests for admin** — Playwright for admin is a separate, larger story. Revisit before partner portal (Epic 7) ships.
- **Coverage thresholds in CI** — set up the runner; coverage gates can be added in a follow-up once the team is comfortable with the pattern.
- **Backfill tests for ALL 21 server actions** — covered explicitly by "lightweight, not full backfill" in the Overview. Subsequent stories add tests for new actions; the existing ones inherit coverage via `adminFetch`.
- **Mock SuperTokens / database** — not in scope; admin server actions only call the API via `adminFetch`. The API tier is responsible for those mocks.

---

## Cost Estimate

- Bootstrap (T1+T2): ~1.5h
- adminFetch tests (T3): ~30min
- Login tests (T4): ~45min
- Shape tests (T5): ~1h
- Middleware (T6): ~30min
- CI (T7): ~30min
- Docs (T8): ~15min
- **Total: ~5h focused work**

---

## References

- Existing Jest setup to mirror: [apps/api/jest config inline in package.json](apps/api/package.json) (lines 58–80)
- Bug that motivated this story (1): commit `ddfdef2` — fix(admin): drop type re-export from metrics 'use server' file
- Bug that motivated this story (2): missing `API_URL` env var on staging Vercel admin (caused metrics 500 — debugged 2026-04-25)
- Memory entry covering the gap: [project_testing.md](C:/Users/Mateusz/.claude/projects/c--Users-Mateusz-projects-desert/memory/project_testing.md) (will need updating once 0.2 ships)
