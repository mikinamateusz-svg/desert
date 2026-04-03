# Story 3.7: Price Validation & Database Update

## Status: review

## Story

As a **developer**,
I want the pipeline to validate extracted prices against market-aware bands and publish them atomically,
So that only plausible prices reach drivers and OCR misreads are caught before going live.

## Acceptance Criteria

**AC1 — Tier 1 validation (recent price):**
Given OCR has extracted a price for a fuel type where a recent price exists (last 30 days)
When the price is validated
Then it is accepted if within ±20% of the last known price for that station + fuel type
And flagged for ops review if outside that band — never silently rejected or published

**AC2 — Tier 2 validation (regional benchmark, Story 5.0 only):**
Given OCR has extracted a price for a fuel type where the last known price is older than 30 days
When the price is validated
And the `regional_benchmarks` table is available (Story 5.0 deployed)
Then it is accepted if within ±30% of the regional voivodeship average for that fuel type
And if the `regional_benchmarks` table is not yet available, Tier 3 absolute range is used instead

**AC3 — Tier 3 validation (absolute range, cold start):**
Given OCR has extracted a price for a fuel type with no price history at all (new station or cold start)
When the price is validated
Then it is accepted if within the absolute fallback range:
- PB_95: 4.00–12.00 PLN/litre
- PB_98: 4.50–13.00 PLN/litre
- ON: 4.00–12.00 PLN/litre
- ON_PREMIUM: 4.50–13.00 PLN/litre
- LPG: 1.50–5.00 PLN/litre
- AdBlue: 3.00–15.00 PLN/litre
And flagged for ops review if outside that range

**AC4 — Tier 2 fallback (Story 5.0 not deployed):**
Given Story 5.0 has not yet been deployed
When a submission is validated and the last known price is older than 30 days
Then Tier 3 (absolute range) is used directly — no attempt is made to query `regional_benchmarks`
And the pipeline continues normally without error

**AC5 — Database update on verification:**
Given at least one valid price passes validation
When the database update runs
Then the `Submission` status is set to `verified`
And the `price_data` field is updated to contain only the validated prices
And a new `price_history` record is created for each verified fuel type
And the staleness flag is cleared for each verified (station × fuel_type) combination
And the Redis cache for that station is invalidated and rewritten atomically in the same operation

**AC6 — R2 cleanup (verified):**
Given the database update completes on a verified submission
When R2 cleanup runs
Then the photo is deleted from R2 and `photo_r2_key` is nulled on the `Submission`

**AC7 — All prices fail validation:**
Given all extracted prices fail validation
When the submission is evaluated
Then it is marked `status: rejected` with reason `price_validation_failed`
And the photo is deleted from R2

**AC8 — Duplicate fuel type deduplication (D2 from Story 3.5):**
Given OCR returned duplicate entries for the same fuel type
When price validation runs
Then only the first occurrence is validated — duplicates are silently dropped

## Tasks / Subtasks

- [x] T1: Create PriceValidationService
  - [x] T1a: Define ABSOLUTE_BANDS constant (Tier 3 ranges from AC3)
  - [x] T1b: Implement `validatePrices(stationId, prices)` — deduplication + Tier 1 / Tier 3 dispatch
  - [x] T1c: Implement `fetchRecentPrices(stationId, fuelTypes)` — PriceHistory query ≤30 days

- [x] T2: Write PriceValidationService unit tests (price-validation.service.spec.ts)
  - [x] T2a: Tier 1 — valid (within ±20% of recent price)
  - [x] T2b: Tier 1 — invalid (outside ±20%)
  - [x] T2c: Tier 1 boundary — just inside upper/lower bounds
  - [x] T2d: Tier 3 — valid (no recent history, within absolute range)
  - [x] T2e: Tier 3 — invalid (outside absolute range)
  - [x] T2f: Mixed prices — some Tier 1, some Tier 3
  - [x] T2g: Deduplication — first occurrence wins
  - [x] T2h: Empty prices array → empty valid/invalid arrays

- [x] T3: Wire PriceValidationService into PriceModule and PhotoModule
  - [x] T3a: Add PriceValidationService to providers + exports in price.module.ts
  - [x] T3b: Add PriceModule to imports in photo.module.ts

- [x] T4: Implement runPriceValidationAndUpdate in PhotoPipelineWorker
  - [x] T4a: Inject PriceService and PriceValidationService into worker constructor
  - [x] T4b: Resolve stationId from candidates / preselected path
  - [x] T4c: Re-fetch submission for updated price_data
  - [x] T4d: Call validatePrices — reject on all-invalid, proceed on any-valid
  - [x] T4e: Update submission: status=verified, price_data=valid-only, photo_r2_key=null
  - [x] T4f: Delete photo from R2 (best-effort — log on failure, do not throw)
  - [x] T4g: Call priceService.setVerifiedPrice (history + cache)
  - [x] T4h: Clear staleness flags per validated fuel type
  - [x] T4i: Replace Story 3.7 stub, update init log

- [x] T5: Write worker Story 3.7 tests (photo-pipeline.worker.spec.ts)
  - [x] T5a: Happy path — all prices valid → submission verified, photo deleted, cache updated, staleness cleared
  - [x] T5b: Partial validation — some prices valid, some not → submission verified with valid-only price_data
  - [x] T5c: All prices fail validation → rejected (price_validation_failed), photo deleted
  - [x] T5d: R2 deletion failure → logged, pipeline does NOT throw
  - [x] T5e: price_data is null/empty after OCR → reject
  - [x] T5f: Preselect path — stationId taken from submission.station_id (candidates=[])

