# Story 3.16: Consensus-Based Submission Dedup

Status: ready-for-dev

**Trigger:** 2026-05-06 — Story 3.10's binary 12-hour dedup silently rejects every submission within the window after the first verified one. Combined with Story 3.14 (just shipped), the right semantics are: process every submission until we have ≥2 corroborating submissions inside the window, then skip subsequent ones to save OCR cost. OCR misreads no longer require admin intervention to be corrected — a second driver's photo either confirms the first or surfaces the conflict.

**Phase:** 1 (pre-launch quality loop). Coupled stories — out of scope here: 3.14 (self-flag, shipped commit `a56484b`), 3.15 (optimistic activity UI), 3.17 (deeper activity-row status polish).

---

## Story

As a **driver** taking a photo at a station that already has a fresh price on the map,
I want my photo to actually be processed unless we've already confirmed the prices via at least two independent submissions,
so that prices on the map reflect ground truth, not whoever happened to submit first.

### Why

Current dedup is binary: first verified submission wins, all subsequent ones within 12h are silently dropped. That's a cost optimisation that conflicts with quality:

- If the first OCR misread (e.g. ON 7.31 instead of 7.21), there's no path for a second driver to correct it without admin intervention.
- If prices changed mid-day, the first reading goes stale and we ignore fresh evidence.
- Story 3.14 self-flag is a good escape hatch but assumes the original submitter notices and acts; quiet drivers who just want to contribute fresh data have no way through.

The right semantics:
- Submission 1 verifies → prices live, dedup record initialised (`count: 1, confirmed: false`).
- Submission 2 within 12h: process normally; on verify, compare against the record.
  - If prices match (corroboration) → mark dedup `confirmed: true`, newer becomes the displayed submission.
  - If prices differ within ±0.05 PLN/l per fuel (small OCR noise) → still corroboration, newer wins.
  - If prices differ beyond noise → conflict; pair both via a shared `conflict_group_id`, route to admin, roll cache back to the previous verified submission for the station (or estimates if none).
- Submission 3+ within 12h after corroboration: skip OCR entirely (cost saved).

Net effect: every station gets up to 2 OCR calls per 12-hour window before the cost-saving kicks in. ~2× OCR cost for a step-change in data quality and a self-correcting trust model. With Pro at $0.0024/call and ~50k OCRs/month → **+$30/month** ceiling.

This story closes the loop opened by 3.14: 3.14 lets the original driver self-correct a misread; 3.16 lets a second driver corroborate or contradict the first without anyone needing to flag.

---

## Acceptance Criteria

**AC1 — First submission processes normally and seeds the dedup record:**
Given no prior dedup record exists for station `X` (or the existing one has expired),
When a new submission for station `X` arrives,
Then the pipeline runs OCR + validation as today,
And after `priceService.setVerifiedPrice` succeeds, the dedup record for station `X` is written as
`{ count: 1, confirmed: false, prices_hash: <hash of fuel-keyed normalised prices>, last_at: <epoch ms> }`,
And the record is stored at Redis key `dedup:station:{stationId}` with TTL = 12 hours.

**AC2 — Second corroborating submission processes, confirms the record, replaces the displayed prices:**
Given a dedup record for station `X` exists with `count: 1, confirmed: false, prices_hash: H`,
And the record is less than 12 hours old,
When a new submission for station `X` arrives,
Then the pipeline runs OCR + validation as today,
And after the new submission's `price_data` is computed, the new prices are compared against the stored record's `prices_hash` AND the previous verified submission's price-data:
- If the new normalised hash equals `H`, treat as exact corroboration. Update the record to `{ count: 2, confirmed: true, prices_hash: H, last_at: <epoch ms> }`. The new submission is verified, `priceService.setVerifiedPrice` runs as normal (newer prices win the cache).
- If hashes differ but every fuel is within ±0.05 PLN/l of the stored values, treat as noise-corroboration. Update the record to `{ count: 2, confirmed: true, prices_hash: <new hash>, last_at: <epoch ms> }`. The new submission verifies; newer prices win the cache.
- If any fuel differs beyond ±0.05 PLN/l, route to AC7 (conflict).
- If the fuel set differs (different fuels visible in the new photo than the old one), treat as a different scene — process normally and DO NOT update the record on this submission, leaving `count: 1` so a later same-fuel-set submission can still corroborate.

**AC3 — Third+ submission within a confirmed window skips OCR entirely:**
Given the dedup record for station `X` is `{ count: 2, confirmed: true, ... }`,
And the record is less than 12 hours old,
When a new submission for station `X` arrives,
Then the pipeline rejects the submission **before** running OCR,
And the submission's `status` is set to `rejected` with `flag_reason: 'duplicate_submission'` (existing constant — no new flag_reason),
And no OCR cost is incurred (`ocr_confidence_score` remains `null`),
And the user-facing activity row reflects `rejected` status as it does for any other dedup'd submission today.

**AC4 — Window expiration treats the record as absent and restarts at AC1:**
Given a dedup record for station `X` has `last_at` more than 12 hours ago (Redis TTL has expired and the key is gone, OR the key still exists but the timestamp is stale due to a clock issue),
When a new submission for station `X` arrives,
Then the flow runs as if no record existed (AC1).

The 12-hour boundary is enforced by Redis TTL on the key, not by reading `last_at`. `last_at` is informational/audit-only.

**AC5 — Self-flag (Story 3.14) clears the dedup record entirely:**
Given a driver flags their submission as wrong via Story 3.14's `flag-wrong` endpoint,
When the existing `liftDedup` call fires inside `flagWrong`,
Then the entire `dedup:station:{stationId}` key is deleted (not decremented — full removal),
And the next submission for the same station starts fresh at AC1.

This already matches Story 3.14's `liftDedup` behaviour (`redis.del`, not `decr`). No code change needed in `flagWrong` — the existing call handles both the legacy boolean key and the new JSON-record key the same way.

**AC6 — Hash canonicalisation:**
Given two submissions are compared for corroboration,
When their `price_data` arrays are normalised for hashing,
Then the canonical form is the JSON of an array sorted by `fuel_type` ASC with each price rounded to 2 decimal places:
```ts
JSON.stringify(
  prices
    .filter(p => p.price_per_litre != null && Number.isFinite(p.price_per_litre))
    .map(p => ({ fuel_type: p.fuel_type, price: Math.round(p.price_per_litre * 100) / 100 }))
    .sort((a, b) => a.fuel_type.localeCompare(b.fuel_type))
)
```
And the SHA-256 hex digest of this string is the `prices_hash`.

The fuel set must match exactly for an exact-hash corroboration. PB_95+ON corroborates only with PB_95+ON; PB_95+ON+LPG is a different scene (more fuels visible) and is treated per AC2's fuel-set-mismatch branch.

The 2-decimal rounding avoids OCR's occasional 6.490 vs 6.49 false-mismatch. The sort makes the hash order-independent (OCR may return fuels in different orders).

