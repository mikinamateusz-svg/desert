# Story 3.8: Pipeline Retry & Dead-Letter Queue

## Status: done

## Story

As a **developer**,
I want the pipeline to automatically retry transient failures and escalate unrecoverable submissions to ops,
So that no submission is silently lost and the team is alerted when intervention is needed.

## Acceptance Criteria

**AC1 — Transient failure retry (×3, exponential backoff):**
Given a pipeline job fails due to a transient error (timeout, API error, network issue)
When the failure is caught
Then the job is retried ×3 with exponential backoff: 30s → 2min → 10min
And the photo is retained in R2 during all retry attempts

**AC2 — Non-transient failure immediate rejection:**
Given a job fails due to a non-transient reason (OCR confidence <40%, no GPS match, price validation failed)
When the failure type is identified
Then no retry is attempted — the submission is rejected immediately and the photo deleted from R2

**AC3 — DLQ entry on max retries exhausted:**
Given a job exhausts all 3 retries without success
When the final retry fails
Then the job is moved to the dead-letter queue (BullMQ failed state)
And the photo is deleted from R2
And the submission status is updated to `rejected`
And an ops alert is triggered (structured log) with the submission ID and failure reason

**AC4 — Manual requeue from DLQ (deferred to Story 4.4):**
Given a submission in the dead-letter queue
When ops reviews it
Then they can manually requeue it for reprocessing or mark it as permanently rejected
*(Deferred: Story 4.4 Dead-Letter Queue Management builds the admin UI and requeue endpoint)*

**AC5 — DLQ depth alert:**
Given the dead-letter queue
When it is monitored
Then ops receives a structured alert if queue depth exceeds 10 items — indicating a systemic issue

## Tasks / Subtasks

- [x] T1: Confirm AC1 + AC2 already satisfied
  - [x] T1a: AC1 — `BACKOFF_DELAYS_MS = [30s, 2m, 10m]` + `JOB_OPTIONS.attempts = 4` already in worker
  - [x] T1b: AC2 — non-transient rejections call `rejectSubmission()` and return (no throw) — BullMQ marks job completed, no retry


- [x] T2: Extend `failed` event handler — final failure cleanup (AC3)
  - [x] T2a: Fetch submission (photo_r2_key) on final failure
  - [x] T2b: Update submission to `status: rejected, gps_lat: null, gps_lng: null, photo_r2_key: null`
  - [x] T2c: Delete photo from R2 (best-effort)
  - [x] T2d: Extract and consolidate GPS null logic into the same update (remove old separate GPS-only update)

- [x] T3: Add structured ops alert log on final failure (AC3)
  - [x] T3a: Log `[OPS-ALERT]` ERROR with submissionId, attemptsMade, and failure reason

- [x] T4: Add DLQ depth monitoring (AC5)
  - [x] T4a: Define `DLQ_DEPTH_ALERT_THRESHOLD = 10` constant
  - [x] T4b: After final failure, call `queue.getFailedCount()` and log `[OPS-ALERT]` if > threshold

- [x] T5: Write tests for T2–T4 (photo-pipeline.worker.spec.ts)
  - [x] T5a: Final failure → submission marked rejected + photo deleted from R2
  - [x] T5b: Final failure → `[OPS-ALERT]` logged with submissionId
  - [x] T5c: Intermediate failure (not final) → no R2 deletion, no alert
  - [x] T5d: Final failure + DLQ depth > 10 → DLQ depth alert logged
  - [x] T5e: Final failure + R2 deletion fails → logged, does not throw
  - [x] T5f: Final failure + submission not found in DB → graceful no-op

- [x] T6: Run full regression suite and confirm all tests pass (601/601 ✓)

## Dev Notes

### What is already implemented (from Stories 3.4–3.7)

**AC1 — Retry strategy:**
```
const BACKOFF_DELAYS_MS = [30_000, 120_000, 600_000] // 30s → 2m → 10m
const JOB_OPTIONS = { attempts: 4, backoff: { type: 'custom' } }
```
Custom backoff strategy is wired into the Worker settings. `attempts: 4` = 1 initial + 3 retries.

**AC2 — Non-transient immediate rejection:**
All non-transient failure paths (`rejectSubmission`) complete the job without throwing:
- `runGpsMatching`: `no_gps_coordinates`, `no_station_match` → `rejectSubmission()` → returns `null` → job completes
- `runOcrExtraction`: `low_ocr_confidence`, `no_prices_extracted`, `price_out_of_range` → `rejectSubmission()` → returns false
- `runPriceValidationAndUpdate`: `price_validation_failed` → `rejectSubmission()` → returns

