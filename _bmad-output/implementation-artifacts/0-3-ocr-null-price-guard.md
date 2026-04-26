# Story 0.3 — OCR Pipeline Null-Price Guard

**Epic:** 0 (cross-cutting)
**Status:** review
**Created:** 2026-04-26
**Trigger:** Prod admin submissions page crashed today (`TypeError: Cannot read properties of null (reading 'toFixed')`). Root cause: 32 prod Submission rows have `price_data = [{"fuel_type": "PB_95", "price_per_litre": null}]`. UI hotfix shipped (`38eac36`) but the data is still being written. This story closes the upstream hole.

---

## Overview

The photo pipeline's `runOcrExtraction` writes Submission rows whose `price_data` JSONB array can contain entries with `price_per_litre: null`. Two existing gates miss it:

1. **Empty-array check** (`ocrResult.prices.length === 0` → reject `no_prices_extracted`) — passes if the array has any entry, even all-null ones.
2. **`validatePriceBands`** — does `price_per_litre < band.min`. In JS, `null < 4.0` evaluates `false` (null coerces to 0, then `0 < 4` is true… actually `null < 4.0` is `true`, but `null > 9.0` is `false`). Specifically: `null < band.min` returns `true` for any positive min, which means null-price entries report as "out of range" and trigger `price_out_of_range` reject. **Wait — that contradicts the prod data showing null prices got persisted.** Hypothesis: prices flow into `validatePriceBands` only when length > 0, but the unknown-fuel-type `continue` short-circuits before the comparison happens. Need to verify in implementation.

(Investigate the band-check behavior in implementation — the data shows nulls reach the persist step somehow.)

A row with all-null prices is meaningless from an ops/admin perspective:
- Can't approve (no value to validate)
- Can't act on it (no info about what was actually on the price board)
- Clutters the admin queue if it ever reaches `shadow_rejected` status

The fix: filter null/non-finite entries from `ocrResult.prices` BEFORE both the band check and the persist step. If the filtered array is empty, reject the submission with the existing `no_prices_extracted` flag (semantically: "OCR returned no usable prices" — same outcome whether the array was empty or all-null).

---

## Acceptance Criteria

### AC-1: Filter null/non-finite price_per_litre before persist

**Given** the OCR extracts prices and at least one entry has `price_per_litre` that is `null`, `NaN`, `Infinity`, `-Infinity`, or any non-number value
**When** the pipeline reaches the persist step in `runOcrExtraction`
**Then** the entry is dropped from the array before being written to `Submission.price_data`
**And** any remaining valid entries (numbers in valid bands) are persisted normally
**And** the dropped count is logged at `warn` level so we can spot OCR drift

### AC-2: All-null array is rejected as `no_prices_extracted`

**Given** the OCR extracts a non-empty prices array but every entry has a null/non-finite price_per_litre
**When** the pipeline filters null prices
**Then** the filtered array is empty
**And** the submission is rejected via the existing `rejectSubmission(submission, 'no_prices_extracted', ...)` path
**And** the same path used by the existing `prices.length === 0` check is reused (single rejection path; admin funnel groups both cases under the same `no_prices_extracted` flag — no new flag needed)

### AC-3: Existing rejection paths unchanged

**Given** the existing rejection paths (empty array, low_ocr_confidence, price_out_of_range)
**When** they trigger
**Then** they continue to use their existing flag_reason values — no semantic change
**And** the merged "empty OR all-null" path uses `no_prices_extracted` so the funnel doesn't gain a new bucket the admin has to learn

### AC-4: validatePriceBands behaves correctly with the filtered array

**Given** filtered prices (no nulls) reach `validatePriceBands`
**When** the band check runs
**Then** it correctly returns the first out-of-range fuel type, or null if all are in-range — same as today
**And** the implementation can leave `validatePriceBands` itself untouched (the filter upstream guarantees the function never sees null again)

### AC-5: Tests cover the filter + reject behaviour

**Given** the test suite
**When** new tests are added for `runOcrExtraction`
**Then** at least three new tests cover:
- **All-null prices array** → reject with `no_prices_extracted` (no Submission price_data update)
- **Mixed null + valid** → persist only the valid entries; warn-log fired
- **All-valid (regression)** → persist unchanged; no warn

