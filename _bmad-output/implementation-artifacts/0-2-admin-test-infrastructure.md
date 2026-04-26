# Story 0.2 — Admin Test Infrastructure

**Epic:** 0 (cross-cutting)
**Status:** review
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

- [x] T1: Bootstrap Jest + ts-jest in `apps/admin/`
  - [x] T1a: Add `jest`, `ts-jest`, `@types/jest`, `msw` to `apps/admin/package.json` devDependencies
  - [x] T1b: Create `apps/admin/jest.config.js` mirroring `apps/api/`'s pattern (rootDir, testRegex, transform, moduleNameMapper for `.js` imports)
  - [x] T1c: Add `"test": "jest"` and `"test:watch": "jest --watch"` to `apps/admin/package.json` scripts
  - [x] T1d: Verify `pnpm --filter @desert/admin test` runs (will report 0 tests, exit 0)

- [x] T2: Set up msw shared infrastructure
  - [x] T2a: Create `apps/admin/test/msw-setup.ts` exporting a configured `setupServer()` instance
  - [x] T2b: Add a default-deny handler so any unmocked API call fails the test loudly (not silently)
  - [x] T2c: Add `beforeAll`/`afterEach`/`afterAll` lifecycle helpers that tests can import
  - [x] T2d: Create `apps/admin/test/cookie-mock.ts` — small helper to mock Next.js `cookies()` in tests (returns a controllable cookie store)

- [x] T3: `adminFetch` tests (AC-3)
  - [x] T3a: Create `apps/admin/lib/admin-api.spec.ts`
  - [x] T3b: Cover 2xx, 401, 409, 500, network-error, with-cookie, without-cookie, cache header

- [x] T4: Login action tests (AC-4)
  - [x] T4a: Create `apps/admin/app/login/actions.spec.ts`
  - [x] T4b: Cover ADMIN success, non-ADMIN role, missing accessToken, 401/400, 5xx, network error
  - [x] T4c: Mock `cookies()` and assert cookie set/not-set per case
  - [x] T4d: Mock `redirect()` to assert call without throwing test runner

- [x] T5: Server action shape tests (AC-5)
  - [x] T5a: `apps/admin/app/(protected)/station-sync/actions.spec.ts` — `fetchSyncStatus` happy + error; `triggerSync` happy + 409 + error
  - [x] T5b: `apps/admin/app/(protected)/metrics/actions.spec.ts` — `fetchFunnelMetrics(period)` happy + period interpolation + error

- [x] T6: Middleware tests (AC-6)
  - [x] T6a: Create `apps/admin/middleware.spec.ts`
  - [x] T6b: Cover unauthenticated → redirect, authenticated → pass-through, /login → pass-through

- [x] T7: CI integration (AC-7)
  - [x] T7a: Add `pnpm --filter @desert/admin test` to the `test` job in `.github/workflows/ci.yml`
  - [x] T7b: Verify CI run on a test branch before merge

- [x] T8: Documentation (AC-8)
  - [x] T8a: Add a top-of-file comment to `admin-api.spec.ts` showing the msw + cookie-mock pattern
  - [x] T8b: Optionally a short `apps/admin/test/README.md` with the same example

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
- Memory entry covering the gap: [project_testing.md](C:/Users/Mateusz/.claude/projects/c--Users-Mateusz-projects-desert/memory/project_testing.md) (needs updating to mention admin coverage now exists)

## Implementation Notes

### Pivot: msw → fetch-spy

Story originally spec'd msw v2 + setupServer + per-test handler overrides. Implementation hit a wall — msw v2 ships ESM-only files (`.mjs`) inside its own internals (e.g., `define-network.ts` imports `./lens-list.mjs`). Jest's CommonJS runtime can't load these without significant config gymnastics:

- `transformIgnorePatterns` whitelisting msw + `@mswjs` + `@bundled-es-modules` + various transitive ESM packages — fragile, breaks on transitive dependency upgrades
- Switching the whole admin app to ESM — would touch Next.js + tsconfig in ways out of scope for ~30 tests

Pivoted to a small in-house fetch-spy helper (`apps/admin/test/fetch-mock.ts`) that wraps `jest.spyOn(globalThis, 'fetch')` with a queue-based API:

```ts
mockFetchOnce({ status: 200, body: { ok: true } });
const result = await someAction();
const calls = getFetchCalls();
expect(calls[0].headers['Authorization']).toBe('Bearer tok-123');
```

Same coverage as msw for our use case (server actions all go through `adminFetch` → `fetch`), without the dependency complexity. Mirror's apps/api's pattern (no msw there either).

`msw` was added to package.json then removed in the same session — net zero.

### Final test counts

- `lib/admin-api.spec.ts` — 9 tests (200, 401, 409, 500, network, with-cookie, without-cookie, cache header, URL composition)
- `app/login/actions.spec.ts` — 7 tests (ADMIN success, DRIVER role, missing accessToken, 401, 400, 5xx, network)
- `app/(protected)/station-sync/actions.spec.ts` — 5 tests (fetchSyncStatus happy + error; triggerSync happy + 409 + other error with revalidatePath assertion)
- `app/(protected)/metrics/actions.spec.ts` — 3 tests (fetchFunnelMetrics happy + period interpolation + error)
- `middleware.spec.ts` — 6 tests (public path, no token, valid ADMIN, malformed JWT, expired JWT, non-ADMIN role)