Transient failures throw (R2 errors, DB errors, Claude API errors) → BullMQ retries.

### Dead-letter queue mechanics (BullMQ)

BullMQ does not have a separate DLQ construct — when a job exhausts all retries, it transitions to the `failed` state and remains queryable via `queue.getFailed()` / `queue.getFailedCount()`. This IS the DLQ. No additional infrastructure needed.

The `failed` event fires on EVERY failed attempt (including intermediate ones). The guard `job.attemptsMade >= attemptsAllowed` identifies only the final failure.

### failed event handler structure

The current handler (from Story 3.4 GDPR fix):
```ts
this.worker.on('failed', (job, err) => {
  this.logger.error(`...`);
  if (job && job.attemptsMade >= attemptsAllowed) {
    this.prisma.submission.update({ gps_lat: null, gps_lng: null }).catch(...);
  }
});
```

Story 3.8 replaces the GPS-only update with a full cleanup:
1. `findUnique({ select: { id, photo_r2_key } })`
2. `update({ status: rejected, gps_lat: null, gps_lng: null, photo_r2_key: null })`
3. `storageService.deleteObject(photo_r2_key)` — best-effort
4. `logger.error('[OPS-ALERT] ...')`
5. `queue.getFailedCount()` → if > 10 → `logger.error('[OPS-ALERT] DLQ depth ...')`

All operations are async inside a `.then()` chain off `findUnique`. Errors are caught per-step and logged; none should propagate to BullMQ.

### AC4 deferred to Story 4.4

Manual requeue / permanent rejection of DLQ entries requires an admin endpoint and UI (Story 4.4 Dead-Letter Queue Management). The API methods `queue.retryJobs({ state: 'failed' })` and `queue.clean(0, 0, 'failed')` will be used there. Not implemented here.

### Test structure

The `failed` event is captured in the test suite via `capturedFailedHandler` (similar to how `capturedProcessor` captures the job processor). To test the final-failure path, call `capturedFailedHandler(makeJob('sub-123'), new Error('...'))` with `job.attemptsMade = 4` (= attemptsAllowed).

For intermediate failure: `job.attemptsMade = 2` → guard should NOT trigger cleanup.

## Dev Agent Record

### Implementation Plan
1. Extend `failed` event handler in worker (T2–T4)
2. Write tests (T5)
3. Run full suite (T6)

### Completion Notes

- `handleFinalFailure` private method added to worker: fetches submission, updates to `rejected` + nulled GPS/photo key, deletes R2 photo (best-effort), logs `[OPS-ALERT]`, checks DLQ depth.
- `DLQ_DEPTH_ALERT_THRESHOLD = 10` constant defined at module level.
- `failed` event handler refactored: old GPS-only update replaced with `handleFinalFailure` call (fire-and-forget with `.catch` guard).
- 8 new tests + 3 review-patch tests = 11 new tests total.
- Fixed mock implementation bleed-through bug: added `afterEach(() => mockPrismaService.submission.findUnique.mockReset())` inside Story 3.8 describe block.
- Full suite: 604/604 passing.

**Code review patches applied (2026-04-03):**
- P-1: R2 deletion now gated on DB update success (`updateOk` flag) — prevents orphaned DB record with deleted photo (GDPR)
- P-2: `[OPS-ALERT]` now fires even when `findUnique` fails or returns null — ops always notified of DLQ entry
- P-3: Guard in `failed` handler for `submissionId = 'unknown'` — emits `[OPS-ALERT]` and skips DB/R2 ops

**Deferred from review:**
- D-1: DLQ depth count may not include current job (BullMQ event timing off-by-one) — fix post-MVP with `+1` adjustment
- D-2: Alert storm on burst failures — no rate-limiting; acceptable for PoC
- D-3: `getFailedCount()` returns `-1` on Redis error, depth alert suppressed — log warning on `-1` post-MVP
- D-4: `[OPS-ALERT]` emitted even when DB/R2 cleanup failed — misleading but preceding error logs provide context
- D-5: R2 orphan if submission hard-deleted before final failure cleanup — pre-existing architectural gap (account deletion flow)

## File List

- `apps/api/src/photo/photo-pipeline.worker.ts` (modified — Story 3.8 DLQ cleanup)
- `apps/api/src/photo/photo-pipeline.worker.spec.ts` (modified — Story 3.8 tests)
- `_bmad-output/implementation-artifacts/3-8-pipeline-retry-dead-letter-queue.md` (new)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)

## Change Log

- 2026-04-03: Story 3.8 created and implementation started.

## Review Notes (2026-04-04)

No new patches. Prior review (2026-04-03) applied P-1/P-2/P-3. 604/604 tests passing.
