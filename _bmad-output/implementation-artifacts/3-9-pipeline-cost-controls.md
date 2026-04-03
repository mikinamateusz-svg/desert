# Story 3.9: Pipeline Cost Controls

## Status: done

## Story

As a **developer**,
I want hard rate limits and a daily spend cap on the OCR pipeline,
So that a runaway bug, reprocessing loop, or submission flood cannot generate unbounded Claude API costs.

## Acceptance Criteria

**AC1 — BullMQ worker rate limit:**
Given the BullMQ OCR worker is initialised
When jobs arrive
Then it processes at most `OCR_WORKER_RATE_LIMIT_PER_MINUTE` jobs per minute (ENV var, default: 60)
And excess jobs remain queued and drain in order as capacity allows

**AC2 — Daily spend cap + auto-pause:**
Given the pipeline processes OCR jobs throughout the day
When cumulative Claude API spend for the current UTC day reaches `MAX_DAILY_OCR_SPEND_USD` (ENV var, default: $20)
Then the BullMQ worker pauses automatically — no new OCR jobs processed
And a `[OPS-ALERT]` structured error log is emitted with current spend, job queue depth, and instructions to resume

**AC3 — Manual resume (deferred to Story 4.4):**
Given the worker has been paused due to the daily spend cap
When an ADMIN resumes it via the admin dashboard
Then processing resumes immediately
*(Deferred: the admin endpoint/UI lives in Story 4.4. This story exposes `resumeWorker()` on the worker.)*

**AC4 — Auto-resume at UTC midnight:**
Given the worker is paused due to the daily spend cap
When the UTC day rolls over (midnight)
Then the worker resumes automatically
And the reset is logged

**AC5 — Submissions still accepted during pause:**
Given the worker is paused
When new submissions arrive
Then they are uploaded to R2 and enqueued in BullMQ normally — pause only affects processing

**AC6 — Anthropic 400 errors are non-retriable (deferred from Story 3.5 D3):**
Given the Claude API returns a 4xx error (bad request, invalid image)
When the OCR step receives it
Then the submission is rejected immediately (confidence 0.0 → low_ocr_confidence path)
And no BullMQ retry is attempted

**AC7 — getObjectBuffer size cap (deferred from Story 3.5 D1):**
Given a photo in R2 is unexpectedly large
When `getObjectBuffer` streams it
Then it throws if total bytes exceed `MAX_PHOTO_SIZE_BYTES` (default 10 MB)
And the error is transient (BullMQ retries will skip re-downloading correctly)

## Tasks / Subtasks

- [x] T1: BullMQ worker rate limiter (AC1)
  - [x] T1a: Read `OCR_WORKER_RATE_LIMIT_PER_MINUTE` from config (default 60)
  - [x] T1b: Pass `limiter: { max, duration: 60_000 }` to Worker constructor
  - [x] T1c: Add ENV var to `.env.example`

- [x] T2: Extend `OcrResult` with token usage; handle Anthropic 4xx gracefully (AC6)
  - [x] T2a: Add `input_tokens?: number; output_tokens?: number` to `OcrResult` interface
  - [x] T2b: Return `response.usage.input_tokens/output_tokens` from `extractPrices`
  - [x] T2c: Catch `APIStatusError` 4xx in `extractPrices` — return `{ prices: [], confidence_score: 0.0 }` instead of throwing

- [x] T3: `OcrSpendService` — Redis daily spend tracker (AC2)
  - [x] T3a: Create `apps/api/src/photo/ocr-spend.service.ts`
  - [x] T3b: `computeCostUsd(inputTokens, outputTokens)` — Claude Haiku 4.5 pricing ($0.80/MTok in, $4.00/MTok out)
  - [x] T3c: `recordSpend(costUsd): Promise<number>` — `INCRBYFLOAT` on `ocr:spend:{UTC_DATE}` key; set 48h TTL
  - [x] T3d: `getDailySpend(): Promise<number>` — `GET` current day key
  - [x] T3e: `getSpendCap(): number` — reads `MAX_DAILY_OCR_SPEND_USD` from config (default 20)