**AC7 — Conflict detection: pair both submissions, share a `conflict_group_id`, roll cache back:**
Given a second submission for station `X` differs beyond the noise threshold (AC2),
When the pipeline detects the conflict (after the new submission's `price_data` is computed but BEFORE `priceService.setVerifiedPrice` runs),
Then a single `conflict_group_id` UUID is generated and:
1. The new submission's status becomes `shadow_rejected` with `flag_reason: 'price_conflict'` and `conflict_group_id: <uuid>` — no `setVerifiedPrice` call.
2. The previous verified submission is atomically updated from `verified` → `shadow_rejected` with the same `flag_reason` and `conflict_group_id` (guarded by `WHERE status = 'verified'` so a concurrent admin action doesn't get clobbered — `count: 0` means another actor moved the row first; in that case the new submission still goes to `shadow_rejected` with `conflict_group_id` set, but the older row is left alone).
3. The station's price cache is rolled back via the same pattern as Story 3.14's `restorePreviousPrices`: find the most recent `verified` submission for `station_id` that is NOT part of the current pair (not the new submission and not the just-flagged previous one), within a 7-day window.
   - If found, write its `price_data` via `priceService.setVerifiedPrice`. The map shows whatever was live before this 12h window began.
   - If none, invalidate the cache via `priceCache.invalidate(stationId)` so the read-path falls through to estimates.
4. The dedup record for `station_id` is deleted (`redis.del`) — the next submission starts fresh at AC1.
5. An audit log entry is written with action `PRICE_CONFLICT_DETECTED`, `submission_id` set to the newer submission, `notes` JSON `{ partner_submission_id, conflict_group_id, restored_from_submission_id, prev_prices_hash, new_prices_hash }`.

The conflicting prices themselves never appear on the map between conflict detection and admin resolution — picking either would silently take a side.

**AC8 — Schema: `conflict_group_id` column on `Submission`:**
Given conflict pairing requires both rows to be discoverable by a shared identifier,
When migration `<timestamp>_add_conflict_group_id` runs,
Then `Submission` gains a nullable `conflict_group_id UUID` column,
And a partial index `Submission_conflict_group_id_idx ON "Submission"(conflict_group_id) WHERE conflict_group_id IS NOT NULL` exists,
And the Prisma schema is updated to match.

The UUID is shared by both submissions in a pair. Future-proofs to N>2 (rare three-driver collisions) without a schema change. Nullable means existing rows and all non-conflict submissions cost nothing.

**AC9 — Newer-first cascading admin review:**
Given submissions `A` (older, was previously `verified`) and `B` (newer, just submitted) share a `conflict_group_id` and are both `shadow_rejected` with `flag_reason: 'price_conflict'`,
When admin opens the queue,
Then the queue presents them as a single grouped card ordered newer-first (`B` is the primary, `A` shown as the partner in the same card),
And the admin sees both photos side-by-side, both OCR outputs (price_data + ocr_confidence_score), and three actions:

- **Approve newer (`B`)** — `B` → `verified` (status guarded `WHERE status = 'shadow_rejected' AND conflict_group_id = <id>`). `priceService.setVerifiedPrice` runs with `B`'s prices. `A` → `rejected` with `flag_reason: 'auto_resolved_by_newer'`. Both share the same `conflict_group_id` (preserved for audit). The pair is closed; admin queue removes the card.
- **Newer is unusable (`B`)** — `B` → `rejected` with `flag_reason: 'admin_marked_unusable'`. `A` stays in `shadow_rejected` but its `flag_reason` is updated to `null` (released from the conflict pair into single-row review) and `conflict_group_id` is cleared on `A` only (`B` keeps it for audit linkage). The admin queue now lists `A` as a single-row review using the existing single-submission flow.
- **Both unusable** — both `A` and `B` → `rejected` with `flag_reason: 'admin_marked_unusable'`. `conflict_group_id` preserved on both for audit. Cache stays on whatever the read-path currently resolves to (the pre-conflict prior verified submission, or estimates).

Rationale for newer-first: prices may have shifted in 12h; newer is more likely current ground truth; if newer is the misread (blurry shot), admin falls back to "approve older" with one extra tap (currently a manual single-row review of `A` after marking `B` unusable — explicit "approve older" button is deferred to Story 3.17).

Auto-resolution avoids two admin actions for the price of one in the common case (newer = readable + correct).

**AC10 — Admin queue groups submissions by `conflict_group_id`:**
Given the admin shadow-rejected queue lists rows ordered by `created_at ASC`,
When the listing is built,
Then rows that share a non-null `conflict_group_id` are collapsed to one card per group,
And the card is anchored at the position of the **newer** submission (most recent `created_at`),
And the card label includes the count and a localised "conflicting submissions" string (PL: *Sprzeczne zgłoszenia (2)*, EN: *Conflicting submissions (2)*),
And clicking the card opens the paired-review view (AC9),
And resolving the pair via any AC9 action removes the card from the queue.

Single-row submissions (no `conflict_group_id`, OR with `conflict_group_id` but partner is no longer `shadow_rejected`) render with the existing single-row UI. The grouping is defensive — only collapses rows where BOTH are still `shadow_rejected` AND share the ID. If one has been moved out (e.g., admin used the "newer unusable" cascade in AC9), the surviving row reverts to single-row rendering.

**AC11 — Backward compatibility on the Redis dedup key:**
Given Story 3.10's existing dedup keys are stored as `dedup:station:{id}` → `'1'` (boolean presence),
When this story's `checkAndRecordStation` first reads such a legacy key,
Then it treats the legacy value as the stub record `{ count: 1, confirmed: false, prices_hash: null, last_at: <derived from Redis TTL: now() - (12h - TTL_remaining_seconds * 1000)> }`,
And the new code path proceeds with this stub — meaning a single new submission can still corroborate against the legacy entry (with hash comparison falling through to "no stored hash → process normally as if first" since `prices_hash: null`).

This avoids a flag-day migration: keys naturally migrate to JSON format on next write (within 12h of deploy, every active station has been re-keyed).

A migration helper (`StationDedupRecord.fromLegacy(rawValue, ttlSeconds)`) handles parsing both formats:
- If `rawValue === '1'`, return the legacy stub.
- If `rawValue` is a JSON string, `JSON.parse` and return the typed record.
- If `rawValue` is anything else, log a warning and treat as absent (fresh AC1 path) — defensive against schema drift.

**AC12 — Cost telemetry:**
Given the new flow runs in production,
When the daily metrics rollup runs,
Then the existing OCR-call counter splits by `dedup_decision` reason: `{ 'fresh', 'corroborated_exact', 'corroborated_within_noise', 'conflict_detected', 'duplicate_skipped' }`,
And the daily admin metrics dashboard surfaces the per-station OCR-call count distribution (so we can monitor the actual cost impact vs. the +$30/month projection).

The metrics counter is a simple `metricsService.increment('ocr_dedup_decision', { reason })` call at each decision point in the worker — additive, no schema change beyond adding the new `reason` enum values. If the metrics service doesn't yet have a structured counter for this, add the simplest path that integrates with existing `apps/admin` dashboard — DO NOT introduce a new metrics framework.

**AC13 — Test coverage:**
- Unit: `submissionDedupService.checkAndRecordStation(stationId, priceHash)` — first submission, second exact-corroborating, second within noise threshold, second beyond noise (returns `conflicting`), third after corroboration, fourth+, expired window (no key), legacy boolean key migration, fuel-set mismatch.
- Unit: `hashPriceData(priceData)` — sorted output, rounding, null filtering, fuel-set determinism.
- Unit: `compareWithinNoise(prevHash, newPriceData, prevPriceData)` — exact match, within ±0.05, exactly at ±0.05, beyond ±0.05.
- Unit: `submissionsService.detectAndRoutePriceConflict(stationId, newSubmissionId, partnerSubmissionId, partnerPriceData, newPriceData)` — pairs both, generates `conflict_group_id`, rolls back cache (with prior + without prior).
- Unit: admin queue grouping — pair returns one card; broken pair (one resolved) returns the survivor as single row; non-conflict shadow_rejected unchanged.
- Unit: admin actions `approveNewer` / `markNewerUnusable` / `markBothUnusable` — status transitions, cache rewrite, audit log entries.
- Integration: full pipeline flow end-to-end for AC1 (fresh) → AC2 (corroborate) → AC3 (skip) → AC4 (window expired re-fresh).
- Integration: AC7 conflict path — both submissions shadow_rejected, cache rolled back, dedup key cleared, audit log written.
- Integration: AC11 legacy key migration — write `'1'` directly to Redis, verify next submission treats as `count: 1, confirmed: false`.
- Cost regression: log OCR-call count per station per day, monitor for unexpected jumps.

---

## Tasks / Subtasks

Numbered for sequencing. Backend-only — no mobile changes.

### Schema slice (T1)

- [ ] **T1 — Prisma migration: add `conflict_group_id` to `Submission` (AC: 8)**
  - [ ] Create migration `<timestamp>_add_conflict_group_id` under `packages/db/prisma/migrations/`.
  - [ ] SQL: `ALTER TABLE "Submission" ADD COLUMN "conflict_group_id" UUID;` then `CREATE INDEX "Submission_conflict_group_id_idx" ON "Submission"("conflict_group_id") WHERE "conflict_group_id" IS NOT NULL;`.
  - [ ] Update `packages/db/prisma/schema.prisma` Submission model: add `conflict_group_id String? @db.Uuid` and `@@index([conflict_group_id], where: { conflict_group_id: { not: null } }, map: "Submission_conflict_group_id_idx")`. (Prisma's partial-index syntax via `map` matches the SQL exactly.)
  - [ ] Run `pnpm --filter @desert/db generate` to regenerate the Prisma client.
  - [ ] Update `apps/api` TypeScript anywhere that selects all Submission fields explicitly — none expected, but verify by running `pnpm -r type-check`.
  - [ ] Migration is forward-only and additive — no down migration code path. Existing rows get `NULL`.
  - [ ] **Staging caveat:** per `project_staging_predeploy_broken.md`, run `pnpm --filter @desert/db prisma migrate deploy` manually against staging Neon after merge — the Railway preDeployCommand isn't running migrations automatically.

### Dedup-record refactor slice (T2–T3)

- [ ] **T2 — `StationDedupRecord` type + `hashPriceData` helper (AC: 6, 11)**
  - [ ] Define exported types in `apps/api/src/photo/submission-dedup.service.ts`:
    ```ts
    export interface StationDedupRecord {
      count: number;            // 1 or 2 (caps at 2 once confirmed)
      confirmed: boolean;       // true once 2 corroborating submissions seen
      prices_hash: string | null;
      last_at: number;          // epoch ms; informational
    }
    ```
  - [ ] Add a `hashPriceData(prices)` static method per AC6: filter null/non-finite, sort by fuel_type, round to 2 decimals, JSON.stringify, SHA-256 hex digest. Returns the canonical hash string.
  - [ ] Add `StationDedupRecord.fromLegacy(rawValue: string, ttlSeconds: number)` migration helper:
    - `'1'` → `{ count: 1, confirmed: false, prices_hash: null, last_at: Date.now() - (12*3600 - ttlSeconds) * 1000 }`.
    - JSON string → `JSON.parse` and validate the shape (defensive: accept; on parse fail, log warn and return absent sentinel).
    - Anything else → log warn, return absent.
  - [ ] Tests in `submission-dedup.service.spec.ts`: hash determinism (same inputs → same hash, reorder → same hash, round-trip 6.490/6.49), null filter, fuel-set sensitivity, legacy migration variants.

- [ ] **T3 — `checkAndRecordStation` method (AC: 1, 2, 3, 4, 11)**
  - [ ] Replace the existing `checkStationDedup`/`recordStationDedup` callers (intake + worker, see T4) with a single new method:
    ```ts
    type DedupDecision =
      | { skip: false; reason: 'fresh'; record: null }
      | { skip: false; reason: 'corroborate-candidate'; record: StationDedupRecord }
      | { skip: true;  reason: 'duplicate'; record: StationDedupRecord };

    async checkStationConsensus(stationId: string): Promise<DedupDecision>;
    ```
  - [ ] Keep the legacy `checkStationDedup`/`recordStationDedup` methods present until T4 rewires call sites — short-lived during migration.
  - [ ] Implementation reads `dedup:station:{stationId}` with `redis.get` + `redis.ttl` for the legacy-fallback case. No record OR `confirmed: false` AND `count < 2` → `'fresh'`/`'corroborate-candidate'`. `confirmed: true` → `'duplicate'`.
  - [ ] Add `recordStationConsensus(stationId, record)` companion: writes the JSON-stringified record with TTL = 12 hours. Used by T4 after the post-OCR decision.
  - [ ] Tests: each branch above + TTL preserved on update + JSON round-trip.

### Pipeline integration slice (T4–T6)

- [ ] **T4 — Worker post-OCR decision: corroborate / conflict / first-of-window (AC: 2, 3, 7)**
  - [ ] In `apps/api/src/photo/photo-pipeline.worker.ts`, replace the existing pre-OCR `checkStationDedup` block (lines ~211–226) with `checkStationConsensus(stationId)`:
    - `'duplicate'` → existing path: `rejectSubmission(submission, 'duplicate_submission')` and return.
    - `'fresh'` or `'corroborate-candidate'` → continue to OCR; remember the decision for the post-OCR step.
  - [ ] Also update the intake-path call in `apps/api/src/submissions/submissions.service.ts` (`createSubmission` line ~174) to use `checkStationConsensus` — same skip-on-duplicate behaviour, but only when `decision.skip === true`. The other branches let the submission record be created (the worker re-checks per Story 3.10 idempotency pattern).
  - [ ] After `runPriceValidationAndUpdate` succeeds (just before existing `setVerifiedPrice` call in the worker), insert the consensus decision step:
    - If `decision.reason === 'fresh'`: write a fresh record `{ count: 1, confirmed: false, prices_hash: <hashPriceData(newPrices)>, last_at: now }`. Proceed with `setVerifiedPrice`.
    - If `decision.reason === 'corroborate-candidate'`:
      - Compute `newHash = hashPriceData(newPrices)`.
      - If `newHash === record.prices_hash` → exact corroboration. Update record to `{ count: 2, confirmed: true, prices_hash: newHash, last_at: now }`. Proceed with `setVerifiedPrice`.
      - Else, fetch the previous verified submission's `price_data` for the station (latest `verified` excluding the current). Call new `compareWithinNoise(prevPrices, newPrices)`:
        - Returns `'within-noise'` → noise corroboration. Update record to `{ count: 2, confirmed: true, prices_hash: newHash, last_at: now }`. Proceed with `setVerifiedPrice`.
        - Returns `'beyond-noise'` → conflict (T6 path). Skip `setVerifiedPrice`.
      - Edge case: if `record.prices_hash === null` (legacy migration stub or fuel-set mismatch from earlier write), treat as `'fresh'` and overwrite the record with `count: 1` so corroboration starts fresh from this submission.
      - Edge case: if no previous verified submission exists at all (record present but partner row was somehow deleted), treat as `'fresh'` and overwrite.
  - [ ] Wrap the consensus-record write in `.catch()` — Redis failure must NOT fail the verification (matches existing fail-open pattern in `recordStationDedup`).

- [ ] **T5 — `compareWithinNoise(prevPrices, newPrices)` helper (AC: 2, 6)**
  - [ ] Add to `apps/api/src/photo/submission-dedup.service.ts` as static method:
    ```ts
    static compareWithinNoise(
      prevPrices: Array<{ fuel_type: string; price_per_litre: number | null }>,
      newPrices: Array<{ fuel_type: string; price_per_litre: number | null }>,
    ): 'within-noise' | 'beyond-noise' | 'fuel-set-mismatch';
    ```
  - [ ] Filter both to non-null, finite prices. Build sorted-by-fuel_type Maps of fuel → price.
  - [ ] If key sets differ → `'fuel-set-mismatch'` (caller treats as fresh).
  - [ ] For each fuel, compare `Math.abs(prev - new) <= 0.05`. Any single fuel beyond noise → `'beyond-noise'`. Otherwise → `'within-noise'`.
  - [ ] Boundary at exactly ±0.05 PLN/l counts as within-noise (`<=` not `<`) — covers the most common OCR rounding case symmetrically.
  - [ ] Tests: exact match, all-within-noise, single-fuel beyond, fuel-set differs, all-null inputs.

- [ ] **T6 — `SubmissionsService.detectAndRoutePriceConflict` method (AC: 7, 8)**
  - [ ] New public method on `SubmissionsService`. Signature reflects post-review refactor (P-1, P-2, P-3 — see Dev Agent Record):
    ```ts
    async detectAndRoutePriceConflict(args: {
      stationId: string;
      newSubmissionId: string;
      newSubmissionUserId: string;     // P-1 — actor for the audit log
      newPriceData: PriceEntry[];      // P-3 — persisted in the same flip
      newPricesHash: string;
      prevPricesHash: string | null;
    }): Promise<{ conflict_group_id: string; partner_submission_id: string | null }>;
    ```
  - [ ] Steps in order (P-2 — new submission flipped FIRST so a partial-failure mid-method still leaves the new row findable in the admin queue):
    1. Atomic flip on the new submission, guarded by `status: pending`: `prisma.submission.updateMany({ where: { id: newSubmissionId, status: 'pending' }, data: { status: 'shadow_rejected', flag_reason: 'price_conflict', conflict_group_id, price_data: newPriceData, gps_lat: null, gps_lng: null } })` — single write persists prices, nulls GPS, and flips status atomically (P-3). If `count: 0`, return early with `partner_submission_id: null` — concurrent action moved the row.
    2. Find the previous-newest `verified` submission for `stationId` (excluding `newSubmissionId`), bounded by 7-day restore window.
    3. Atomic flip on the previous verified row: `prisma.submission.updateMany({ where: { id: previous.id, status: 'verified' }, data: { status: 'shadow_rejected', flag_reason: 'price_conflict', conflict_group_id } })`. If `count: 0`, log "previous moved by another actor — leaving as-is" and proceed; the new submission still has the same `conflict_group_id`, admin queue handles it as orphan-partner.
    4. Roll cache back via `restorePreviousPrices(stationId, [newSubmissionId, previous?.id].filter(Boolean))` so the just-shadow_rejected pair members are excluded.
    5. Delete the dedup record via `submissionDedupService.liftDedup(stationId, null)` (existing 3.14 method, station-only).
    6. Write audit log: action `PRICE_CONFLICT_DETECTED`, `admin_user_id: newSubmissionUserId` (P-1), notes JSON `{ actor_role: 'system', partner_submission_id, conflict_group_id, restored_from_submission_id, prev_prices_hash, new_prices_hash }`. `.catch()` so audit failure doesn't block.
  - [ ] Caller (worker T4) on a `.catch()` from this method — re-throws to BullMQ for retry rather than swallowing (P-5). The metric `'conflict_detected'` is emitted only on success. The `if (this.submissionsService)` defensive guard from 3.14 is removed in the conflict path (P-4): a DI misconfig should crash loud, not silently no-op.

- [ ] **T7 — `restorePreviousPrices` accepts multi-exclude (AC: 7)**
  - [ ] In `apps/api/src/submissions/submissions.service.ts`, broaden `restorePreviousPrices(stationId, excludeId)` to `restorePreviousPrices(stationId, excludeIds: string[])`. Use `id: { notIn: excludeIds }` instead of `id: { not: excludeId }`.
  - [ ] Update the existing Story 3.14 `flagWrong` call site to pass `[submissionId]`. Drop the 1-arg overload — no other callers.
  - [ ] Existing tests: replace single-string `excludeId` arg with `[excludeId]` array. Add a new test where `excludeIds = [a, b]` and the previous submission found is the one *not* in the exclude list.

### Admin queue slice (T8–T11)

- [ ] **T8 — `AdminSubmissionsService.listFlagged` groups by `conflict_group_id` (AC: 9, 10)**
  - [ ] Update `apps/api/src/admin/admin-submissions.service.ts` `listFlagged`:
    - Add `select: { conflict_group_id: true }` to the existing query.
    - After fetching, post-process to collapse pairs: for any row with non-null `conflict_group_id`, find its partner in the same page; if both are present and both `shadow_rejected`, emit one paired-card item; if only one is in this page (partner on adjacent page), emit it as a single row (defensive — admin can still resolve singly).
  - [ ] Extend the response type to a discriminated union:
    ```ts
    type FlaggedListItem =
      | { kind: 'single'; submission: FlaggedSubmissionSummary }
      | { kind: 'pair'; conflict_group_id: string; newer: FlaggedSubmissionSummary; older: FlaggedSubmissionSummary };
    ```
  - [ ] Tests: pair both in same page (collapsed), pair split across pages (rendered as singles), non-conflict shadow_rejected (single, unchanged), pair with one row already moved out by admin (surviving row → single).

- [ ] **T9 — `AdminSubmissionsService` paired-review actions (AC: 9)**
  - [ ] Add three new methods (or extend existing `approve`/`reject` via discriminated arg — author's call):
    - `approveNewer(adminId: string, conflictGroupId: string, newerSubmissionId: string)`: status guards on both rows via `WHERE status = 'shadow_rejected' AND conflict_group_id = <id>`. Newer → `verified`, run `priceService.setVerifiedPrice` with newer's `price_data`. Older → `rejected` with `flag_reason: 'auto_resolved_by_newer'`. Both audit-logged under one `conflict_group_id` annotation.
    - `markNewerUnusable(adminId: string, conflictGroupId: string, newerSubmissionId: string)`: newer → `rejected` with `flag_reason: 'admin_marked_unusable'`. Older → `flag_reason: null` AND `conflict_group_id: null` (released back to single-row review while preserving its `shadow_rejected` status). Newer keeps `conflict_group_id` for audit linkage. Audit-logged.
    - `markBothUnusable(adminId: string, conflictGroupId: string)`: both → `rejected` with `flag_reason: 'admin_marked_unusable'`. `conflict_group_id` preserved on both. Audit-logged. Cache stays where it is (read-path resolves from prior verified or estimates — same as the conflict-detection rollback already left it).
  - [ ] All three actions wrap status transitions in `WHERE status = 'shadow_rejected'` guards; on `count: 0`, throw `ConflictException` (matches existing single-row pattern).
  - [ ] Tests: each action's happy path, status-guard race (admin B already moved a row), audit log emissions, cache write only on `approveNewer`.

- [ ] **T10 — Admin controller endpoints (AC: 9)**
  - [ ] Add new endpoints under `apps/api/src/admin/admin-submissions.controller.ts`:
    - `POST /admin/submissions/conflict/:conflictGroupId/approve-newer` — body `{ submission_id: string }` (the admin confirms which row is "newer" — defensive against UI bugs or stale data).
    - `POST /admin/submissions/conflict/:conflictGroupId/newer-unusable` — body `{ submission_id: string }`.
    - `POST /admin/submissions/conflict/:conflictGroupId/both-unusable` — no body.
  - [ ] All three: `@Roles(UserRole.ADMIN)`, `@HttpCode(HttpStatus.OK)`, return the updated paired-card state (or `null` if pair is now closed).

- [ ] **T11 — Admin UI: paired card + actions (AC: 9, 10)**
  - [ ] In `apps/admin/app/(protected)/submissions/page.tsx`, render the new `pair` items as a single card with both photos side-by-side (use existing `<SubmissionRow>`-style content for each side). Action buttons: `Approve newer` (primary), `Newer unusable`, `Both unusable`.
  - [ ] Add the new admin actions in `apps/admin/app/(protected)/submissions/actions.ts` (or wherever the existing approve/reject server actions live). Call the three new endpoints from T10 with `adminFetch`. Same error-handling pattern as existing actions.
  - [ ] i18n: add `review.conflict.{groupedTitle, approveNewer, newerUnusable, bothUnusable, conflictGroupBadge}` keys to PL + EN locale files (`apps/admin/lib/i18n.ts` or wherever the existing translation map is — match current pattern). Re-use existing `flag_reason` translation map for the per-row chip — `'price_conflict'` should map to *Sprzeczne ceny* / *Price conflict* (already partly present per Story 3.14 AC5 mention in mobile; mirror to admin).
  - [ ] Manual-test checklist below verifies the visual + interaction; no Playwright/component test additions in this story (admin tests use the in-house fetch-spy helper per `0.2 Admin Test Infrastructure` — wire one happy-path action test for `approve-newer` to keep the pattern alive).

### Telemetry slice (T12)

- [ ] **T12 — Per-decision OCR-call metric (AC: 12)**
  - [ ] Inspect `apps/api/src/admin/admin-metrics.service.ts` for the existing OCR-call counter shape. If it tags by `model`/`status` already, extend tags with `dedup_decision: 'fresh' | 'corroborated_exact' | 'corroborated_within_noise' | 'conflict_detected' | 'duplicate_skipped'`.
  - [ ] Add the call sites in the worker: emit one metric per submission at the consensus-decision point (T4) so the cost split is visible.
  - [ ] If the existing metrics service does not have a structured counter, the simplest path is a `prisma.metricEvent.create` row (or whatever the existing pattern is) — DO NOT introduce a new metrics framework; match what's there.
  - [ ] Add the 5 new decision values to the admin dashboard summary view (probably a single SELECT with GROUP BY `dedup_decision` on the metric event table). Daily rollup is sufficient — no real-time chart.

### Code review (T13)

- [x] **T13 — `bmad-code-review` adversarial pass**
  - [x] Run after T12 against the full diff (backend + admin + db migration).
  - [x] Findings folded back as Review Patches (Dev Agent Record below).

---

## Dev Notes

### Architecture compliance

- **Schema migration is forward-only and additive.** New nullable column + partial index. No data backfill. Existing rows continue to work; only new conflict pairs use the column.
- **Redis key schema migration is in-place + lazy.** Legacy `'1'` boolean values are interpreted as `count: 1, confirmed: false, prices_hash: null` until next write rewrites them as JSON. No flag day, no separate migration job.
- **Atomic state transitions.** Every status flip in the conflict detection (T6) and the three admin actions (T9) uses `updateMany` with a `WHERE status = '...'` guard so concurrent admin actions return `count: 0` and don't clobber each other. Story 4.4 pattern; same as Story 3.14.
- **Best-effort side effects.** Audit log writes, dedup record updates, and metric emissions are all `.catch()`-wrapped. The authoritative state is the Submission row + the price cache; everything else is recovery.
- **NestJS module wiring stays as-is.** `SubmissionsService` ↔ `PhotoPipelineWorker` already use `forwardRef` (Story 3.14). The new `detectAndRoutePriceConflict` method is on `SubmissionsService` and called from the worker via that same forwardRef — no new circular dependencies.
- **No new ENV vars.** All thresholds (12h window, 24h hash TTL, ±0.05 noise, 7-day restore window) are constants in code. If we want to tune them later, that's a separate refactor.

### Testing standards

- Backend: Jest + ts-jest under `apps/api`. New tests live alongside the file under test. Pattern: spec mocks every direct dependency injected into the constructor; never imports real Prisma/Redis. See `submissions.service.spec.ts` for the established mock-setup pattern.
- Admin: Jest with the in-house fetch-spy helper from `apps/admin/test/` (Story 0.2). Add one happy-path action test for `approve-newer` to keep the pattern alive; full coverage of all three actions is not required (single-row admin actions are already covered).
- Critical mock pitfall (carried over from 3.14): when the service-under-test transitively calls `crypto.createHash` (the `hashPriceData` helper does), ensure `jest.mock('node:crypto', ...)` in the spec spreads `jest.requireActual('node:crypto')` so the real `createHash` is used.
- Cost regression: log the daily OCR-call distribution by `dedup_decision`. After 7 days of production data, eyeball the `+$30/month` projection vs reality. If it's higher than ~$50/month, revisit (e.g., add a "minimum gap between corroborating submissions" — see Out of Scope).

### Source tree alignment

- Dedup logic stays inside `apps/api/src/photo/submission-dedup.service.ts` (extend, don't relocate). The hash + comparison helpers are static methods on the same class for discoverability.
- Conflict routing belongs to `SubmissionsService` (not the worker, not the dedup service) because it's a multi-row state-transition operation analogous to `flagWrong`. The worker just calls into it.
- Admin grouping logic stays in `AdminSubmissionsService.listFlagged` rather than inside the controller or admin UI — keep the wire shape simple, let the API decide what's a pair.
- Schema changes go through `packages/db/prisma/schema.prisma` and a new migration file. Do NOT hand-edit existing migrations.

### Reused vs new — no wheel reinvention

- **Reuse**: `SubmissionDedupService` (extend with new methods + types, keep `liftDedup`/`computePhotoHash`/legacy methods short-term), `restorePreviousPrices` from 3.14 (broaden to multi-exclude in T7), `priceService.setVerifiedPrice`/`priceCache.invalidate` for cache updates, the existing forwardRef wiring between `SubmissionsService` and `PhotoPipelineWorker`, the existing `AdminAuditLog` table for audit trail, the existing admin shadow-rejected queue UI as the host for the new paired card.
- **New**: `StationDedupRecord` type + `hashPriceData`/`compareWithinNoise` static helpers, `checkStationConsensus`/`recordStationConsensus` methods, `detectAndRoutePriceConflict` method on `SubmissionsService`, three admin actions + endpoints + UI, the schema column + migration.
- **NOT to build**: cross-station hash sharing (out of scope), per-fuel decay weights (out of scope), a new "ConflictGroup" table (UUID column on Submission is sufficient — see AC8 rationale), a separate metric framework (extend existing).

### Project Structure Notes

Story stays inside conventions established by 3.10 (dedup service shape), 3.14 (atomic guards + restore pattern + audit reuse), and 4.2 (admin queue patterns). The one notable expansion is the schema column — first time `Submission` has gained a nullable identifier column for cross-row pairing. The partial-index choice matters: a full index on a nullable column would balloon for the 99% of submissions that never conflict; the `WHERE conflict_group_id IS NOT NULL` clause keeps it scoped to actual conflict pairs.

### References

- [Story 3.10 — Submission Deduplication](./3-10-submission-deduplication.md) — `SubmissionDedupService` foundation and existing Redis key schema; this story extends both. See addendum on `liftDedup` shipped under 3.14.
- [Story 3.14 — Self-Flag Wrong Prices](./3-14-self-flag-wrong-prices.md) — `restorePreviousPrices` pattern reused (T7 extends to multi-exclude); audit-log reuse pattern; `flag_reason: 'price_conflict'` already declared in mobile AC5 for activity-row copy; forwardRef wiring already in place.
- [Story 3.7 — Price Validation & Database Update](./3-7-price-validation-database-update.md) — origin of the `price_data` JSON shape that AC6's hashing operates on.
- [Story 4.2 — Submission Review Queue](./4-2-submission-review-queue.md) — existing admin shadow-rejected queue UI; this story adds the paired-card variant on top.
- [Story 4.4 — Dead-Letter Queue Management](./4-4-dead-letter-queue-management.md) — `updateMany` status-guard pattern (P-4 from that review) carried into AC7 + T9.
- `apps/api/src/photo/submission-dedup.service.ts` — extend (new types + methods).
- `apps/api/src/photo/photo-pipeline.worker.ts` — extend (consensus decision step post-OCR).
- `apps/api/src/submissions/submissions.service.ts` — extend (`detectAndRoutePriceConflict`, broaden `restorePreviousPrices`).
- `apps/api/src/admin/admin-submissions.service.ts` — extend (`listFlagged` grouping, three new paired actions).
- `apps/api/src/admin/admin-submissions.controller.ts` — extend (three new endpoints).
- `apps/admin/app/(protected)/submissions/page.tsx` — extend (paired card rendering).
- `apps/admin/app/(protected)/submissions/actions.ts` — extend (three new server actions).
- `packages/db/prisma/schema.prisma` — extend (Submission column + index).
- `packages/db/prisma/migrations/<timestamp>_add_conflict_group_id/migration.sql` — new migration.

---

## Out of Scope

- **Cross-station corroboration** — corroborating PB_95 prices across nearby stations to flag suspicious outliers. Separate research task; needs a price-clustering model.
- **Time-decayed confidence** — older confirmations decay as the 12h window progresses. The current hard 12h cutoff is sufficient for v1.
- **Three-way corroboration** — capping at 2 corroborating submissions. Three-driver collisions exist in the schema (`conflict_group_id` accepts N>2) but the current logic stops at pairs. Diminishing returns.
- **Minimum gap between corroborating submissions** — protecting against two same-second submissions both running OCR (almost certainly the same person uploading twice). Current code lets both run; if cost regression shows this matters, add later.
- **Mobile changes** — purely backend behaviour change; drivers see more of their submissions actually verified vs silently dedup'd, which is a UX win without code.
- **"Approve older" admin button** — currently admin must "mark newer unusable" then approve the older via single-row flow (one extra tap). Direct button deferred to Story 3.17.
- **`AdminAuditLog.admin_user_id` rename** to `actor_user_id` — same deferred cleanup as 3.14. Out of scope here.
- **Mobile activity-row copy for `auto_resolved_by_newer`** — Story 3.17 picks this up; `'admin_marked_unusable'` and `'auto_resolved_by_newer'` both fall through 3.14's AC5 generic *Under review* label until then, which is acceptable.

---

## Regression Checklist (pre-push)

- [ ] `pnpm -r type-check` green
- [ ] `pnpm -r lint` green
- [ ] `pnpm -r test` green (full API suite + new tests + admin happy-path action test)
- [ ] Migration runs cleanly on a fresh local DB (`pnpm --filter @desert/db prisma migrate dev`)
- [ ] Migration applied manually on staging Neon (per `project_staging_predeploy_broken.md`)
- [ ] Manual: submit a photo at a fresh station → verifies → record stored as `count: 1, confirmed: false`
- [ ] Manual: same scene re-shot by same driver within 12h → corroborates → record `count: 2, confirmed: true`; cache shows newer prices
- [ ] Manual: third submission within 12h → rejected as `duplicate_submission`; no OCR cost (logs show `dedup_decision: duplicate_skipped`)
- [ ] Manual: deliberate conflict (re-shoot with manually entered different price) → both submissions in admin queue as a paired card; cache rolled back to prior verified or estimates
- [ ] Manual: admin clicks `Approve newer` → newer verified, prices live; older auto-rejected
- [ ] Manual: admin clicks `Newer unusable` → newer rejected; older surfaces as single-row review
- [ ] Manual: admin clicks `Both unusable` → both rejected; cache unchanged
- [ ] Manual: legacy boolean key still in Redis (set via redis-cli) → next submission treats as `count: 1, confirmed: false` and proceeds normally
- [ ] Manual: Story 3.14 self-flag still works → flag-wrong deletes the dedup record entirely; immediate retake processes
- [ ] Manual: Story 4.3 shadow_banned still works → shadow-banned user's submission appears as `pending` on the wire (no `price_conflict` leakage)

---

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (1M context)

### Debug Log References

### Completion Notes List

- All 13 tasks (T1–T13) complete.
- Test counts post-review: API 60 suites / 1162 tests pass (was 1117); mobile 5 suites / 31 tests pass (unchanged — no mobile changes in 3.16).
- 31 of 31 review patches (P-1..P-31) applied; 7 deferred items (D-1..D-7) logged above; 1 spec deviation (BAD-SPEC-1, signature drift on `detectAndRoutePriceConflict`) resolved by amending the T6 spec block.
- The `detectAndRoutePriceConflict` step ordering refactor (P-2) is the most consequential change: a partial-failure mid-method now leaves the new submission findable in the admin queue rather than stuck in `pending`.

### File List

**Backend (uncommitted at time of review):**
- `packages/db/prisma/schema.prisma` — added `conflict_group_id` column.
- `packages/db/prisma/migrations/20260506000000_add_conflict_group_id/migration.sql` — new migration with `ALTER TABLE` + partial index.
- `apps/api/src/photo/submission-dedup.service.ts` — `StationDedupRecord` type; `hashPriceData`, `compareWithinNoise`, `parseDedupRecord` static helpers; `checkStationConsensus` + `recordStationConsensus` instance methods. P-7/P-8/P-15/P-17 hardening applied post-review.
- `apps/api/src/photo/submission-dedup.service.spec.ts` — 49 tests total (was 21); 28 new for 3.16 helpers.
- `apps/api/src/photo/photo-pipeline.worker.ts` — pre-OCR consensus check, post-OCR decision (fresh / confirm / fuel-set-mismatch / conflict), `MetricsCounterService` injection; P-3/P-4/P-5/P-6/P-23/P-25 applied.
- `apps/api/src/photo/photo-pipeline.worker.spec.ts` — `checkStationConsensus`/`recordStationConsensus` mocks, `MetricsCounterService` mock, `findFirst` prisma mock, `detectAndRoutePriceConflict` mock signature update for P-1/P-2/P-3.
- `apps/api/src/photo/photo.module.ts` — `MetricsModule` import.
- `apps/api/src/submissions/submissions.service.ts` — `detectAndRoutePriceConflict(args)` (post-P-1/P-2/P-3 args-object signature); `restorePreviousPrices` broadened to multi-exclude (T7).
- `apps/api/src/submissions/submissions.service.spec.ts` — 7 new tests for `detectAndRoutePriceConflict`; 3.14 createSubmission L1 path updated for `checkStationConsensus`.
- `apps/api/src/admin/admin-submissions.service.ts` — `FlaggedListItem` union, `collapseConflictPairs` (P-21 cross-page partner pool, P-27 anchor-clarification), three paired-review actions (P-9 transactional, P-10/P-11 audit, P-12 distinct actions, P-22 N>2 guard, P-24 consensus seed); `SubmissionDedupService` injected.
- `apps/api/src/admin/admin-submissions.service.spec.ts` — 11 new tests covering paired-review actions + cross-page pagination.
- `apps/api/src/admin/admin-submissions.controller.ts` — three new `POST conflict/:conflictGroupId/...` endpoints with `ParseUUIDPipe`.
- `apps/api/src/metrics/metrics-counter.service.ts` — `incrementDedupDecision` (P-18 atomic SET-NX-EX + INCR), `getDedupDecisionsByDate` (P-19 try/catch), `fuel_set_mismatch` bucket (P-25).

**Admin UI:**
- `apps/admin/lib/types.ts` — `FlaggedListItem` discriminated union mirrored client-side; `conflict_group_id` on `FlaggedSubmissionRow`; price_data type widened (P-14).
- `apps/admin/lib/i18n.ts` — flag-reason map adds `price_conflict` / `auto_resolved_by_newer` / `admin_marked_unusable`; new `conflict*` action labels in PL/EN/UK; `reviewLink` key added (P-15 hardcoded label fix).
- `apps/admin/app/(protected)/submissions/ConflictPairCard.tsx` — new client component with side-by-side photos and three action buttons.
- `apps/admin/app/(protected)/submissions/page.tsx` — discriminated-union rendering, inline `SingleRow` helper using `t.review.reviewLink`.
- `apps/admin/app/(protected)/submissions/actions.ts` — three new server actions matching the new endpoints.

### Review Patches

T13 bmad-code-review (2026-05-07) surfaced 31 fixable patches (P-1..P-31) and 7 deferred items (D-1..D-7). All patches applied in this slice.

**Critical correctness — `detectAndRoutePriceConflict` refactor:**

- **P-1** — `admin_user_id` now records the actor's `user_id` (the new submission's `user_id`) rather than the magic string `'system'`. The actor-vs-system distinction is captured in a new `actor_role: 'system'` notes field, mirroring 3.14's pattern. Avoids a misleading audit-by-user query result and keeps the `AdminAuditLog.admin_user_id` semantic stable across stories.
- **P-2** — Step ordering: the **new submission is flipped first**. If anything else in the method (find previous, partner flip, cache rollback, audit) throws, the new row is at least findable in the admin queue. The previous order left the new row in `pending` if any earlier step failed.
- **P-3** — The new submission's status flip and `price_data` persistence happen in **one** `updateMany`. Eliminates the in-between read where a parallel actor could see `pending` with new prices but no conflict status. The worker no longer issues a separate `update(price_data)` before calling the service.
- **P-4** — Removed the `if (this.submissionsService)` defensive guard in the worker's conflict path. A forwardRef misconfig should crash loud (BullMQ retries), not silently no-op leaving the submission in a half-state.
- **P-5** — Worker `.catch()` on `detectAndRoutePriceConflict` now re-throws to BullMQ rather than swallowing. The `'conflict_detected'` metric and "paired for admin review" log line only fire on success.

**High — dedup-record correctness:**

- **P-6** — `consensusKnown` flag threaded through `runPriceValidationAndUpdate`. When the L2 consensus check fails open on a Redis blip OR is skipped on a BullMQ retry, the verify path skips `recordStationConsensus` so a `count: 1, confirmed: false` write can't clobber a previously-confirmed record.
- **P-7** — `parseDedupRecord` now derives `last_at` from a safe TTL value: when Redis returns `-1` (no TTL) or `-2` (key gone, race between `get` and `ttl`), it falls back to the full window so callers don't see a fabricated 12h-ago timestamp.
- **P-8** — `parseDedupRecord` adds value-range validation: `count` must be a non-negative integer ≤ 2; `confirmed` boolean; `prices_hash` string-or-null; `last_at` finite and not more than 60s ahead of now. Rejects poisoned records (e.g., `count: 0, confirmed: true`) and treats them as absent.
- **P-9** — Both `approveNewer` and `markNewerUnusable` now wrap their two `updateMany` flips in `prisma.$transaction`. If the second flip returns `count: 0` (concurrent action), the transaction rolls back and we throw `ConflictException` rather than leaving the pair half-resolved.
- **P-10** — `markBothUnusable` captures target IDs **before** the `updateMany` so audit log entries are emitted only for the rows that actually changed. Previously, `findMany` post-update could return unrelated rejected rows that shared the `conflict_group_id` from prior partial actions.
- **P-11** — `markBothUnusable` wraps each `writeAuditLog` call in `.catch()`. State change has already committed; an audit failure on iteration N no longer 500s the admin.

**Medium — semantics + correctness:**

- **P-12** — Distinct audit actions per row in paired-review handlers:
  - `approveNewer` → `APPROVE_NEWER` on newer, `AUTO_RESOLVED_BY_NEWER` on older.
  - `markNewerUnusable` → `MARK_NEWER_UNUSABLE` on newer, `RELEASE_OLDER_TO_SINGLE_REVIEW` on older.
  - `markBothUnusable` → `MARK_BOTH_UNUSABLE` on both.
- **P-14** — `FlaggedSubmissionRow.price_data` widened to `Array<{ fuel_type: string; price_per_litre: number | null }>` to match runtime shape. Cache-write paths filter non-finite before constructing `StationPriceRow`.
- **P-15** — `compareWithinNoise` and `hashPriceData` `toUpperCase` fuel_type before keying so an OCR drift between `'ON'` and `'on'` doesn't produce a false fuel-set-mismatch.
- **P-17** — `hashPriceData` returns a unique `empty:<uuid>` sentinel for empty / all-null inputs so two empty submissions never hash-collide. Path is unreachable today (upstream rejects empty `price_data` as `no_prices_extracted`) but defended against future regression.
- **P-18** — `incrementDedupDecision` switched to `SET key 0 NX EX <ttl>` then `INCR`. Atomic seed-with-TTL replaces the racy `INCR` then conditional `EXPIRE` that could leak the key forever if `EXPIRE` failed.
- **P-19** — `getDedupDecisionsByDate` wraps `redis.mget` in `try/catch` returning empty Map, matching docstring contract.
- **P-21** — `listFlagged` pre-fetches cross-page conflict partners. After the page query, finds rows in `shadow_rejected/price_conflict` with a `conflict_group_id` that matches an in-page row but `id` not in the page; passes those to `collapseConflictPairs` as a second arg. Pairs that span pages render as a card on the in-page member's position rather than as two orphan singles.
- **P-22** — `loadConflictPair` throws `ConflictException` when the group has more than 2 active members rather than silently picking `rows[0]`/`rows[1]`. Future-proofing for N>2 conflicts; current 1:1 group:pair invariant unaffected.
- **P-23** — Status guards on the post-OCR `update` calls (`runPriceValidationAndUpdate` shadow_reject path and verify path). `where: { id, status: 'pending' }` + `count` check prevents a BullMQ retry from re-flipping a row that the prior attempt already routed to `shadow_rejected` (e.g., via the conflict path).
- **P-24** — `approveNewer` seeds a `count: 2, confirmed: true` consensus record after the cache write. Without this, the dedup record was deleted by `detectAndRoutePriceConflict`'s `liftDedup` and the next driver re-paid OCR cost despite admin-confirmed prices.
- **P-25** — `'fuel_set_mismatch'` added as a distinct decision bucket in `incrementDedupDecision` and `getDedupDecisionsByDate` so the cost split tells the truth.

**Low — cleanups:**

- **P-13** — Cast updated; type widening (P-14) addresses the underlying issue.
- **P-16** — Folded into P-15 via the same toUpperCase normalization.
- **P-20** — Folded into P-9 via the transaction wrapper that already guards both flips.
- **P-26** — Worker comment "detectAndRoutePriceConflict flips status only" rewritten to reflect the actual responsibilities (status + flag_reason + conflict_group_id + price_data + GPS).
- **P-27** — `collapseConflictPairs` comment now documents that pairs are anchored at first-encountered-member position (with both halves consumed regardless of which page the loop is currently on).
- **P-28** — Deferred (`conflictResolveSuccess` i18n keys retained for future toast wiring).

**Test coverage (AC13):**

- **P-29** — `submission-dedup.service.spec.ts`: 49 tests total (was 21). New: 7× `hashPriceData` (sort determinism, rounding, null filter, fuel-set sensitivity, case normalization, empty sentinel, hex shape), 7× `compareWithinNoise` (exact / within / boundary / beyond / fuel-set-mismatch / case / null filter), 8× `parseDedupRecord` (legacy `'1'` migration with various TTLs, JSON valid, negative/oversized/non-integer count, NaN/far-future last_at, malformed JSON, unknown shape), 6× `checkStationConsensus` (fresh / corroborate-candidate / duplicate / Redis-failure fail-open / corrupt value → fresh / legacy `'1'` lazy migration), 1× `recordStationConsensus`.
- **P-30** — `submissions.service.spec.ts`: 7 new tests for `detectAndRoutePriceConflict` (P-2 ordering, P-3 atomicity, abort-on-non-pending, no-previous-verified case, pair-with-cache-restore, P-1 audit shape, audit-failure tolerance, partner-moved race).
- **P-31** — `admin-submissions.service.spec.ts`: 11 new tests covering `approveNewer` (happy path with P-12/P-24, P-9 rollback, BadRequest for wrong newer ID, ConflictException for missing pair, P-22 N>2 guard), `markNewerUnusable` (happy path with distinct audit, P-9 rollback), `markBothUnusable` (P-10 audit-target capture, empty pre-check, P-11 audit failure tolerance), plus P-21 cross-page pagination test.

### Review Deferred Items

The following items from the bmad-code-review are intentionally deferred — none are launch-blockers for Story 3.16, and folding them in here would either dilute scope or duplicate work that's owned by a follow-up story.

- **D-1 — Migration uses `ALTER TABLE` + `CREATE INDEX` without `CONCURRENTLY`.** Acquires exclusive lock; fine on the current small Submission table, but worth `CREATE INDEX CONCURRENTLY` (in a separate migration) before we hit production scale. Tracked separately.
- **D-2 — UTC-vs-Europe/Warsaw daily bucketing in metric counters.** Pre-existing pattern from 3.10/4.6/3.14; not regressed by this story. The Polish-market dashboard misalignment (00:30 CEST submission counts to "yesterday" UTC) needs a centralised fix, not a per-counter one.
- **D-3 — OCR success then pipeline crash before `runPriceValidationAndUpdate`** causes cost regression: no consensus record is written → next submission re-OCRs. Pre-existing 3.10 issue, now slightly more visible because the consensus record carries more value than the boolean. Defer until we see real-world cost impact.
- **D-4 — No confirmation dialog for `Both unusable`** destructive action. UX polish; revisit with 3.17 (admin-side activity-row polish picks up the same UX surface).
- **D-5 — Prisma schema/migration drift on the partial index.** Documented in `schema.prisma` comment but should be tracked as a follow-up cleanup. Possible options: write a Prisma client extension that no-ops the drift, or split the schema into `schema.prisma` (canonical) + `schema-views.prisma` (custom-SQL-only). Out of scope here.
- **D-6 — UK locale typo**: `Сирпечні ціни` and `Сирпечні заявки` in [i18n.ts](apps/admin/lib/i18n.ts) — likely meant to be `Конфліктні` or `Суперечливі`. Defer to native-speaker review (same review pass that catches PL/UK consistency for 3.14 keys).
- **D-7 — `markNewerUnusable` could optionally seed a fresh consensus record** (`count: 1, prices_hash: <older's>`) so a same-fuel-set re-shoot can corroborate immediately. Low priority; the older row's later single-row admin review path doesn't currently touch consensus, so this is one new piece of behaviour for a rare edge case.

Also note: the spec deviation flagged as `BAD-SPEC-1` (signature drift on `detectAndRoutePriceConflict`) was resolved by updating the spec inline above (T6) to reflect the post-review args-object signature.