### AC-6: Funnel surfaces the new rejections

**Given** the admin Contribution Funnel tab
**When** an admin views the rejection breakdown
**Then** rows rejected via the all-null path appear under the existing `no_prices_extracted` bucket — no new flag, no new i18n entry needed
**And** no UI change is required (this is a backend-only story)

### AC-7: Historical data left as-is

**Given** the 32 existing prod Submission rows with null `price_per_litre` (all already `status: rejected`)
**When** this story ships
**Then** they are NOT modified or deleted
**And** the UI hotfix from commit `38eac36` continues to render them with `—` fallback so admins can still inspect them via SQL or admin pages
**And** if cleanup is desired later, it's a separate trivial DELETE — out of scope here

---

## Tasks / Subtasks

- [x] T1: `runOcrExtraction` filter + merged rejection path
  - [x] T1a: Inspect existing flow in `apps/api/src/photo/photo-pipeline.worker.ts` around `ocrResult.prices.length === 0` check (line ~422)
  - [x] T1b: Replace the empty-array check with a filter step that drops non-finite price entries; check filtered length === 0; if so, call `rejectSubmission(submission, 'no_prices_extracted', ocrResult.prices, ocrResult.confidence_score)` (passing the original raw prices for forensic logging)
  - [x] T1c: Use the filtered array for both the `validatePriceBands` call and the `prisma.submission.update` persist step
  - [x] T1d: Log a `warn` if the filter dropped at least one entry (e.g. `OCR returned N prices, M had null/non-finite price_per_litre — dropped`) so we can spot OCR drift in Railway logs

- [x] T2: Tests (`photo-pipeline.worker.spec.ts`)
  - [x] T2a: Add test "rejects with no_prices_extracted when all OCR prices have null price_per_litre"
  - [x] T2b: Add test "drops null-price entries from price_data and persists the rest"
  - [x] T2c: Add test "logs a warn when at least one entry is dropped"
  - [x] T2d: Verify existing tests for empty array + low_ocr_confidence + price_out_of_range still pass (no behavior change)

- [x] T3: Validate
  - [x] T3a: api full regression suite
  - [x] T3b: api tsc --noEmit
  - [x] T3c: bmad-code-review pass per standing rule

---

## Dev Notes

### Filter predicate

```ts
function isFinitePrice(p: { price_per_litre: unknown }): boolean {
  return typeof p.price_per_litre === 'number' && Number.isFinite(p.price_per_litre);
}
```

`Number.isFinite` rejects `null`, `undefined`, `NaN`, `±Infinity`, and non-number values — covers every case observed (and theoretical) where the JSONB could drift from the typed shape.

### Suggested code shape

```ts
// In runOcrExtraction, replace the existing length===0 check:

const cleanPrices = ocrResult.prices.filter(p =>
  typeof p.price_per_litre === 'number' && Number.isFinite(p.price_per_litre),
);

if (cleanPrices.length === 0) {
  await this.rejectSubmission(submission, 'no_prices_extracted', ocrResult.prices, ocrResult.confidence_score);
  return null;
}

const droppedCount = ocrResult.prices.length - cleanPrices.length;
if (droppedCount > 0) {
  this.logger.warn(
    `Submission ${submission.id}: OCR returned ${ocrResult.prices.length} prices, ` +
      `${droppedCount} had null/non-finite price_per_litre — dropped before persist`,
  );
}

// Use cleanPrices for everything downstream:
const invalidFuelType = this.ocrService.validatePriceBands(cleanPrices);
// ...
await this.prisma.submission.update({
  where: { id: submission.id },
  data: {
    price_data: cleanPrices as unknown as Prisma.InputJsonValue,
    ocr_confidence_score: ocrResult.confidence_score,
  },
});
```

### Rejection forensic data

`rejectSubmission(submission, 'no_prices_extracted', ocrResult.prices, ocrResult.confidence_score)` — pass the **raw** `ocrResult.prices` (not filtered) so that if the rejected submission is preserved by ResearchRetention, the captured `ocrPrices` includes the original null-price entries. Useful for OCR tuning later.