- [x] T6: Run full regression suite and confirm all tests pass

## Dev Notes

### Architecture context

- **No separate Price table** — the "current price" for a station is the `price_data` JSON from the latest `verified` Submission for that station. The read path in `PriceService.findPricesByStationIds` queries `DISTINCT ON (station_id)` the latest verified submission.
- **PriceHistory table** — one row per verified fuel type per verification event. Used for Tier 1 lookups and the history chart.
- **PriceCacheService.setAtomic** — atomically DEL + SETEX; call via `PriceService.setVerifiedPrice`.
- **StationFuelStaleness** — clear via `prisma.stationFuelStaleness.deleteMany` directly in the worker (no need to import StalenessDetectionService; Prisma access is already available).

### Tier 2 deferred

Tier 2 (±30% of voivodeship regional average) depends on the `regional_benchmarks` table from Story 5.0. At Phase 1 launch, Story 5.0 is not deployed — Tier 2 is skipped entirely (not a no-op fallback, just absent). No code or config needed; Tier 1 → Tier 3 is the complete Phase 1 chain.

### Price data flow

OCR writes `price_data` to DB during `runOcrExtraction`. The in-memory `submission` in `processJob` was fetched before OCR ran, so `price_data` is stale. **Re-fetch the submission** inside `runPriceValidationAndUpdate` to get the updated value.

### Station ID resolution in processJob

After `runGpsMatching`:
- GPS path: `candidates[0].id` is the matched stationId
- Preselect path: `candidates = []`, original `submission.station_id` is used

Resolve as: `const stationId = candidates.length > 0 ? candidates[0].id : submission.station_id;`
Guard against null (should never happen — GPS step guarantees station_id is set on both paths).

### Deduplication (D2 from Story 3.5)

OCR can return duplicate fuel_type entries. Deduplicate before validation: first occurrence wins. Implement inside `PriceValidationService.validatePrices`.

### R2 cleanup semantics

- **Verified path**: null `photo_r2_key` in the same DB update that sets `status=verified`, then delete from R2 separately (best-effort).
- **Rejected path** (price_validation_failed): `rejectSubmission()` already handles photo deletion — call it directly.
- **shadow_rejected (I1)**: photo kept for ops review (user chose Option C in Story 3.6 review). Deferred to ops tooling.

### PriceHistory query for Tier 1

```sql
SELECT DISTINCT ON (fuel_type) fuel_type, price
FROM "PriceHistory"
WHERE station_id = $stationId
  AND fuel_type IN (...)
  AND recorded_at >= NOW() - INTERVAL '30 days'
ORDER BY fuel_type, recorded_at DESC
```

Use `Prisma.sql` with `Prisma.join(fuelTypes)` for the IN clause.

### Module wiring

- `PriceValidationService` → `price.module.ts` (providers + exports)
- `PriceModule` → `photo.module.ts` (imports)
- Worker constructor: inject `PriceService` and `PriceValidationService`

### StationPriceRow shape for setVerifiedPrice

```typescript
{
  stationId: string,
  prices: Record<string, number>,     // fuel_type → price_per_litre (validated only)
  sources: Record<string, 'community'>, // all 'community' for user submissions
  updatedAt: Date,                     // new Date() at time of verification
}
```

## Dev Agent Record

### Implementation Plan
1. Create `price-validation.service.ts` with ABSOLUTE_BANDS + validatePrices + fetchRecentPrices
2. Create `price-validation.service.spec.ts` with full unit test coverage
3. Update `price.module.ts` to register PriceValidationService
4. Update `photo.module.ts` to import PriceModule
5. Update `photo-pipeline.worker.ts`: inject services, add runPriceValidationAndUpdate, resolve stationId
6. Update `photo-pipeline.worker.spec.ts` with Story 3.7 test cases
7. Run full suite

### Completion Notes

- Created `PriceValidationService` with Tier 1 (±20% recent price) and Tier 3 (absolute bands) validation. Tier 2 skipped — depends on Story 5.0 regional_benchmarks table.
- `ABSOLUTE_BANDS` uses epic-spec values (PB_98/ON_PREMIUM differ from OCR's PRICE_BANDS; LPG min=1.5 not 2.0).
- Deduplication implemented inside `validatePrices` — addresses D2 from Story 3.5.
- `runPriceValidationAndUpdate` in worker: re-fetches submission for price_data, validates, marks verified with valid-only prices, deletes photo, calls setVerifiedPrice, clears staleness flags.
- All R2/staleness failures are best-effort (log + continue) — does not block pipeline or trigger BullMQ retry.
- shadow_rejected photo deletion (I1 from Story 3.6) kept deferred — user chose Option C (photo for ops review).
- 20 new PriceValidationService tests + 14 new worker Story 3.7 tests. 592 total tests passing.

## File List

- `apps/api/src/price/price-validation.service.ts` (new)
- `apps/api/src/price/price-validation.service.spec.ts` (new)
- `apps/api/src/price/price.module.ts` (modified — added PriceValidationService)
- `apps/api/src/photo/photo.module.ts` (modified — added PriceModule import)
- `apps/api/src/photo/photo-pipeline.worker.ts` (modified — Story 3.7 implementation)
- `apps/api/src/photo/photo-pipeline.worker.spec.ts` (modified — Story 3.7 tests)
- `_bmad-output/implementation-artifacts/3-7-price-validation-database-update.md` (new)

## Change Log

- 2026-04-03: Story 3.7 implemented. PriceValidationService (Tier 1 + Tier 3), worker integration, R2 cleanup, cache + history + staleness update. 592 tests passing.
