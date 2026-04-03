# Story 3.10: Submission Deduplication

## Status: review

## Story

As a **developer**,
I want the pipeline to skip redundant OCR calls when a fresh verified result already exists for the same station or the exact same photo is submitted twice,
So that a price submission flood, accidental double-tap, or a wave of concurrent contributors does not generate unnecessary Claude API costs.

## Acceptance Criteria

**AC1 — L1 station dedup at API intake (preselected station path only):**
Given a submission arrives with `preselected_station_id` set
When a verified OCR result for that station was recorded within the last 12 hours
Then the API returns 202 without uploading to R2, creating a `Submission` record, or enqueueing a BullMQ job
And a `[DEDUP-L1]` structured log is emitted with `station`, `submission` (client-assigned UUID if any), and a note that the result is fresh

**AC2 — L2 station dedup in the worker (coalescing & GPS path):**
Given the worker has resolved a `stationId` for a submission (via GPS match or preselected path)
When a verified OCR result for that station was recorded within the last 12 hours
Then the worker skips the Claude OCR call
And the photo is deleted from R2 and the `Submission` is marked `rejected` with reason `'duplicate_submission'`
And a `[DEDUP-L2]` structured log is emitted
*(This handles the coalescing case: submissions B/C queued while submission A was in-flight — when A completes and sets the dedup key, B and C skip OCR when their turn arrives.)*

**AC3 — Hash dedup in the worker:**
Given the worker has fetched the photo buffer from R2
When the SHA-256 hash of the buffer matches a hash recorded within the last 24 hours
Then the worker skips the Claude OCR call
And the photo is deleted from R2 and the `Submission` is marked `rejected` with reason `'duplicate_submission'`
And a `[DEDUP-HASH]` structured log is emitted with the first 8 chars of the hash

**AC4 — Dedup keys recorded on successful OCR:**
Given OCR completes with `confidence_score >= 0.4` and at least one price extracted
When the submission passes all OCR checks (before price validation)
Then `dedup:station:{stationId}` is set in Redis with 12-hour TTL
And `dedup:hash:{sha256}` is set in Redis with 24-hour TTL

**AC5 — No dedup keys set on OCR failure:**
Given OCR fails for any reason (low confidence, no prices, API error, photo missing)
When the worker rejects or the job throws
Then no dedup keys are set
And subsequent submissions for that station are processed normally

**AC6 — GPS path not gated at L1:**
Given a submission arrives with no `preselected_station_id` (GPS path)
When it is received by the API
Then it is accepted, uploaded to R2, and enqueued normally — stationId is not yet known so L1 cannot fire
*(L2 in the worker handles this path after GPS matching.)*

**AC7 — Dedup is transparent to the driver:**
Given dedup fires at either L1 or L2
When the driver checks their submission history
Then the deduped L1 intake (no DB record) never appears in history
And the deduped L2 worker rejection appears as `rejected` (same as any other rejection) — the driver's existing confirmation screen (Story 3.2) means they already saw "Thank you" and have moved on

**AC8 — Redis failure is fail-open:**
Given Redis is unavailable when a dedup check runs
When `checkStationDedup` or `checkHashDedup` throws
Then the worker logs a warning and proceeds to call Claude normally — dedup is a cost optimisation, not a safety gate
*(Consistent with the fail-open pattern established in Story 3.9 for spend tracking.)*

## Tasks / Subtasks

- [x] T1: Create `SubmissionDedupService` (AC1–AC6, AC8)
  - [x] T1a: Create `apps/api/src/photo/submission-dedup.service.ts`
  - [x] T1b: Inject `REDIS_CLIENT` (same pattern as `OcrSpendService`)
  - [x] T1c: `static computePhotoHash(buffer: Buffer): string` — `createHash('sha256').update(buffer).digest('hex')` from `node:crypto`
  - [x] T1d: `checkStationDedup(stationId: string): Promise<boolean>` — GET `dedup:station:{stationId}`, return `value !== null`
  - [x] T1e: `recordStationDedup(stationId: string): Promise<void>` — SET `dedup:station:{stationId}` EX `STATION_DEDUP_WINDOW_SECONDS` (12h = 43200)
  - [x] T1f: `checkHashDedup(hash: string): Promise<boolean>` — GET `dedup:hash:{hash}`
  - [x] T1g: `recordHashDedup(hash: string): Promise<void>` — SET `dedup:hash:{hash}` EX `HASH_DEDUP_TTL_SECONDS` (24h = 86400)
  - [x] T1h: TTL constants as module-level constants (not ENV-configurable for MVP): `STATION_DEDUP_WINDOW_SECONDS = 12 * 3600`, `HASH_DEDUP_TTL_SECONDS = 24 * 3600`