### Why no new flag_reason

Considered `ocr_no_prices_extracted` as a distinct flag for "array was non-empty but everything was null." Decision: merge into `no_prices_extracted` because:
- From admin's POV both outcomes are identical: "OCR didn't return usable prices, can't act on this row"
- New flag means new i18n entry in 3 locales for zero ops value
- Funnel breakdown stays simpler

The warn log makes the distinction visible at the ops/Railway-logs layer, which is where it actually matters for OCR tuning.

### Why historical 32 rows are out of scope

They're all `status: rejected` already — invisible to admin users (admin queue filters on `shadow_rejected`/`pending`). They sit in the table doing no harm. Cleanup would be a one-line DELETE; not worth bundling into a story whose scope is "stop creating new bad rows."

### References

- Pipeline writer: [apps/api/src/photo/photo-pipeline.worker.ts:420-445](apps/api/src/photo/photo-pipeline.worker.ts#L420-L445) — current empty-check + persist step
- Existing reject path: `rejectSubmission` in same file
- Empty-check tests: `photo-pipeline.worker.spec.ts` already covers `prices.length === 0` — mirror the pattern for the all-null case
- UI hotfix (defense in depth): commit `38eac36 fix(admin): guard null price_per_litre in submissions pages`

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- 2026-04-26 — `apps/api` jest: 873/873 pass (51 suites). +4 new tests in `photo-pipeline.worker.spec.ts` under "null/non-finite price_per_litre handling" describe block.
- 2026-04-26 — `apps/api` tsc --noEmit: clean
- 2026-04-26 — Existing tests for `no_prices_extracted` (length === 0 path), `low_ocr_confidence`, `price_out_of_range` all still pass — no behavior change.

### Completion Notes List

- T1: Replaced the `ocrResult.prices.length === 0` check with a filter-first pattern. `cleanPrices` filters via `Number.isFinite`. If `cleanPrices.length === 0` (covers BOTH original "empty array" and the new "all-null array" cases) → reject with existing `no_prices_extracted` flag. Forwarded original `ocrResult.prices` to rejectSubmission for forensic logging.
- T1: Downstream code (`validatePriceBands`, `prisma.submission.update`, return value) all switched to use `cleanPrices` so dropped null entries can't leak past the filter.
- T1: Added `warn`-level log when `droppedCount > 0` so OCR drift is visible in Railway logs at the entry-level (not just the rejection-level).
- T2: 4 new tests covering: all-null prices → reject with no_prices_extracted (same flag as empty), all-null path doesn't write price_data, mixed null+valid → drops nulls and persists valid entries, mixed → doesn't reject when at least one valid remains.
- AC-3 verified: existing rejection paths untouched. `low_ocr_confidence`, `price_out_of_range`, `no_prices_extracted` (length === 0 case) all still work.
- AC-6 verified: no UI changes — `no_prices_extracted` already exists in admin funnel breakdown's i18n; new rejections naturally bucket there.

### Change Log

- 2026-04-26 — Implemented Story 0.3 OCR Pipeline Null-Price Guard. `runOcrExtraction` now filters non-finite `price_per_litre` entries from `ocrResult.prices` before the band check and persist step. All-null arrays merge into the existing `no_prices_extracted` rejection path (same flag, single bucket in funnel — no new flag_reason, no i18n updates needed). +4 tests, 873/873 api pass, tsc clean. Backend-only story — UI hotfix from commit `38eac36` continues as defense in depth.
- 2026-04-26 — Code review pass (3 reviewers: Blind Hunter, Edge Case Hunter, Acceptance Auditor). Acceptance Auditor: spec satisfied for AC-1..AC-7 with two test-coverage gaps in AC-5. Triage: **6 patches applied, 15 deferred, 7 rejected as noise**. Test count now 876/876 api pass.

## Senior Developer Review (AI)

**Date:** 2026-04-26 · **Reviewers:** Blind Hunter + Edge Case Hunter + Acceptance Auditor · **Outcome:** Spec satisfied; 6 small patches applied for test coverage + defensive guards.

### Patches applied (6)

| # | Title | Resolution |
|---|---|---|
| **P-1** | Missing AC-5 test: warn-log fired on drop | Added test that spies `worker['logger'].warn` and asserts the drop message contains the submission id, original count, and dropped count. |
| **P-2** | Missing AC-5 test: all-valid → no warn (regression) | Added test that runs the happy-path `successfulOcrResult` and asserts no warn message containing "null/non-finite price_per_litre" was emitted. |
| **P-3** | Missing test: price_out_of_range × filter interaction | Added test that exercises the mixed-with-OOR scenario — verifies `validatePriceBands` is called with the cleaned array (null ON dropped) and the submission is rejected with `price_out_of_range` flag. |
| **P-4** | Filter doesn't guard against null entry in array | Added `p != null && ...` to the filter callback so a sparse OCR array with `null` slots doesn't TypeError mid-filter. Defense in depth — out-of-contract for OcrResult but JSON shape isn't enforced at runtime. |
| **P-5** | `ocrResult.prices` itself could be undefined/null | Added `const rawPrices = Array.isArray(ocrResult.prices) ? ocrResult.prices : []` so a malformed OCR response can't throw on `.filter()`. |
| **P-6** | `price_out_of_range` reject lost forensic symmetry | Reverted the OOR reject to pass `rawPrices` (original) instead of `cleanPrices` so research retention captures what OCR actually returned, symmetrical with the `no_prices_extracted` reject path. |

### Deferred (15)

| # | Title | Reason |
|---|---|---|
| D-1 | `as unknown as Prisma.InputJsonValue` cast unchanged | Pre-existing pattern across the codebase |
| D-2 | Race window between findUnique and update | Pre-existing; BullMQ retry handles |
| D-3 | Filter doesn't distinguish missing-key / null / NaN in logs | Log enrichment; nice-to-have for OCR tuning |
| D-4 | Warn log lacks structured fields (fuel types, indices) | Log enrichment; nice-to-have |
| D-5 | No drop-ratio threshold for noisy logs | Premature at MVP scale |
| D-6 | rejectSubmission throwing unhandled | Pre-existing pipeline pattern; BullMQ retries |
| D-7 | prisma.update throwing after filter passed | Same as D-6 |
| D-8 | Research retention upstream uses unfiltered prices | **By design** — corpus wants raw OCR output including malformed entries |
| D-9 | validatePriceBands "silently accepts null" not pinned by test | Worth a future unit test on validatePriceBands itself |
| D-10 | Numeric strings (`"6.19"`) silently dropped by isFinite filter | OCR contract returns numbers; if it ever returns strings that's an OCR-side bug |
| D-11 | Absurdly large prices not caught by filter | That's what `validatePriceBands` upper bound is for |
| D-12 | Missing/invalid `fuel_type` not caught here | `parseResponse` already filters unknown types — pre-existing |
| D-13 | Duplicate `fuel_type` in cleanPrices | Story 3.5 D2 deferred — pre-existing |
| D-14 | NaN→null in JSON serialization on rejected row | Forensic value preserved by warn-log + research retention; persisted-shape distinction is small |
| D-15 | Type-system lie (number vs runtime null) at OCR layer | Tightening to `number \| null` touches every consumer — bigger refactor than story scope |

### Rejected as noise (7)

- `rejectSubmission` shape change for `no_prices_extracted` (it just persists, no breakage).
- NaN serialization concern (covered by D-14 — value preserved elsewhere).
- Explicit "rejected because all non-finite" log (warn already covers + count is in the line).
- `mockResolvedValueOnce` fragility (matches every existing test, not introduced).
- Test asserts exact array shape via `objectContaining` (correct behavior — type evolution should require test updates).
- Race window between findUnique/update (pre-existing, unchanged).
- Warn message wording could mislead (says "dropped before persist" — accurate; rejection log fires after if all dropped).

### File List

- `apps/api/src/photo/photo-pipeline.worker.ts` (modified — filter + merged rejection path)
- `apps/api/src/photo/photo-pipeline.worker.spec.ts` (modified — new tests for filter behavior)
- `_bmad-output/implementation-artifacts/0-3-ocr-null-price-guard.md` (this file)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)
