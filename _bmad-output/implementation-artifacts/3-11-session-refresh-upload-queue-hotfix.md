# Story 3.11: Session Refresh & Upload-Queue Hotfix

**Status:** ready-for-dev (implemented 2026-04-21)
**Trigger:** Field test on 2026-04-21 — ~10 photos captured during a bike ride stayed stuck in the local queue, and the Activity screen showed "Nie udało się załadować zgłoszeń". Railway logs showed a single `SessionError: Failed to verify access token` with `type: 'TRY_REFRESH_TOKEN'`.

---

## Root Cause

SuperTokens issues short-lived access tokens (~1 h TTL) alongside long-lived refresh tokens. The API was only returning the access token to the mobile client — the refresh token was discarded. The mobile client had no refresh flow at all; its stored access token was used until it expired, after which every authenticated call would 401.

Worse, [`apps/mobile/src/api/submissions.ts`](apps/mobile/src/api/submissions.ts) treated **any** 401 as a `PermanentUploadError`:

```ts
if (res.status === 400 || res.status === 401 || res.status === 403) {
  throw new PermanentUploadError(res.status);
}
```

The queue processor then called `markFailed()` and the photo was effectively lost — no automatic retry, not even after the user re-opened the app. The Activity screen hit the same expired-token path, which is why it showed its error state at the same time.

**Net effect:** once the session's access token expired (quietly, mid-ride), every subsequent queued photo died on the first upload attempt. Without field testing this would have bitten every alpha user within an hour of login.

---

## Fix

### API — refresh-token endpoint and propagation

- `AuthService` sign-in methods (`register`, `login`, `googleSignIn`, `appleSignIn`) now return both `accessToken` **and** `refreshToken`, pulled from `session.getAllSessionTokensDangerously()`.
- New method `AuthService.refreshSession(refreshToken)` wraps SuperTokens' `Session.refreshSessionWithoutRequestResponse(refreshToken, true)` — the `true` disables anti-CSRF since we use Bearer tokens on mobile. Rotates the refresh token per SuperTokens best practice; falls back to the incoming refresh token if the server returns no new one.
- On refresh failure, throws `UnauthorizedException` with `error: 'REFRESH_TOKEN_INVALID'` — client treats this as "force re-login".
- New endpoint `POST /v1/auth/refresh` (public route) accepting `{ refreshToken }` and returning `{ accessToken, refreshToken }`.
- `RefreshDto` validates the body with `class-validator`.

### Mobile — secure storage, refresh flow, retriable error

- `secure-storage.ts` — new `saveRefreshToken`, `getRefreshToken`, `deleteRefreshToken` functions alongside the existing access-token helpers.
- `api/auth.ts` — `AuthResponse.refreshToken: string | null`, new `apiRefreshSession(refreshToken)` → `/v1/auth/refresh`.
- `auth.store.ts`:
  - All sign-in flows now persist the refresh token via `persistSession(res)` helper.
  - `logout` clears both tokens.
  - New `refreshSession()` action: reads stored refresh token, POSTs to `/v1/auth/refresh`, saves new tokens, updates in-memory `accessToken` state. On failure, clears both tokens and sets `user=null` so the next authenticated path prompts re-login.
  - **De-duping:** concurrent callers (queue processor + Activity screen both 401ing at the same time) share a single `refreshInFlight` promise, preventing duplicate `/v1/auth/refresh` roundtrips.
  - **Module-level accessor:** `refreshSessionFromModule()` exposed so non-React callers (queue processor, background tasks) can drive the refresh without reaching into React context. Populated by `AuthProvider` via a `useEffect`.
- `api/submissions.ts`:
  - New `TokenExpiredError` class — distinct from `PermanentUploadError`.
  - New `is401RefreshSignal(res)` helper that clones the 401 response and checks the body for `TRY_REFRESH_TOKEN` or `try refresh token` (covers both SuperTokens signal formats).
  - `uploadSubmission`: 401 + refresh-signal → `TokenExpiredError` (retriable); 401 without signal → `PermanentUploadError` (genuine auth failure).
  - `request<T>` (used by `apiGetSubmissions`) applies the same 401 detection — fixes the Activity screen.
- `queueProcessor.ts`:
  - On `TokenExpiredError`: call `refreshSessionFromModule()`, retry the current entry once with the new access token.
  - If the retry still fails: `PermanentUploadError` → `markFailed`, transient → `markRetry`.
  - If refresh itself fails (no refresh token or server rejected): `markRetry` for this entry (NOT `markFailed` — user may re-login later and we want the photo to upload then) and break out of the loop (the remaining entries would all hit the same dead session).