- [x] T2: L1 dedup in `SubmissionsService.createSubmission` (AC1, AC6)
  - [x] T2a: Inject `SubmissionDedupService` into `SubmissionsService` constructor
  - [x] T2b: Before R2 upload, if `fields.preselectedStationId` is set, call `checkStationDedup`
  - [x] T2c: If dedup hit: `this.logger.log('[DEDUP-L1] station=... — fresh result, skipping intake')` then `return`
  - [x] T2d: Wrap `checkStationDedup` in try/catch — log warning and continue on error (fail-open, AC8)

- [x] T3: L2 station dedup in `photo-pipeline.worker.ts` (AC2, AC5)
  - [x] T3a: Inject `SubmissionDedupService` into `PhotoPipelineWorker` constructor
  - [x] T3b: In `processJob`, after `runGpsMatching` returns, resolve `stationId` (same logic as line 191 already does for `runPriceValidationAndUpdate`)
  - [x] T3c: If `stationId` is known and `checkStationDedup` returns true: log `[DEDUP-L2]`, call `rejectSubmission(submission, 'duplicate_submission')`, return
  - [x] T3d: Wrap `checkStationDedup` in try/catch — log warning and continue (fail-open, AC8)
  - [x] T3e: Pass `stationId` into `runOcrExtraction` so it can record the dedup key on success (T4)

- [x] T4: Hash dedup + dedup key recording in `runOcrExtraction` (AC3, AC4, AC5)
  - [x] T4a: Update `runOcrExtraction` signature to accept `stationId: string | null` as second param
  - [x] T4b: After `getObjectBuffer`, compute `photoHash = SubmissionDedupService.computePhotoHash(photoBuffer)`
  - [x] T4c: Call `checkHashDedup(photoHash)` — if hit: log `[DEDUP-HASH]`, call `rejectSubmission`, return false
  - [x] T4d: Wrap `checkHashDedup` in try/catch — log warning and continue (fail-open, AC8)
  - [x] T4e: After all OCR checks pass (confidence >= 0.4, prices.length > 0, bands valid), call `recordStationDedup(stationId)` and `recordHashDedup(photoHash)` — both best-effort with `.catch(() => logger.warn(...))`

- [x] T5: Wire up module
  - [x] T5a: Add `SubmissionDedupService` to `PhotoModule` providers and exports
  - [x] T5b: `SubmissionsModule` already imports `PhotoModule` — no change needed, `SubmissionDedupService` will be available via the existing import

- [x] T6: Tests
  - [x] T6a: `submission-dedup.service.spec.ts` — `checkStationDedup` (hit/miss), `recordStationDedup` (correct key + TTL), `checkHashDedup` (hit/miss), `recordHashDedup` (correct key + TTL), `computePhotoHash` (deterministic, hex string)
  - [x] T6b: `submissions.service.spec.ts` — L1 dedup hit returns early without R2 upload; L1 dedup miss proceeds normally; L1 dedup Redis error proceeds normally (fail-open); GPS path (no preselectedStationId) skips dedup check entirely
  - [x] T6c: `photo-pipeline.worker.spec.ts` — L2 station dedup hit → rejectSubmission called with `'duplicate_submission'` + no OCR; hash dedup hit → rejectSubmission called with `'duplicate_submission'` + no OCR; successful OCR records both dedup keys; failed OCR (low confidence) does NOT record dedup keys; dedup Redis error → OCR proceeds normally (fail-open)

- [x] T7: Full regression suite — 662/662 tests pass

## Dev Notes

### Why no dedup at L1 for the GPS path

At API intake, the stationId is unknown for submissions without `preselected_station_id` — GPS matching happens in the worker. L1 can only fire when the client explicitly tells us the station. L2 in the worker closes this gap: after GPS matching resolves the stationId, the dedup key is checked before calling Claude.

### Same Redis key, two check points

L1 and L2 check the same Redis key: `dedup:station:{stationId}`. The key is set in the worker after a successful OCR result. So:
- Submissions arriving *after* a good result: caught at L1 (zero cost, no R2 upload)
- Submissions enqueued *before* a good result completed: caught at L2 (R2 upload already happened, but Claude is skipped)

This means L2 is also the coalescing mechanism: multiple concurrent submissions for the same station queue up; the first to complete OCR sets the key; all others skip Claude when their turn arrives.

### Dedup key patterns

```
dedup:station:{stationId}   → value: '1'  TTL: 43200s (12h)
dedup:hash:{sha256hex}      → value: '1'  TTL: 86400s (24h)
```

Use `SET key 1 EX ttl` (not `SETEX` — deprecated in Redis 7+). The value is irrelevant; existence is the signal.