- [x] T4: Spend cap check + worker pause + `[OPS-ALERT]` (AC2, AC4)
  - [x] T4a: After OCR call in `runOcrExtraction`, call `recordSpend` + `checkSpendCap`
  - [x] T4b: `checkSpendCap(dailySpend)` — if `dailySpend >= cap` and not already paused, call `worker.pause()`, set `pausedForSpendCap = true`, log `[OPS-ALERT]` with spend + queue depth
  - [x] T4c: Add `private pausedForSpendCap = false` flag to worker

- [x] T5: Auto-resume at UTC midnight (AC4)
  - [x] T5a: `scheduleMidnightReset()` — `setTimeout` to next UTC midnight; on fire, if `pausedForSpendCap`, call `worker.resume()`, reset flag, log reset; reschedule
  - [x] T5b: Call `scheduleMidnightReset()` from `onModuleInit`
  - [x] T5c: `resumeWorker()` public method on worker (for Story 4.4 admin endpoint)

- [x] T6: `getObjectBuffer` size cap (AC7)
  - [x] T6a: Add size accumulator in `getObjectBuffer` streaming loop
  - [x] T6b: Throw descriptive error if total bytes exceed `MAX_PHOTO_SIZE_BYTES` (default 10 MB)

- [x] T7: Wire up module
  - [x] T7a: Add `RedisModule` import to `PhotoModule`
  - [x] T7b: Add `OcrSpendService` to `PhotoModule` providers
  - [x] T7c: Add `MAX_DAILY_OCR_SPEND_USD` and `OCR_WORKER_RATE_LIMIT_PER_MINUTE` to `.env.example`

- [x] T8: Tests
  - [x] T8a: `ocr-spend.service.spec.ts` — `computeCostUsd`, `recordSpend`, `getDailySpend`, `getSpendCap`
  - [x] T8b: `ocr.service.spec.ts` — token fields in result; Anthropic 4xx → confidence 0 (no throw)
  - [x] T8c: `storage.service.spec.ts` — size cap throws at > 10 MB
  - [x] T8d: `photo-pipeline.worker.spec.ts` — spend is recorded after OCR; cap reached → worker paused + [OPS-ALERT]; already paused → no double-pause; midnight reset resumes worker

- [x] T9: Full regression suite — 635 tests pass

## Dev Notes

### Rate limiting (AC1)

BullMQ supports worker-level rate limiting via the `limiter` option:
```ts
new Worker(PHOTO_PIPELINE_QUEUE, processor, {
  connection,
  limiter: { max: rateLimit, duration: 60_000 },
  settings: { backoffStrategy: ... },
})
```
BullMQ uses Redis Lua scripts to enforce this atomically across distributed workers. Jobs that would exceed the limit are delayed internally — they don't leave the queue and are not lost.

### Spend tracking (AC2)

Redis key pattern: `ocr:spend:{YYYY-MM-DD}` (UTC date). Value: cumulative USD as a float string (INCRBYFLOAT). TTL: 48h.

Claude Haiku 4.5 pricing constants (Story 3.9 only — update if pricing changes):
```ts
const COST_PER_INPUT_MTOKEN_USD = 0.80;   // $0.80 per million input tokens
const COST_PER_OUTPUT_MTOKEN_USD = 4.00;  // $4.00 per million output tokens
```
At ~500 input + ~100 output tokens/call, cost ≈ $0.0008/image (epics estimate: ~$0.0009).

### Anthropic SDK usage field

`response.usage.input_tokens` and `response.usage.output_tokens` are available on the `Message` type from `messages.create` (SDK 0.82+).

### Worker pause/resume

`worker.pause()` stops the worker picking up new jobs. Already-in-flight jobs complete normally. Queue depth is unaffected — queued jobs drain when `worker.resume()` is called.

`queue.getJobCounts()` provides depth for the ops alert: `{ waiting, active, delayed, failed }`.

### Midnight reset

```ts
private scheduleMidnightReset(): void {
  const now = new Date();
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const msUntilMidnight = midnight.getTime() - now.getTime();
  setTimeout(async () => {
    if (this.pausedForSpendCap) {
      await this.worker.resume();
      this.pausedForSpendCap = false;
      this.logger.log('OCR worker auto-resumed after UTC midnight spend cap reset');
    }
    this.scheduleMidnightReset(); // reschedule for next day
  }, msUntilMidnight);
}
```