### Mobile — one-off recovery migration

- `queueDb.ts` — new `unfailAllQueueEntries()` SQL: `UPDATE capture_queue SET status = 'pending', retry_count = 0, next_retry_at = NULL WHERE status = 'failed'`. Returns the row count.
- `queueProcessor.startQueueProcessor()` calls it on boot. Logs the number revived. Safe to run every boot — genuine future failures will re-fail on their own retries.
- Net effect for existing field-test install: the 10 stuck photos flip back to `pending` on next app open, the fresh refresh-token handling ensures they upload successfully.

---

## Acceptance Criteria

**AC1 — Access token is paired with a refresh token end-to-end:**
Given a user signs up, logs in, or uses Google/Apple sign-in,
When the server responds,
Then the response body includes both `accessToken` and `refreshToken`, and the client persists both to `SecureStore`.

**AC2 — Expired access token triggers silent refresh:**
Given the stored access token has expired,
When the client makes an authenticated request and receives 401 with `type: 'TRY_REFRESH_TOKEN'`,
Then the client calls `POST /v1/auth/refresh` with the stored refresh token, persists the rotated tokens, and retries the original request with the new access token — all transparently to the user.

**AC3 — Queued uploads survive token expiry:**
Given one or more photos are queued and the access token expires between capture and processing,
When `processQueue()` runs,
Then each queued entry is refreshed-and-retried once; successful uploads clear normally, and a failed refresh leaves the entry in `pending` state (not permanently failed) so a later re-login recovers it.

**AC4 — Genuine auth failures remain permanent:**
Given a queue upload gets a 401 without the `TRY_REFRESH_TOKEN` signal (genuinely unauthorized — e.g. user was deleted server-side),
When `processQueue()` processes it,
Then the entry is marked `failed` and will not retry automatically.

**AC5 — Refresh failure forces re-login flow:**
Given the refresh token is itself expired or invalid,
When `apiRefreshSession()` returns 401,
Then the client clears both stored tokens and the in-memory user state — the next screen transition naturally prompts a login.

**AC6 — Concurrent refreshes are de-duped:**
Given the queue processor and the Activity screen both receive 401+refresh-signal responses within the same second,
When they both invoke `refreshSession()`,
Then exactly one `POST /v1/auth/refresh` request hits the server (the second caller awaits the in-flight promise).

**AC7 — One-off recovery for field-test casualties:**
Given an app version that used the old 401-as-permanent logic left some queue entries in `status='failed'`,
When the user updates to the fixed version and opens the app,
Then those entries are flipped back to `status='pending'` on boot and processed normally once connectivity and auth are healthy.

---

## Out of Scope (Future)

- Proactive refresh before expiry (currently lazy — triggered by 401 on the first authenticated call after expiry).
- Biometric re-authentication on long sessions (deferred — covered by Story 1.11 if ever prioritised).
- Telemetry on refresh failures (would be nice signal for catching future regressions; bundle into Epic 4 analytics story).

---

## Files Touched

### API
- `apps/api/src/auth/auth.service.ts` — four sign-in methods return `refreshToken`; new `refreshSession` method
- `apps/api/src/auth/auth.service.spec.ts` — session mocks add `getAllSessionTokensDangerously`; new `refreshSession` test block
- `apps/api/src/auth/auth.controller.ts` — new `POST /refresh` endpoint
- `apps/api/src/auth/auth.controller.spec.ts` — new `refresh` test block
- `apps/api/src/auth/dto/refresh.dto.ts` — new DTO

### Mobile
- `apps/mobile/src/lib/secure-storage.ts` — refresh-token persistence
- `apps/mobile/src/api/auth.ts` — `refreshToken` on `AuthResponse`; new `apiRefreshSession`
- `apps/mobile/src/store/auth.store.ts` — `persistSession` helper, `refreshSession` action, module-level accessor
- `apps/mobile/src/api/submissions.ts` — `TokenExpiredError`, `is401RefreshSignal`, updated `uploadSubmission` and `request` error mapping
- `apps/mobile/src/services/queueProcessor.ts` — refresh-and-retry loop, boot-time un-fail migration call
- `apps/mobile/src/services/queueDb.ts` — `unfailAllQueueEntries()`

### Story spec
- `_bmad-output/implementation-artifacts/3-11-session-refresh-upload-queue-hotfix.md` — this file
