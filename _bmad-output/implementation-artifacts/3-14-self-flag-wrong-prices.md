# Story 3.14: Self-Flag Wrong Prices (Driver-Initiated Withdrawal)

Status: ready-for-dev

**Trigger:** 2026-05-06 field test — drivers spotted incorrect OCR'd prices on the map after their submission verified, but had no way to recover. Re-photographing the same station was silently dedup'd, so bad data persisted until admin happened to review it. We need a self-correction path.

**Phase:** 1 (pre-launch quality loop). Coupled stories — out of scope here: 3.15 (optimistic activity UI), 3.16 (consensus-based dedup), 3.17 (deeper activity-row status polish).

---

## Story

As a **driver**,
I want to flag my own verified submission as containing wrong prices and immediately retake the photo,
so that I can fix incorrect data without waiting for admin review and without other drivers seeing the bad numbers.

### Why

The current pipeline assumes the OCR'd prices are right unless an admin says otherwise. Three failure modes the user experiences today:
- The driver standing at the station knows the true prices and is best placed to spot a misread — but has no UI affordance.
- The 12h station dedup (Story 3.10) blocks any retake after the first verified submission, so the driver can't even self-correct via re-photo.
- Bad prices stay live on the map until admin happens to look (could be hours/days), eroding trust.

The fix is a self-correction loop: driver flags → submission withdrawn from production immediately → previous prices restored → dedup lifted → driver invited to retake. Admin still reviews the flagged submission to learn from misreads, but production data quality recovers in seconds, not hours.

This is also the foundation for Story 3.16 (consensus-based dedup) — once we trust drivers to self-correct, we can be more permissive about accepting their corrections without immediately replacing existing prices.

---

## Acceptance Criteria

**AC1 — Flag-wrong button on activity row:**
Given a driver opens the Activity screen,
And the row is `verified`,
And the row was submitted by this user within the last 24h,
And no flag-wrong action has been taken on this submission yet,
When the row renders,
Then a small `Złe ceny?` text button is visible on the row, right-aligned, distinct from the row's tap target (the row body still navigates to the station sheet).

If display space is tight on smaller screens, fall back to an icon button with the same accessibility label.

**AC2 — One-tap → confirmation sheet:**
Given the driver taps the flag-wrong button,
When the action fires,
Then a confirmation modal appears asking:
- Title: *Wycofać to zgłoszenie?* ("Withdraw this submission?")
- Body: *Inni kierowcy zobaczą poprzednie ceny, dopóki nie sprawdzimy zdjęcia. Możesz od razu zrobić nowe zdjęcie.*
- Two buttons: `Anuluj` (left, secondary) / `Wycofaj` (right, primary).

The driver must explicitly tap `Wycofaj` to commit — single-tap on the row button alone never triggers the action.

**AC3 — Endpoint accepts flag, transitions submission, restores prices:**
Given the driver confirms `Wycofaj`,
When the mobile app `POST`s `/v1/submissions/:id/flag-wrong`,
Then the API:
- Verifies the caller owns the submission (`403` otherwise);
- Verifies status is `verified` (`409` if already withdrawn or rejected — idempotent UI handling);
- Verifies `created_at` is within the last 24h for non-admin callers (`400` outside window; admins bypass per AC10);
- Atomically transitions: `status: shadow_rejected`, `flag_reason: 'user_flagged_wrong'` (guarded by `WHERE status='verified'` so concurrent admin actions return `409`);
- Recomputes the station's price cache:
  - Find the previous-newest `verified` submission for this `station_id` (excluding this submission);
  - If found, write its `price_data` via `priceService.setVerifiedPrice` (replaces cache + adds `PriceHistory` row);
  - If not found, invalidate cache so the read-path falls back through `appendEstimated`;