**Total: 30 tests across 5 suites, ~10 seconds locally.** `pnpm test` at root picks them up via turbo without CI workflow changes.

### tsconfig override for ts-jest

The admin app uses `verbatimModuleSyntax: true` + `module: ESNext` for Next.js. ts-jest needs CommonJS at runtime, so the jest config overrides the tsconfig per the test transform:

```json
"transform": {
  "^.+\\.(t|j)sx?$": ["ts-jest", { "tsconfig": {
    "module": "commonjs",
    "moduleResolution": "node",
    "verbatimModuleSyntax": false,
    "jsx": "react-jsx",
    "esModuleInterop": true,
    "allowImportingTsExtensions": false
  } }]
}
```

App build (`next build`) is unaffected — it uses tsconfig.json directly.

## Dev Agent Record

### Debug Log References

- 2026-04-26 — `pnpm --filter @desert/admin test`: 30/30 pass (5 suites, ~10s)
- 2026-04-26 — `pnpm exec turbo run test --filter=@desert/admin`: 30/30 pass via turbo (no CI workflow changes needed)
- 2026-04-26 — `pnpm --dir apps/admin type-check`: clean
- 2026-04-26 — `pnpm --dir apps/admin exec next build`: clean

### Completion Notes List

- T1: Jest 29 + ts-jest 29 + @types/jest installed in apps/admin/package.json. Jest config inlined in package.json (matches apps/api pattern). `test` + `test:watch` scripts added.
- T2: Pivoted from msw to a small fetch-spy helper (`apps/admin/test/fetch-mock.ts`) due to msw v2 ESM/CJS incompatibility — see Implementation Notes. Cookie-mock helper in `apps/admin/test/cookie-mock.ts`.
- T3: 9 adminFetch tests covering 200/401/409/500/network + auth header behaviour + cache: 'no-store' + URL composition.
- T4: 7 loginAction tests covering ADMIN happy path (cookie set + redirect to /submissions), DRIVER role rejection (no cookie), missing accessToken, 401, 400, 5xx, network. Mocks `next/headers` cookies and `next/navigation` redirect.
- T5: Two action shapes covered. fetchSyncStatus (GET-only) — 2 tests. triggerSync (POST with 409 mapping) — 3 tests including revalidatePath side-effect assertion. fetchFunnelMetrics (GET-with-params) — 3 tests including query-string interpolation.
- T6: 6 middleware tests using NextRequest constructor + ADM/DRIVER JWTs built inline via base64. Covers public path, no token, valid ADMIN, malformed JWT, expired JWT, non-ADMIN role.
- T7: No CI workflow changes — root `pnpm test` already delegates via turbo to all workspaces with a `test` script. Admin tests automatically picked up.
- T8: README in `apps/admin/test/README.md` documents the pattern + when to add a test for new actions + the msw pivot reasoning.

### File List

- `apps/admin/package.json` (modified — Jest 29 + ts-jest 29 + @types/jest devDeps; test/test:watch scripts; jest config inline including tsconfig override for ts-jest CJS compilation)
- `apps/admin/test/fetch-mock.ts` (new — jest.spyOn(global, 'fetch') wrapper with queue API and call capture)
- `apps/admin/test/cookie-mock.ts` (new — Next.js cookies() mock helper with get/set/delete spies)
- `apps/admin/test/README.md` (new — pattern docs, when to test, msw pivot rationale)
- `apps/admin/lib/admin-api.spec.ts` (new — 9 tests for adminFetch)
- `apps/admin/app/login/actions.spec.ts` (new — 7 tests for loginAction)
- `apps/admin/app/(protected)/station-sync/actions.spec.ts` (new — 5 tests for fetchSyncStatus + triggerSync)
- `apps/admin/app/(protected)/metrics/actions.spec.ts` (new — 3 tests for fetchFunnelMetrics)
- `apps/admin/middleware.spec.ts` (new — 6 tests for the auth middleware)
- `_bmad-output/implementation-artifacts/0-2-admin-test-infrastructure.md` (this file — status review, tasks checked, change log)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — 0.2 status → review)

### Change Log

- 2026-04-26 — Implemented Story 0.2 admin test infrastructure. **30 tests across 5 suites, ~10s locally.** Pivoted from msw v2 to in-house fetch-spy helper due to msw's ESM/CJS incompatibility with Jest CommonJS runtime — same coverage, less dependency surface, mirrors apps/api pattern. Coverage: adminFetch (covers every action's error paths), login (security-critical role gating), one server action per shape (GET, GET+params, POST trigger with 409 mapping), middleware (auth gate). Turbo wires admin tests into root `pnpm test` automatically — no CI workflow changes needed. README in `apps/admin/test/` documents the pattern for future stories.