### Anthropic 400 handling (AC6)

4xx errors (bad request, invalid image, etc.) are not transient — retrying won't help. Catch `APIStatusError` and return confidence 0.0 so the existing `low_ocr_confidence` path rejects gracefully without exhausting retries.

5xx / network errors still throw → BullMQ retries as before.

### getObjectBuffer size cap (AC7)

Accumulate `totalBytes` in the streaming loop. Throw before `push` if `totalBytes > MAX_PHOTO_SIZE_BYTES`. 10 MB default: photos from the camera step are compressed JPEGs and should never exceed 5 MB in practice.

### Ops alert channel

AC2 says "via the same channel configured in Story 4.4". Story 4.4 admin infra doesn't exist yet. For now, ops alert = `[OPS-ALERT]` structured log (same pattern as Story 3.8). Story 4.4 will wire up the actual notification channel.

### Manual resume (AC3 deferred)

Expose `resumeWorker(): Promise<void>` on the worker (public method). Story 4.4 will add an admin endpoint that calls it.

## Dev Agent Record

### Implementation Plan
1. T2: Extend OcrService (token usage, 4xx handling)
2. T6: StorageService size cap
3. T3: OcrSpendService
4. T1 + T4 + T5: Worker changes (rate limit, spend check, midnight reset)
5. T7: Module wiring
6. T8: Tests
7. T9: Full suite

### Completion Notes

*(filled on completion)*

## File List

- `apps/api/src/ocr/ocr.service.ts` (modified — token usage, 4xx handling)
- `apps/api/src/ocr/ocr.service.spec.ts` (modified — Story 3.9 tests)
- `apps/api/src/storage/storage.service.ts` (modified — size cap)
- `apps/api/src/storage/storage.service.spec.ts` (modified — size cap tests)
- `apps/api/src/photo/ocr-spend.service.ts` (new)
- `apps/api/src/photo/ocr-spend.service.spec.ts` (new)
- `apps/api/src/photo/photo-pipeline.worker.ts` (modified — rate limit, spend check, midnight reset)
- `apps/api/src/photo/photo-pipeline.worker.spec.ts` (modified — Story 3.9 tests)
- `apps/api/src/photo/photo.module.ts` (modified — RedisModule + OcrSpendService)
- `apps/api/.env.example` (modified — new ENV vars)
- `_bmad-output/implementation-artifacts/3-9-pipeline-cost-controls.md` (this file)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)

## Review Findings

- **3 patches applied (P-1/P-2/P-3), 8 deferred, 7 rejected**
- P-1: `getSpendCap()` NaN guard — fallback to 20 on non-numeric config
- P-2: `OCR_WORKER_RATE_LIMIT_PER_MINUTE` invalid/zero — clamp to 60 on bad config
- P-3: Anthropic 429 excluded from non-retriable 4xx range — BullMQ retries as expected
- 639/639 tests passing

## Deferred

- **D1** — Concurrent jobs can exceed cap by up to concurrency×cost before pause fires (by design; post-hoc tracking)
- **D2** — Fail-open on Redis failure: spend cap bypassed during Redis outage (deliberate availability trade-off; document before go-live)
- **D3** — `parseResponse` returns `input_tokens: 0` — fragile if called outside `extractPrices` (low risk for MVP)
- **D4** — Midnight reset doesn't verify Redis key rolled over before resuming (low probability with `.unref()` + Node timer precision)
- **D5** — `resumeWorker()` state inconsistency on BullMQ error; midnight timer will self-correct (minor)
- **D6** — TTL `expire` call can extend an expiring key at midnight boundary (Redis memory waste only, functionally harmless)
- **D7** — `setTimeout` handle not stored; `onModuleDestroy` cannot cancel the midnight timer (`.unref()` handles process-exit; low risk)
- **D8** — `getObjectBuffer` size cap not ENV-configurable (`MAX_PHOTO_SIZE_BYTES` implied by spec but hardcoded constant acceptable for MVP)

## Change Log

- 2026-04-03: Story 3.9 created and implementation started.
- 2026-04-03: Code review complete — P-1/P-2/P-3 applied; D1–D8 logged.