- Lifts dedup: deletes `dedup:station:{stationId}` and `dedup:hash:{photoHash}` from Redis (best-effort, log on failure but don't block);
- Writes audit log entry (`AdminAuditLog`, action `USER_FLAGGED_WRONG`, `submission_id` set, `notes` JSON includes `previous_status`, `restored_from_submission_id`, `actor_role`);
- Returns `200 { status: 'withdrawn' }`.

**AC4 — Thank-you screen with retake CTA:**
Given the API returns `200`,
When the mobile app handles the response,
Then it navigates to a dedicated thank-you screen (`/(app)/flag-wrong-thanks`) showing:
- Title: *Przepraszamy — to nasza wina.*
- Body: *Sprawdzimy zdjęcie, żeby poprawić rozpoznawanie. Zachęcamy do zrobienia nowego — z bliska lub pod lepszym kątem to bardzo pomaga.*
- Primary button: *Zrób nowe zdjęcie* → navigates to `/(app)/capture`.
- Secondary link: *Wróć do aktywności* → navigates back to `/(app)/activity`.

No auto-dismiss — the driver decides next move.

**AC5 — Reason-aware copy on shadow_rejected rows (all known reasons):**
The current `SubmissionRow.tsx` renders nothing for `shadow_rejected` — just station name + date, no status indicator. This story closes that hole for every `flag_reason` value in production today, so the activity screen has consistent copy for all post-3.14 paths.

Given a row's `status === 'shadow_rejected'`,
When the activity screen re-renders,
Then the prices line is replaced with a flag-reason-specific italic note:
- `flag_reason === 'user_flagged_wrong'` → *Wycofane — w trakcie przeglądu* ("Withdrawn — under review")
- `flag_reason === 'price_conflict'` (from Story 3.16) → *Sprawdzamy zgodność cen* ("Checking price match")
- any other `flag_reason` (rule-based shadow_rejects from Story 3.7) → *W trakcie przeglądu* ("Under review")

And the flag-wrong button is hidden on these rows (action no longer applies once status has moved past `verified`).

Deeper polish (per-rule-code copy, tap-to-explain modals, status timelines) is deferred to Story 3.17.

**AC6 — Auto-resolve when driver re-submits at same station:**
Given the driver has flagged submission `A` for station `X`,
And `A` is now `shadow_rejected` with `flag_reason: 'user_flagged_wrong'`,
When the same driver submits a new photo at station `X` that verifies successfully (submission `B`),
Then submission `A` is automatically marked `rejected` with `flag_reason: 'auto_resolved_by_resubmit'`,
And `A` is removed from the admin shadow-rejected queue,
And no admin action is required.

The auto-resolve fires from the photo pipeline worker right after submission `B`'s `setVerifiedPrice` succeeds. The cleanup query: rows with `user_id = B.user_id`, `station_id = B.station_id`, `status = 'shadow_rejected'`, `flag_reason = 'user_flagged_wrong'`, `created_at >= now() - 7d`, `id != B.id`. Best-effort — failure to auto-resolve does not block submission `B`'s verification.

Each auto-resolution writes an `AdminAuditLog` entry with action `AUTO_RESOLVED_BY_RESUBMIT` and `notes: { resolved_by_submission_id: B.id }`.

**AC7 — Idempotency / rate limiting:**
Given the driver taps `Wycofaj`,
When the request is in flight,
Then the button is disabled (visual: `ActivityIndicator` replaces the label) to prevent double-submit.

Given a second request arrives for the same submission already in `shadow_rejected`,
When the API processes it,
Then the response is `409 Conflict` with no DB change.

Per-user rate limit: **5 flag-wrong actions per hour** (`HTTP 429` beyond), enforced via `@Throttle({ default: { ttl: 3600, limit: 5 } })` on the controller method — same pattern as `apps/api/src/feedback/feedback.controller.ts`.

**AC8 — Audit trail:**
Given any flag-wrong action succeeds,
When the action commits,
Then an `AdminAuditLog` row is written with:
- `action`: `USER_FLAGGED_WRONG`,
- `submission_id`: the flagged submission,
- `admin_user_id`: the actor's `user_id` (text column, no FK — already a misnomer for the user-flag case but acceptable for v1; rename deferred),
- `notes`: JSON `{ previous_status: 'verified', restored_from_submission_id: <uuid>|null, actor_role: 'DRIVER'|'ADMIN' }`.

Audit log write is wrapped in `.catch()` — a write failure is logged but does **not** block the flag action (the user-facing transition is more important than the audit trail).

**AC9 — Admin queue display:**
Given admin opens the shadow-rejected list at `/admin/submissions`,
When a row has `flag_reason: 'user_flagged_wrong'`,
Then the row's flag-reason chip uses the existing `flag_reason` translation map; copy comes from `apps/admin/lib/i18n.ts` (PL: *Zgłoszone przez kierowcę*, EN: *Flagged by driver*).

No new admin UI in this story — the existing shadow-rejected queue handles all flag reasons through the same approve/reject path. The audit metadata (which user flagged + restored-from id) is visible in the existing detail view via the `notes` JSON.

**AC10 — Admin bypass exception:**
Users with role `ADMIN` are exempt from both:
- The 24h-window check (AC3) — admins can flag any of their own submissions regardless of age, useful for cleaning up legacy bad data during testing/moderation.
- The 5/hour rate limit — admins doing field tests or bulk moderation may need to flag many submissions in a short period (the throttle decorator applies to all callers; admins bypass via the service-layer role check).

The `flagWrong` service method receives the caller's role and skips both window + rate checks when `role === UserRole.ADMIN`. Audit log entry still records the action so the bypass leaves a trail.

**AC11 — Preserve Story 4.3 shadow_banned secrecy invariant:**
Given a shadow-banned user submits a photo (per Story 4.3, the API silently creates a `shadow_rejected` record with `flag_reason: 'shadow_banned'`),
When that user fetches their activity log,
Then the row continues to show as `pending` on the wire (NOT `shadow_rejected`),
And `flag_reason` is laundered to `null` in the response,
And no flag-wrong button is rendered on it (since the client sees `pending`, not `verified`).

This is preserved by the `getMySubmissions` mapping: the `shadow_rejected → pending` laundering only fires when `flag_reason === 'shadow_banned'`. Every other `shadow_rejected` reason — `user_flagged_wrong`, `price_conflict`, rule-based — passes through unchanged so AC5 copy can render.

---

## Tasks / Subtasks

Numbered for sequencing. Two slices to keep PR review tractable:

### Backend slice (T1–T7)

- [ ] **T1 — `SubmissionDedupService.liftDedup` method (AC: 3)**
  - [ ] Add public method `liftDedup(stationId: string|null, photoHash: string|null): Promise<void>` to `apps/api/src/photo/submission-dedup.service.ts`.
  - [ ] Use `Promise.allSettled([redis.del(stationKey), redis.del(hashKey)])`. Skip `redis.del` calls when the corresponding ID is `null` (no-op when both null).
  - [ ] On per-promise rejection, log a warning via `this.logger.warn` but never throw — best-effort semantics so a Redis blip never fails a flag-wrong action.
  - [ ] Tests in `submission-dedup.service.spec.ts`: both keys, single-null inputs, both-null no-op, single Redis failure, all Redis failures.
  - [ ] See 3-10-submission-deduplication.md addendum for full AC.

- [ ] **T2 — `SubmissionsService.flagWrong` method (AC: 3, 7, 8, 10)**
  - [ ] Add `flagWrong(submissionId, actorUserId, actorRole)` to `apps/api/src/submissions/submissions.service.ts`.
  - [ ] Read submission with the columns needed for guards + restore: `id, user_id, station_id, photo_r2_key, status, created_at`.
  - [ ] Throw `NotFoundException` when missing, `ForbiddenException` when not the owner, `ConflictException` when not `verified`, `BadRequestException` when older than 24h (admin bypasses).
  - [ ] Atomic transition via `prisma.submission.updateMany({ where: { id, status: 'verified' }, data: { status: 'shadow_rejected', flag_reason: 'user_flagged_wrong' } })`. If `count === 0`, throw `ConflictException` (raced with admin or another flag).
  - [ ] Call `restorePreviousPrices(stationId, excludeId)` (T2a) and `liftDedup(stationId, photoHash)` (uses T1).
  - [ ] Compute `photoHash` by fetching the submission's photo via `storageService.getObjectBuffer(photo_r2_key)` and running `SubmissionDedupService.computePhotoHash(buf)`. Wrap in try/catch — on failure, log + proceed with `photoHash = null` (still attempts station-key lift).
  - [ ] Write `AdminAuditLog` row (action `USER_FLAGGED_WRONG`, notes JSON per AC8). Wrap in `.catch()` — audit failure must not block.

- [ ] **T2a — `restorePreviousPrices` private helper (AC: 3)**
  - [ ] Inside `SubmissionsService`, add private `restorePreviousPrices(stationId, excludeId): Promise<string|null>`.
  - [ ] Find latest `verified` submission for the station (`prisma.submission.findFirst` with `id: { not: excludeId }`, `orderBy: created_at desc`).
  - [ ] If found, build `StationPriceRow` from its `price_data` array (filter `price_per_litre != null && Number.isFinite()`, build `prices` Record + `sources` map all `community`, `updatedAt = previous.created_at`) and call `priceService.setVerifiedPrice(stationId, priceRow)`.
  - [ ] If not found, call `priceCache.invalidate(stationId)` so read-path falls through to estimates.
  - [ ] On `setVerifiedPrice` failure, log warn and fall back to `priceCache.invalidate` so we never leave stale cache pointing to the just-flagged submission.
  - [ ] Return the previous submission id (or null if no previous).

- [ ] **T3 — `SubmissionsService.autoResolveFlaggedAtStation` method (AC: 6)**
  - [ ] Add public `autoResolveFlaggedAtStation(userId, stationId, triggeringSubmissionId): Promise<void>`.
  - [ ] Query: `prisma.submission.findMany({ where: { user_id, station_id, status: 'shadow_rejected', flag_reason: 'user_flagged_wrong', created_at: { gte: now-7d }, id: { not: triggeringSubmissionId } }, select: { id: true } })`.
  - [ ] If empty result, return.
  - [ ] Bulk update via `updateMany({ where: { id: { in: ids } }, data: { status: 'rejected', flag_reason: 'auto_resolved_by_resubmit' } })`.
  - [ ] Write per-row audit entries (action `AUTO_RESOLVED_BY_RESUBMIT`, notes `{ resolved_by_submission_id: triggeringSubmissionId }`). Wrap each `.catch()` so a single failure doesn't drop the others.
  - [ ] Best-effort throughout — caller in T6 wraps the whole call in `.catch()` so a failure here cannot fail the new submission's verification.

- [ ] **T4 — `POST /v1/submissions/:id/flag-wrong` endpoint (AC: 3, 7, 10)**
  - [ ] Add to `apps/api/src/submissions/submissions.controller.ts`.
  - [ ] Decorators: `@Post(':id/flag-wrong')`, `@Roles(UserRole.DRIVER, UserRole.ADMIN)`, `@HttpCode(HttpStatus.OK)`, `@Throttle({ default: { ttl: 3600, limit: 5 } })`.
  - [ ] Pull `@Param('id')` + `@CurrentUser() user: User`. Call `submissionsService.flagWrong(id, user.id, user.role)`.
  - [ ] Return `{ status: 'withdrawn' }`. Errors propagate naturally (NestJS exception filter handles `4xx`).

- [ ] **T5 — `getMySubmissions` mapping update (AC: 5, 11)**
  - [ ] In `submissions.service.ts`, replace the existing `shadow_rejected → pending` blanket laundering with a flag-reason-aware switch:
    - `status: 'shadow_rejected'` AND `flag_reason: 'shadow_banned'` → wire status `pending`, wire `flag_reason` `null` (preserve Story 4.3 secrecy).
    - all other `shadow_rejected` → wire status `shadow_rejected`, wire `flag_reason` as-is.
  - [ ] Extend the wire-format `MappedSubmission` type to include `'shadow_rejected'` status variant + `flag_reason: string | null`.
  - [ ] Update existing tests in `submissions.service.spec.ts` to reflect the new policy: existing "should map shadow_rejected status to pending" test becomes "launders shadow_rejected to pending when flag_reason is shadow_banned"; existing "should not expose shadow_rejected" becomes "passes shadow_rejected through for non-shadow-banned reasons" with assertions on the wire `flag_reason`.

- [ ] **T6 — Pipeline worker auto-resolve hook + `forwardRef` plumbing (AC: 6)**
  - [ ] In `apps/api/src/photo/photo-pipeline.worker.ts`, after the `priceService.setVerifiedPrice(stationId, priceRow).catch(...)` line in the verified path, call `submissionsService.autoResolveFlaggedAtStation(updated.user_id, stationId, submissionId).catch(err => logger.warn(...))`.
  - [ ] Inject `SubmissionsService` with `@Inject(forwardRef(() => SubmissionsService))`.
  - [ ] Update `apps/api/src/photo/photo.module.ts` to import `forwardRef(() => SubmissionsModule)`.
  - [ ] Update `apps/api/src/submissions/submissions.module.ts` to import `forwardRef(() => PhotoModule)` (the existing `PhotoModule` import) and to import `PriceModule` for `PriceService` + `PriceCacheService`. Add `exports: [SubmissionsService]` so PhotoModule can consume it.
  - [ ] Inject `SubmissionsService` in `SubmissionsService`'s own constructor with `@Inject(forwardRef(() => PhotoPipelineWorker))` for the existing `photoPipelineWorker.enqueue` call (same cycle, opposite direction).
  - [ ] Update `submissions.service.spec.ts` and `photo-pipeline.worker.spec.ts` to provide mocks for the new injected dependencies (`PriceService`, `PriceCacheService`, `SubmissionsService` mock with `autoResolveFlaggedAtStation: jest.fn()`).

- [ ] **T7 — Backend tests + spec mock setup**
  - [ ] `submission-dedup.service.spec.ts`: 6 tests for `liftDedup` (T1).
  - [ ] `submissions.service.spec.ts`: ~13 tests covering `flagWrong` happy path + each guard (404/403/409/400) + admin bypass + concurrent-modification race + price restoration with/without previous + R2-fetch-failure fallback to station-only lift + audit-log write failure tolerance + `autoResolveFlaggedAtStation` empty/match/exclusion-of-trigger.
  - [ ] Update existing `getMySubmissions` mapping tests for the new policy (T5).
  - [ ] Critical mock-setup gotcha: existing `jest.mock('node:crypto', ...)` must spread `jest.requireActual('node:crypto')` so `createHash` works (used by `SubmissionDedupService.computePhotoHash` via `flagWrong`'s R2 → hash path). Without this, the new tests get `(0, node_crypto_1.createHash) is not a function`.
  - [ ] All 1112 API tests + new ones must pass; `pnpm -r type-check` clean.

### Mobile slice (T8–T13)

- [ ] **T8 — `apiFlagWrong` client helper (AC: 3, 7)**
  - [ ] Add `apiFlagWrong(accessToken, submissionId): Promise<void>` to `apps/mobile/src/api/submissions.ts`.
  - [ ] `POST` to `/v1/submissions/:id/flag-wrong` via the existing `request<T>` helper. Throws `ApiError` on non-2xx (caller branches on `statusCode`).
  - [ ] Extend the `Submission` interface: add `'shadow_rejected'` to the status union and a new `flag_reason: string | null` field.

- [ ] **T9 — Activity row updates (AC: 1, 5)**
  - [ ] In `apps/mobile/src/components/activity/SubmissionRow.tsx`:
    - [ ] Add an `onFlaggedWrong?: () => void` prop (parent uses it to refetch the list after a successful withdrawal).
    - [ ] Compute `flagEligible = isVerified && (Date.now() - new Date(item.created_at).getTime()) <= 24*3600*1000`. Backend enforces ownership + window; client gate is purely UX.
    - [ ] Render the `Złe ceny?` button right-aligned in the verified-row footer (next to prices). Use `tokens.brand.accent` color, `fontSize: 12`, `fontWeight: 600`. Add `accessibilityRole="button"` + `accessibilityLabel`.
    - [ ] Wire button `onPress` to local state `setConfirmVisible(true)`.
    - [ ] Add an `isShadowRejected` branch rendering an italic line via `shadowRejectedLabel(flag_reason, t)` helper (local function — extract to `utils/` only if a unit test pattern emerges).
    - [ ] Always render the new `<FlagWrongConfirmSheet ...>` at the end of the component tree (it's gated by its own `visible` prop).
  - [ ] In `apps/mobile/app/(app)/activity.tsx`, pass `onFlaggedWrong={() => void loadPage(1, true)}` so the activity list refreshes immediately after a successful flag.

- [ ] **T10 — `FlagWrongConfirmSheet` component (AC: 2, 7)**
  - [ ] Create `apps/mobile/src/components/activity/FlagWrongConfirmSheet.tsx`.
  - [ ] Props: `{ visible, submissionId, onDismiss, onFlagged }`. Match the existing bottom-sheet pattern from `StationDisambiguationSheet.tsx` (modal + overlay + handle + content card).
  - [ ] Title + body + two buttons (Cancel / Confirm). Confirm button shows `ActivityIndicator` while `submitting`; both buttons disabled while in flight.
  - [ ] On confirm: call `apiFlagWrong(accessToken, submissionId)`. On 2xx, fire `onFlagged()` then `router.push('/(app)/flag-wrong-thanks')`. On error, set inline error message (use generic `submitError` copy — branching on `statusCode` for richer messages is deferred).
  - [ ] Dismiss is no-op while `submitting` (prevents the user from cancelling mid-flight and getting a half-state).

- [ ] **T11 — Thanks screen route (AC: 4)**
  - [ ] Create `apps/mobile/app/(app)/flag-wrong-thanks.tsx`.
  - [ ] Title + body + primary "Take another photo" CTA → `router.replace('/(app)/capture')`. Secondary back-to-activity link → `router.replace('/(app)/activity')`.
  - [ ] No auto-dismiss (unlike `confirm.tsx`'s 4s timer — driver should choose, not have the screen vanish).

- [ ] **T12 — i18n keys**
  - [ ] Add the `contribution.flagWrong.*` block (button, confirmTitle/Body, confirmCancel/Confirm, submitError, thanksTitle/Body, thanksRetake/Back, withdrawnLabel, priceConflictLabel, underReviewLabel) to all three locale files: `pl.ts`, `en.ts`, `uk.ts`.

- [ ] **T13 — Mobile tests + fixture updates**
  - [ ] Update `apps/mobile/src/components/activity/__tests__/deriveSummary.test.ts` fixture to include the new `flag_reason: null` field on the `Submission` type. (Existing 31 tests must keep passing.)
  - [ ] No new unit tests added in this story — the new logic is small UI helpers; manual regression checklist covers visible behaviour. If we see flake during field test, extract `shadowRejectedLabel` to a util and unit-test it then (premature now).

### Code review (T14)

- [x] **T14 — `bmad-code-review` adversarial pass**
  - [x] Run after T13 against the full diff (backend + mobile).
  - [x] Findings folded back as Review Patches (Dev Agent Record below).

---

## Dev Notes

### Architecture compliance

- **No new tables, no migrations.** Reuses existing `Submission.flag_reason` (TEXT, nullable) for the new `user_flagged_wrong` and `auto_resolved_by_resubmit` values. Reuses `AdminAuditLog` for both actions. Hash dedup TTL (24h) and station dedup TTL (12h) unchanged — the flag-wrong path lifts these per-submission, doesn't change the global config.
- **NestJS module cycle** — `PhotoModule` ↔ `SubmissionsModule` becomes a circular dependency once the pipeline worker calls `SubmissionsService.autoResolveFlaggedAtStation`. Resolved with `forwardRef()` on both sides, standard NestJS pattern. Existing `forwardRef` usage in the codebase: none yet, so this is the first; document the pattern in commit message for future stories.
- **Atomic state transitions** — every status change is guarded by `WHERE status = <expected>` in `updateMany` so concurrent admin actions (Story 4.4 approve/reject) cannot lose data. Returning `count: 0` becomes a `409 Conflict` rather than an overwrite.
- **Best-effort side effects** — dedup lift, audit log writes, and auto-resolve are all `.catch()`-wrapped. The user-facing transition (status flip) is the only required step; everything else is recovery.

### Testing standards

- Backend: Jest + ts-jest under `apps/api`. New tests live alongside the file under test. Pattern: spec mocks every direct dependency injected into the constructor; never imports real Prisma/Redis. See `submissions.service.spec.ts` for the established mock-setup pattern.
- Mobile: Jest under `apps/mobile`. Existing tests cover utility logic (deriveSummary, savings, freshness). Component-level UI tests are not the codebase pattern — manual regression checklist below substitutes.
- Critical mock pitfall: when the service-under-test transitively calls `crypto.createHash`, ensure any `jest.mock('node:crypto', ...)` in the spec spreads `jest.requireActual('node:crypto')` to preserve real `createHash`.

### Source tree alignment

- Backend service code lives under `apps/api/src/submissions/` (not `apps/api/src/photo/`). The flag-wrong endpoint belongs to the submissions API, not the pipeline.
- The pipeline worker file remains the home for "what happens after a verified submission" hooks — including the auto-resolve call. Do NOT move that logic into `SubmissionsService.createSubmission` or similar — it fires after the pipeline finishes, not during intake.
- Mobile activity components live under `apps/mobile/src/components/activity/`. New `FlagWrongConfirmSheet.tsx` joins existing `SubmissionRow.tsx`, `SummaryHeader.tsx`, `deriveSummary.ts` here.
- Mobile screen routes under `apps/mobile/app/(app)/` — the new `flag-wrong-thanks.tsx` joins `confirm.tsx`, `capture.tsx`, `activity.tsx`.

### Reused vs new — no wheel reinvention

- **Reuse**: `SubmissionDedupService` (extend, don't replace), `PriceService.setVerifiedPrice` for cache rewrite, `PriceCacheService.invalidate` for the no-previous-submission case, `AdminAuditLog` for the audit trail, the existing `Throttle` decorator pattern (see `feedback.controller.ts`), the existing bottom-sheet UI pattern (see `StationDisambiguationSheet.tsx`), the existing `request<T>` HTTP helper (`apps/mobile/src/api/submissions.ts`).
- **New**: `liftDedup` method on dedup service, `flagWrong` + `autoResolveFlaggedAtStation` + `restorePreviousPrices` private helper on submissions service, the new endpoint, the new mobile components and screen, the new i18n keys.
- **NOT to build**: a separate `SubmissionFlagService` (the flag actions are tightly coupled to existing submission lifecycle — keep them on `SubmissionsService`); a `flag_actor` enum on the Submission table (current text `flag_reason` is enough; rename `AdminAuditLog.admin_user_id` → `actor_user_id` is also out of scope, deferred).

### Project Structure Notes

Story stays inside conventions already established by Story 3.10 (dedup service shape) and Story 4.2 (admin moderation atomic guards). One deviation worth noting: `AdminAuditLog.admin_user_id` is now used to store driver user IDs for `USER_FLAGGED_WRONG` and `AUTO_RESOLVED_BY_RESUBMIT` actions. This is a known misnomer — the column type is plain text with no FK, so no schema change needed; rename to `actor_user_id` is logged as a future cleanup pass. Search-and-replace will be safe once we bundle it with another schema migration.

### References

- [Story 3.10 — Submission Deduplication](./3-10-submission-deduplication.md) — `SubmissionDedupService` foundation; this story adds `liftDedup` per the addendum at the bottom of that file.
- [Story 3.7 — Price Validation & Database Update](./3-7-price-validation-database-update.md) — origin of the rule-based `shadow_rejected` flow whose flag_reasons (`pb95_outside_rack_band`, `on_outside_rack_band`, `lpg_outside_rack_band`) need AC5 fallback copy.
- [Story 4.2 — Submission Review Queue](./4-2-submission-review-queue.md) — existing admin shadow-rejected queue; this story adds new flag_reason values that route through the same admin UI without code changes.
- [Story 4.3 — Shadow Ban Short-circuit](./4-3-shadow-ban.md) — invariant preserved by AC11 (laundering only fires when `flag_reason === 'shadow_banned'`).
- [Story 3.12 — Activity Screen Polish](./3-12-activity-screen-polish.md) — current `SubmissionRow.tsx` patterns this story extends.
- [Story 3.16 — Consensus-Based Dedup](./3-16-consensus-based-dedup.md) — depends on this story's `liftDedup` and shadow_rejected reason-copy infrastructure; introduces the `price_conflict` flag_reason that AC5 already maps copy for.
- [Story 3.17 — Activity Row Status Polish](./3-17-activity-row-status-polish.md) — placeholder for deeper per-rule-code copy; runs after 30 days of production data on which `flag_reason` codes appear most.
- `apps/api/src/photo/submission-dedup.service.ts` — extend.
- `apps/api/src/submissions/submissions.service.ts` — extend (`flagWrong`, `autoResolveFlaggedAtStation`, `restorePreviousPrices`).
- `apps/api/src/submissions/submissions.controller.ts` — extend (new endpoint).
- `apps/api/src/photo/photo-pipeline.worker.ts` — extend (auto-resolve hook).
- `apps/api/src/feedback/feedback.controller.ts` — pattern reference for `@Throttle` decorator.
- `apps/api/src/admin/admin-submissions.service.ts` — pattern reference for atomic-update guards via `updateMany`'s `count`.
- `apps/mobile/src/components/contribution/StationDisambiguationSheet.tsx` — pattern reference for bottom-sheet modal styling.
- `apps/mobile/app/(app)/confirm.tsx` — pattern reference for full-screen acknowledgement screen.

---

## Out of Scope

- **Peer flagging** (driver A flags driver B's submission). Different problem — flagger isn't standing at the station, prices may have changed, opens trust-system complexity. Revisit post-launch only if needed.
- **Push notifications** when admin resolves a user-flagged submission. Driver already gets feedback via the in-app activity row; push is a separate feature.
- **Bulk admin tooling** for user-flagged rows — current shadow-rejected admin UI handles them.
- **Telemetry** for flag rate / per-user flag patterns — useful for measuring OCR quality over time, defer until we have data flowing.
- **Anti-abuse beyond rate limit** — abuse-detection on flag patterns (e.g., user flags every submission they made) is a Phase 2 concern; the 24h window + 5/hr rate limit are the v1 guards.
- **`AdminAuditLog.admin_user_id` rename** to `actor_user_id` — column-rename migration is out of scope; logged as future cleanup.
- **Deeper shadow_rejected copy** for rule-based reasons — Story 3.17 picks this up after we have 30 days of data.

---

## Regression Checklist (pre-push)

- [ ] `pnpm -r type-check` green
- [ ] `pnpm -r test` green (all 1112 API tests + 31 mobile tests after additions)
- [ ] Manual: submit a photo → wait for verify → tap `Złe ceny?` → confirm → see thanks screen → tap retake → camera opens
- [ ] Manual: flag a submission → check map: previous prices restored (or estimates if no previous) for that station; the just-flagged prices no longer show
- [ ] Manual: flag → immediately retake same scene → submission processes (dedup did not block)
- [ ] Manual: flag a 25h-old submission as a non-admin → button hidden in UI; if API directly hit, returns `400`
- [ ] Manual: flag the same submission twice (rapid double-tap) → second call returns `409` cleanly; UI button is disabled during flight
- [ ] Manual: shadow-banned user submits → activity log shows row as `pending` (NOT `shadow_rejected`) — Story 4.3 invariant preserved
- [ ] Manual: admin opens admin queue → sees `user_flagged_wrong` rows surfaced; can approve/reject through the existing single-submission flow
- [ ] Manual: same user submits a second photo at the same station that verifies → prior `user_flagged_wrong` row auto-flips to `auto_resolved_by_resubmit` and disappears from admin queue

---

## Dev Agent Record

### Agent Model Used

Claude Sonnet 4.6 (1M context)

### Debug Log References

- 2026-05-06: `(0, node_crypto_1.createHash) is not a function` test failure — root cause: existing `jest.mock('node:crypto', ...)` in `submissions.service.spec.ts` stubbed `randomUUID` only and replaced the entire module. Fix: spread `jest.requireActual('node:crypto')` so `createHash` (used by `SubmissionDedupService.computePhotoHash` via `flagWrong`'s R2 → hash path) resolves to the real implementation.

### Completion Notes List

- Backend slice committed locally as `44f5ef1` (NOT pushed). All 1112 API tests + 31 mobile tests green. `pnpm -r type-check` clean.
- `forwardRef` was the right call for the `SubmissionsService` ↔ `PhotoPipelineWorker` cycle — kept the auto-resolve logic in the submissions domain rather than moving it into the pipeline file.
- Mobile slice (T8–T13) implemented but not yet committed; pending T14 code review.

### File List

**Backend (initial slice committed in `44f5ef1`; review patches in follow-up commit):**
- `apps/api/src/photo/submission-dedup.service.ts` — modified, `liftDedup` method.
- `apps/api/src/photo/submission-dedup.service.spec.ts` — modified, 6 new tests.
- `apps/api/src/photo/photo-pipeline.worker.ts` — modified, auto-resolve hook + `forwardRef` injection + P-14 guard + P-6 `triggeringCreatedAt`.
- `apps/api/src/photo/photo-pipeline.worker.spec.ts` — modified, `SubmissionsService` mock.
- `apps/api/src/photo/photo.module.ts` — modified, `forwardRef(() => SubmissionsModule)` import.
- `apps/api/src/submissions/submissions.service.ts` — modified, new methods + mapping update + new dependencies + P-1..P-6/P-9/P-13/P-17/BS-1 patches.
- `apps/api/src/submissions/submissions.service.spec.ts` — modified, ~13 new tests + mock setup, real `createHash`, P-12 enum import + new P-5/P-6 tests.
- `apps/api/src/submissions/submissions.controller.ts` — modified, new `flag-wrong` endpoint + P-10 `ParseUUIDPipe` + P-7/P-8 guard wiring.
- `apps/api/src/submissions/submissions.module.ts` — modified, `forwardRef(() => PhotoModule)`, `PriceModule` import, exports `SubmissionsService`.
- `apps/api/src/submissions/flag-wrong-throttler.guard.ts` — new, P-7 per-user tracker + P-8 admin shouldSkip override.

**Mobile (uncommitted):**
- `apps/mobile/src/api/submissions.ts` — modified, `apiFlagWrong` helper + `Submission` type extension.
- `apps/mobile/src/components/activity/SubmissionRow.tsx` — modified, `Wrong?` button + reason-aware copy + sheet integration.
- `apps/mobile/src/components/activity/FlagWrongConfirmSheet.tsx` — new component.
- `apps/mobile/app/(app)/flag-wrong-thanks.tsx` — new route.
- `apps/mobile/app/(app)/activity.tsx` — modified, passes `onFlaggedWrong`.
- `apps/mobile/src/i18n/locales/pl.ts`, `en.ts`, `uk.ts` — modified, `flagWrong` keys.
- `apps/mobile/src/components/activity/__tests__/deriveSummary.test.ts` — modified, fixture update for new `flag_reason` field.

### Review Patches

T14 bmad-code-review (2026-05-03) surfaced 18 fixable patches (P-1..P-18) and 11 deferred items. All patches applied in this slice:

**Backend — `submissions.service.ts`:**

- **P-1** — `restorePreviousPrices` writes `priceRow.updatedAt = new Date()` instead of inheriting the previous submission's `created_at`. Stale freshness banners would fire on a "live" restore otherwise.
- **P-2** — `RESTORE_PREVIOUS_MAX_AGE_MS = 7 days` cap on the previous-verified lookup. A 6-month-old price restored as the live community price is more harmful than falling back to estimates.
- **P-3** — `restorePreviousPrices` invalidates the cache (instead of writing an empty `{}` row) when the previous submission has zero valid price entries.
- **P-4** — `restorePreviousPrices` validates `fuel_type` against the canonical `VALID_FUEL_TYPES` set (not just non-null `price_per_litre`) before writing.
- **P-5** — `autoResolveFlaggedAtStation.updateMany` includes `status: shadow_rejected` and `flag_reason: 'user_flagged_wrong'` in the WHERE clause. Prevents clobber of admin-resolved rows between findMany and updateMany.
- **P-6** — `autoResolveFlaggedAtStation` accepts `triggeringCreatedAt` and filters `created_at: { lt: triggeringCreatedAt }`. A BullMQ retry of an old verify-job must not auto-resolve a flag the driver filed *after* the original verification completed.
- **P-9** — `flagWrong` lifts dedup keys BEFORE the status flip. Order matters: a request cut off mid-method still leaves the row `verified` (so the next call passes the status guard) AND the dedup keys are already lifted (so the retake can immediately re-process).
- **P-13** — `flagWrong` audit notes preserve `previous_flag_reason` so a custom annotation isn't silently lost when the flag-wrong overwrites `flag_reason`.
- **P-17 (server)** — `flagWrong` rejects negative `ageMs` (future `created_at`) so a clock-skewed server timestamp can't trivially pass the `<= 24h` check.
- **BS-1** — `getMySubmissions` mapping uses an explicit `DRIVER_VISIBLE_FLAG_REASONS` allowlist. Future internal taxonomy (rule ids, anti-fraud signals) won't leak via the wire.

**Backend — `flag-wrong-throttler.guard.ts` (new):**

- **P-7** — `getTracker` keys on `currentUser.id` instead of IP. Drivers behind CGNAT/shared NAT no longer share the 5/hr budget.
- **P-8** — `shouldSkip` returns `true` for `UserRole.ADMIN`. Admin field-test moderation bypasses the 5/hr cap entirely (AC10).

**Backend — `submissions.controller.ts`:**

- **P-10** — `:id` path param uses `ParseUUIDPipe` so non-UUID input returns 400 before hitting the service layer.
- **P-14** — call-site `if (this.submissionsService)` guard around `autoResolveFlaggedAtStation` for forwardRef startup-order edge cases.

**Backend — `photo-pipeline.worker.ts`:**

- **P-14** — passes `updated.created_at` as 4th arg to `autoResolveFlaggedAtStation` (paired with P-6 service-side change).

**Backend — `submissions.service.spec.ts`:**

- **P-12** — `'DRIVER' as never` replaced with `UserRole.DRIVER` enum imports for type safety.
- New tests for P-5 (status guard skip path), P-6 (`triggeringCreatedAt` filter on findMany).

**Mobile — `apps/mobile/src/api/submissions.ts`:**

- **P-11** — `apiFlagWrong` returns the parsed `{ status: 'withdrawn' }` body so callers can branch on richer responses later.

**Mobile — `apps/mobile/src/components/activity/FlagWrongConfirmSheet.tsx`:**

- **P-15** — branches on `err.statusCode === 400` to surface `windowExpiredError` copy + calls `onFlagged()` to refresh the activity list (the row is no longer eligible).

**Mobile — `apps/mobile/src/components/activity/SubmissionRow.tsx`:**

- **P-16** — local `optimisticallyFlagged` state flips the row to `shadow_rejected`/`user_flagged_wrong` instantly on confirm, before the parent's refetch round-trip.
- **P-17 (mobile)** — `flagEligible` requires `ageMs >= 0` so a forward-skewed client clock doesn't show the flag button on rows the server will refuse.

**Mobile — `apps/mobile/src/i18n/locales/{pl,en,uk}.ts`:**

- **P-15** — added `contribution.flagWrong.windowExpiredError` key in all three locales.

### Review Deferred Items

The following items from the bmad-code-review are intentionally deferred — none are launch-blockers for Story 3.14, and folding them in here would either dilute scope or duplicate work that's owned by a follow-up story.

- **D-1 — AdminAuditLog `admin_user_id` vs `actor_user_id` schema rename.** Reusing the column for non-admin actors works (text col, no FK) but the name is misleading. Defer to a schema-cleanup pass when we have multiple non-admin audit producers (Story 3.16 consensus auto-resolves, Story 7.x partner actions). Tracked separately.
- **D-2 — Move auto-resolve to a BullMQ worker.** Currently runs inline at the end of `processSubmission`. A dedicated job would isolate failures and let us retry independently. Deferred — current best-effort `.catch` is sufficient given low volume; revisit if we see auto-resolve drops.
- **D-3 — Idempotency key on `flag-wrong` endpoint.** Mobile auto-retry of a network-failed flag could cause two transitions back-to-back; the status guard catches this with a 409 today. Adding `Idempotency-Key` would make it cleaner. Deferred — 409 is harmless for the user since the optimistic UI already shows the row as flagged.
- **D-4 — Surface `restored_from_submission_id` in admin review UI.** Admins reviewing a `user_flagged_wrong` row would benefit from seeing which previous submission's prices were restored. Deferred to Story 3.17 (activity row status polish) which is already touching admin UI.
- **D-5 — Cap `auto_resolved_by_resubmit` chain depth.** If a driver flags → resubmits → flags again → resubmits, each new submission auto-resolves the previous flag. No bounded chain today. Deferred — observe in production; revisit if we see >3 hops in real data.
- **D-6 — Photo hash compute deduplication.** `flagWrong` re-fetches the photo from R2 and recomputes the hash. The hash was already computed at submission time; storing it on the row would avoid the R2 round-trip. Deferred to a separate refactor; for now the fallback to "station-only lift" on R2 fetch failure is acceptable.
- **D-7 — Per-station flag rate cap.** A driver could flag 5 different stations in 5 minutes (within the 5/hr global cap). Probably fine — flagging is by definition correcting bad data — but worth watching. Deferred; add metrics first.
- **D-8 — Test coverage for FlagWrongThrottlerGuard.** No unit tests for the guard itself yet (covered indirectly by API throttle tests). Deferred — guard is small and the integration flow is exercised end-to-end.
- **D-9 — Admin override notes on flag-wrong.** When an admin flag-wrongs a user's submission, the audit `actor_role` is captured but no admin reason field. Deferred — admins can use the existing `notes` admin endpoint after the fact.
- **D-10 — Activity row staleness for shadow_rejected (`user_flagged_wrong`).** No "X hours ago" hint on the withdrawn label. Deferred to Story 3.17.
- **D-11 — Story 4.3 shadow_banned regression test.** A direct regression test pinning the shadow_banned secrecy invariant against the new flag_reason allowlist would be valuable. Deferred — the BS-1 allowlist is explicit; covered by the existing 4.3 invariant tests.