### `runOcrExtraction` signature change

Currently: `runOcrExtraction(submission: Pick<Submission, 'id' | 'photo_r2_key'>): Promise<boolean>`

After this story: `runOcrExtraction(submission: Pick<Submission, 'id' | 'photo_r2_key'>, stationId: string | null): Promise<boolean>`

The stationId is needed to record the station dedup key on success. It is already computed in `processJob` at the point of the call (same `candidates.length > 0 ? candidates[0].id : submission.station_id` logic that exists on line 191 for `runPriceValidationAndUpdate`).

### Hash dedup placement

The hash is computed from the raw R2 buffer *after* `getObjectBuffer` succeeds. This is the earliest point where the buffer is available. The check happens before `extractPrices` — if the hash matches, we skip Claude and delete the photo.

The hash is stored per-call against the photo content, not per-user or per-station. A user submitting the same saved photo twice (even days later) will be caught.

### Injection order in `runOcrExtraction`

```
1. Guard: no photo_r2_key → reject 'missing_photo'
2. Fetch photo buffer (getObjectBuffer)
3. Hash check (checkHashDedup) ← NEW (AC3)
4. Call Claude (extractPrices)
5. Record spend (OcrSpendService) ← existing Story 3.9
6. OCR quality checks (confidence, prices.length, bands)
7. Record dedup keys (recordStationDedup + recordHashDedup) ← NEW (AC4)
8. Update submission with price_data + confidence
9. return true
```

### `SubmissionDedupService` Redis pattern

Follows the same pattern as `OcrSpendService`:
```ts
@Injectable()
export class SubmissionDedupService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}
  ...
}
```

The `REDIS_CLIENT` token and `Redis` type come from `'../redis/redis.module.js'`.

### Module wiring

`SubmissionDedupService` goes in `PhotoModule` (alongside `OcrSpendService`) — both are pipeline infrastructure services backed by Redis. `PhotoModule` already imports `RedisModule`. Add to providers and exports:

```ts
providers: [PhotoPipelineWorker, OcrSpendService, SubmissionDedupService],
exports: [PhotoPipelineWorker, SubmissionDedupService],
```

`SubmissionsModule` already imports `PhotoModule`, so `SubmissionsService` can inject `SubmissionDedupService` without any module changes.

### Fail-open rationale

Dedup is a cost optimisation, not a correctness gate. If Redis is down, the worst outcome is a duplicate Claude call — not a correctness violation or data loss. Consistent with the fail-open decision made for `OcrSpendService.recordSpend` in Story 3.9.

### Logger tags

Use consistent structured tags for easy log filtering:
- `[DEDUP-L1]` — intake dedup (API layer, no R2 upload)
- `[DEDUP-L2]` — worker station dedup (after GPS match, before Claude)
- `[DEDUP-HASH]` — worker hash dedup (after R2 fetch, before Claude)

Include `station=` and `submission=` in all DEDUP log messages.

## Dev Agent Record

### Implementation Plan
1. T1: `SubmissionDedupService`
2. T5: Wire into `PhotoModule`
3. T2: L1 dedup in `SubmissionsService`
4. T3: L2 station dedup in worker
5. T4: Hash dedup + key recording in `runOcrExtraction`
6. T6: Tests
7. T7: Full regression suite

### Completion Notes

- `SubmissionDedupService` created with Redis SET/GET for station (12h TTL) and hash (24h TTL) dedup keys
- L1 check injected into `SubmissionsService.createSubmission` — preselected station path only; GPS path skipped by design
- `stationId` resolution moved earlier in `processJob` (before OCR) to enable L2 check; `runOcrExtraction` receives `stationId` as second param
- L2 station dedup + hash dedup both wrapped in try/catch (fail-open on Redis error)
- Dedup keys recorded best-effort after successful OCR (both `.catch(() => warn)`)
- 662/662 tests passing, tsc clean, lint 0 errors

## File List

- `apps/api/src/photo/submission-dedup.service.ts` (new)
- `apps/api/src/photo/submission-dedup.service.spec.ts` (new)
- `apps/api/src/photo/photo-pipeline.worker.ts` (modified — L2 dedup, hash dedup, key recording)
- `apps/api/src/photo/photo-pipeline.worker.spec.ts` (modified — Story 3.10 tests)
- `apps/api/src/photo/photo.module.ts` (modified — add SubmissionDedupService to providers + exports)
- `apps/api/src/submissions/submissions.service.ts` (modified — L1 dedup)
- `apps/api/src/submissions/submissions.service.spec.ts` (modified — Story 3.10 tests)
- `_bmad-output/implementation-artifacts/3-10-submission-deduplication.md` (this file)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)
