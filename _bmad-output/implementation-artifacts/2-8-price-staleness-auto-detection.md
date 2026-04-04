# Story 2.8: Price Staleness Auto-Detection

Status: done

## Story

As a **developer**,
I want the system to automatically flag stations whose prices are likely outdated based on market
signals,
So that drivers are warned proactively before they arrive at a station with wrong prices.

## Why

Time-based staleness alone is insufficient — a stable price from 3 weeks ago may be perfectly
accurate, while a price from yesterday may be wrong if there was a market-wide movement. Combining
macro signals (ORLEN rack price movements from Story 2.7) with submission activity gives a smarter
freshness signal. The `significant_movement` flag written by Story 2.7 is the primary trigger.

## Scope

- **In:** `StationFuelStaleness` table + Prisma model, `StalenessDetectionService`
  (`detectStaleness` + `clearStaleFlag` + `getStaleFuelTypes`),
  `StalenessDetectionWorker` (BullMQ cron — 06:15 + 14:15 Europe/Warsaw),
  `MarketSignalModule` wiring updates.
- **Out:** Push notifications (AC5 — never send), Brent crude signal (Phase 2 / Story 6.0),
  regional cluster propagation (AC3 — deferred, complex spatial query),
  UI staleness indicators (already in Story 2.6), submission creation flow (Epic 3).
- **Prerequisite:** Story 2.7 deployed (`market_signal` table populated with
  `significant_movement` flags).

## Acceptance Criteria

1. **Given** a `MarketSignal` record with `significant_movement: true` exists in the last 24h
   **When** the staleness detection job runs
   **Then** all stations with no verified `Submission` for that fuel type in the last 24h are
   upserted into `station_fuel_staleness` with `reason: 'orlen_movement'` (idempotent —
   existing flags are left untouched via `skipDuplicates`).

2. **Given** a `(station × fuel_type)` combination is flagged stale
   **When** `StalenessDetectionService.clearStaleFlag(stationId, fuelType)` is called
   (e.g. by a future verified submission handler)
   **Then** the stale flag for that `(station × fuel_type)` is deleted. Other fuel types at
   the same station are unaffected. Silent no-op if record does not exist.

3. **Given** the staleness detection job
   **When** it runs
   **Then** it never sends push notifications — flagging is a silent data operation.

4. **Given** no `MarketSignal` with `significant_movement: true` in the last 24h
   **When** the staleness detection job runs
   **Then** it exits cleanly with no stale flags written and no errors.

5. **Given** `tsc --noEmit`
   **When** run from `apps/api`
   **Then** zero type errors.

### Error scenarios (added per epic note)

6. **Given** the staleness detection job throws an uncaught exception
   **When** the BullMQ worker catches the failure
   **Then** the error is logged via `Logger.error`, the job is retried once after 5 minutes,
   and if still failing after retry, an ops-alert log entry is emitted.

7. **Given** a database error occurs reading `market_signal` records
   **When** the job runs
   **Then** the DB error propagates out of `detectStaleness`, the job fails cleanly, and
   no stale flag writes are attempted.

8. **Given** a database error occurs writing stale flag records
   **When** the `createMany` transaction throws
   **Then** the error propagates (no partial commit), the job fails and is retried per AC6.

## Tasks / Subtasks

### Phase 1 — DB: `station_fuel_staleness` table

- [x] **1.1** Add `StationFuelStaleness` model to `packages/db/prisma/schema.prisma`:
  ```prisma
  model StationFuelStaleness {
    id         String   @id @default(uuid())
    station_id String
    fuel_type  String   // 'PB_95' | 'PB_98' | 'ON' | 'ON_PREMIUM' | 'LPG'
    reason     String   // 'orlen_movement'
    flagged_at DateTime @default(now())
    created_at DateTime @default(now())
    updated_at DateTime @updatedAt
    station    Station  @relation(fields: [station_id], references: [id])

    @@unique([station_id, fuel_type])
    @@index([station_id])
  }
  ```
  And add `staleness StationFuelStaleness[]` to the `Station` model.

- [x] **1.2** Create migration manually (no live DB).
  Create `packages/db/prisma/migrations/20260326130000_add_station_fuel_staleness/migration.sql`:
  ```sql
  CREATE TABLE "StationFuelStaleness" (
    "id"         TEXT NOT NULL,
    "station_id" TEXT NOT NULL,
    "fuel_type"  TEXT NOT NULL,
    "reason"     TEXT NOT NULL,
    "flagged_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StationFuelStaleness_pkey" PRIMARY KEY ("id")
  );

  ALTER TABLE "StationFuelStaleness"
    ADD CONSTRAINT "StationFuelStaleness_station_id_fkey"
    FOREIGN KEY ("station_id") REFERENCES "Station"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

  CREATE UNIQUE INDEX "StationFuelStaleness_station_id_fuel_type_key"
    ON "StationFuelStaleness"("station_id", "fuel_type");

  CREATE INDEX "StationFuelStaleness_station_id_idx"
    ON "StationFuelStaleness"("station_id");
  ```
  Then run `pnpm --filter @desert/db exec prisma generate` to regenerate the client.

### Phase 2 — `StalenessDetectionService`

- [x] **2.1** Create `apps/api/src/market-signal/staleness-detection.service.ts`:
  - Constructor injects `PrismaService`.
  - Export constant:
    ```ts
    export const SIGNAL_TO_FUEL_TYPE: Readonly<Record<string, string>> = {
      orlen_rack_pb95: 'PB_95',
      orlen_rack_on: 'ON',
      orlen_rack_lpg: 'LPG',
    };
    ```
  - `async detectStaleness(): Promise<void>`:
    1. Compute `cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)`.
    2. Query `marketSignal.findMany({ where: { significant_movement: true, recorded_at: { gte: cutoff } } })`.
    3. Collect unique fuel types: `[...new Set(signals.map(s => SIGNAL_TO_FUEL_TYPE[s.signal_type]).filter(Boolean))]`.
    4. If no fuel types, log and return.
    5. For each `fuelType`: use `$queryRaw` to find all station IDs with no recent verified
       submission for that fuel type:
       ```ts
       const rows = await this.prisma.$queryRaw<{ id: string }[]>`
         SELECT s.id FROM "Station" s
         WHERE NOT EXISTS (
           SELECT 1 FROM "Submission" sub
           WHERE sub.station_id = s.id
             AND sub.status = 'verified'
             AND sub.created_at > ${cutoff}
             AND sub.price_data::jsonb @> ${JSON.stringify([{ fuel_type: fuelType }])}::jsonb
         )
       `;
       ```
    6. Batch upsert via `createMany` with `skipDuplicates: true`:
       ```ts
       await this.prisma.stationFuelStaleness.createMany({
         data: rows.map(r => ({
           station_id: r.id,
           fuel_type: fuelType,
           reason: 'orlen_movement',
         })),
         skipDuplicates: true,
       });
       ```
    7. Log: `Flagged ${count} (station × fuel_type) combinations as stale for ${fuelType}`.
  - `async clearStaleFlag(stationId: string, fuelType: string): Promise<void>`:
    ```ts
    await this.prisma.stationFuelStaleness.deleteMany({
      where: { station_id: stationId, fuel_type: fuelType },
    });
    ```
  - `async getStaleFuelTypes(stationId: string): Promise<string[]>`:
    ```ts
    const records = await this.prisma.stationFuelStaleness.findMany({
      where: { station_id: stationId },
      select: { fuel_type: true },
    });
    return records.map(r => r.fuel_type);
    ```

### Phase 3 — `StalenessDetectionWorker`

- [x] **3.1** Create `apps/api/src/market-signal/staleness-detection.worker.ts`
  (mirrors `OrlenIngestionWorker` pattern exactly):
  - Dedicated ioredis connection (`maxRetriesPerRequest: null`).
  - Queue: `'staleness-detection'`; job: `'run-detection'`.
  - Two repeat schedules (idempotent jobIds):
    - Morning: `{ pattern: '15 6 * * *', tz: 'Europe/Warsaw' }`, jobId: `'staleness-morning'`
    - Afternoon: `{ pattern: '15 14 * * *', tz: 'Europe/Warsaw' }`, jobId: `'staleness-afternoon'`
  - `JOB_OPTIONS`: `{ attempts: 2, backoff: { type: 'custom' } }`.
  - `backoffStrategy`: always returns `5 * 60 * 1000` ms (5-minute retry — short enough to
    complete before the next ORLEN run).
  - Worker processor: calls `this.detectionService.detectStaleness()`.
  - `failed` handler: logs `Logger.warn` for retryable failures, `Logger.error` with
    "Staleness detection FAILED — ops alert required" when `!willRetry`.
  - `completed` handler: `Logger.log('Staleness detection completed successfully')`.
  - `onModuleDestroy`: `await worker?.close()`, `await queue?.close()`, `await redis?.quit()`.
  - `getQueue()` exposed for tests.

### Phase 4 — Module wiring

- [x] **4.1** Update `apps/api/src/market-signal/market-signal.module.ts` to add
  `StalenessDetectionService` and `StalenessDetectionWorker` to `providers` and export
  `StalenessDetectionService`:
  ```ts
  @Module({
    providers: [
      OrlenIngestionService,
      OrlenIngestionWorker,
      StalenessDetectionService,
      StalenessDetectionWorker,
    ],
    exports: [StalenessDetectionService],
  })
  export class MarketSignalModule {}
  ```

### Phase 5 — Tests

- [x] **5.1** Create `apps/api/src/market-signal/staleness-detection.service.spec.ts`:
  - Mock `PrismaService`: `marketSignal.findMany`, `$queryRaw`, `stationFuelStaleness.createMany`,
    `stationFuelStaleness.deleteMany`, `stationFuelStaleness.findMany`.
  - **`detectStaleness` — no significant movements**:
    `findMany` returns `[]` → `createMany` not called, no error.
  - **`detectStaleness` — single fuel type (PB_95) with significant movement**:
    `findMany` returns `[{ signal_type: 'orlen_rack_pb95', significant_movement: true, ... }]`.
    `$queryRaw` returns two station rows. Expect `createMany` called with
    `{ data: [{ station_id: '...', fuel_type: 'PB_95', reason: 'orlen_movement' }, ...], skipDuplicates: true }`.
  - **`detectStaleness` — multiple fuel types (PB_95 + ON)**:
    `findMany` returns two signals. Expect `createMany` called twice (once per fuel type).
  - **`detectStaleness` — unknown signal_type has no mapping**:
    Signal with unknown type → mapped to `undefined` → filtered out → `createMany` not called.
  - **`detectStaleness` — DB error reading signals propagates**:
    `findMany` throws → `detectStaleness` rejects, `createMany` not called.
  - **`detectStaleness` — DB error writing flags propagates**:
    `$queryRaw` resolves, `createMany` throws → `detectStaleness` rejects.
  - **`clearStaleFlag` — deletes matching record**:
    Expect `deleteMany` called with `{ where: { station_id: 'abc', fuel_type: 'PB_95' } }`.
  - **`clearStaleFlag` — no-op when record absent** (deleteMany resolves with `{ count: 0 }`):
    No error thrown.
  - **`getStaleFuelTypes` — returns fuel types for station**:
    `findMany` returns `[{ fuel_type: 'PB_95' }, { fuel_type: 'ON' }]` → returns `['PB_95', 'ON']`.
  - **`getStaleFuelTypes` — returns empty array when no stale flags**:
    `findMany` returns `[]` → returns `[]`.

- [x] **5.2** Create `apps/api/src/market-signal/staleness-detection.worker.spec.ts`
  (mirrors `orlen-ingestion.worker.spec.ts`):
  - Mock `StalenessDetectionService`, `ConfigService`.
  - Verifies queue name is `'staleness-detection'`.
  - Verifies morning cron pattern is `'15 6 * * *'` with `tz: 'Europe/Warsaw'`.
  - Verifies afternoon cron pattern is `'15 14 * * *'` with `tz: 'Europe/Warsaw'`.
  - Verifies `backoffStrategy` returns `5 * 60 * 1000`.
  - Verifies `failed` handler logs `Logger.error` when `!willRetry`.
  - Verifies `onModuleDestroy` closes all resources.

### Phase 6 — Final checks

- [x] **6.1** Run `pnpm test` from `apps/api` — all tests pass (no regressions).
- [x] **6.2** Run `tsc --noEmit` from `apps/api` — zero errors.

## Definition of Done

- `StationFuelStaleness` model in schema + migration SQL present; Prisma client regenerated
- `StalenessDetectionService`: `detectStaleness` (reads signals, flags stale stations),
  `clearStaleFlag` (deletes on verified submission), `getStaleFuelTypes` (query helper)
- `StalenessDetectionWorker`: BullMQ, twice-daily (06:15 + 14:15 Europe/Warsaw), 5-min retry
- `MarketSignalModule` updated: exports `StalenessDetectionService`
- All API tests passing; `tsc --noEmit` clean

## Deferred

- **AC3 — Regional cluster propagation** — complex spatial query, deferred to Phase 2
- **AC4 caller integration** — `clearStaleFlag` is implemented but no caller exists in this
  story; will be wired by Epic 3 price submission verification flow
- **`getStaleFuelTypes` API exposure** — implemented but not yet surfaced via a REST endpoint;
  Story 2.9 (Redis cache) or 3.x will include stale status in the stations/prices response
- **Story 6.0 Brent crude signal** — Phase 2 extension; same service, new signal type

## Dev Notes

- `pct_change` in `MarketSignal` is stored as a fraction (0.03 = 3%), NOT a percentage.
  This story does NOT re-implement the 3% check — it only consumes `significant_movement: true`.
- Fuel type mapping: `SIGNAL_TO_FUEL_TYPE` maps ORLEN signal types to app fuel type strings.
  `PB_98` and `ON_PREMIUM` have no ORLEN rack signal in Phase 1 — they are never flagged by
  this story.
- `Submission.price_data` is a JSON array: `[{ fuel_type: string; price_per_litre: number }]`.
  Use `$queryRaw` with `price_data::jsonb @> ${JSON.stringify([{ fuel_type }])}::jsonb` for
  per-fuel-type membership checks. See `price.service.ts` for the established `$queryRaw`
  tagged-template pattern.
- `StationFuelStaleness` presence = stale. No `is_stale` boolean needed — delete to clear.
  `createMany` with `skipDuplicates: true` makes flag writes idempotent.
- Worker schedule: 06:15 / 14:15 Warsaw — 15 min after ORLEN ingestion (06:00 / 14:00).
  If ORLEN fails and retries, staleness detection will still run but find no new signals
  (no-op). Acceptable for MVP.
- All DB writes use `createMany` (single operation, atomic). No partial-commit risk.
- The `$queryRaw` result type is `{ id: string }[]` — validate with a guard if id is unexpectedly
  null (pre-existing pattern risk, acceptable at MVP scale).

## Dev Agent Record

### File List

- `packages/db/prisma/schema.prisma` — added `StationFuelStaleness` model, `staleness` relation on `Station`
- `packages/db/prisma/migrations/20260326130000_add_station_fuel_staleness/migration.sql` — new
- `apps/api/src/market-signal/staleness-detection.service.ts` — new
- `apps/api/src/market-signal/staleness-detection.worker.ts` — new
- `apps/api/src/market-signal/market-signal.module.ts` — updated: added StalenessDetectionService + Worker, exports StalenessDetectionService
- `apps/api/src/market-signal/staleness-detection.service.spec.ts` — new (21 tests)
- `apps/api/src/market-signal/staleness-detection.worker.spec.ts` — new (13 tests)

### Completion Notes

- `StationFuelStaleness`: `@@unique([station_id, fuel_type])` — record presence = stale, delete to clear.
- `detectStaleness`: reads `significant_movement: true` signals from last 24h, maps signal types via `SIGNAL_TO_FUEL_TYPE`, finds unupdated stations via `$queryRaw` with JSONB containment check, upserts with `createMany({ skipDuplicates: true })`.
- `clearStaleFlag`: uses `deleteMany` — silent no-op if no record exists.
- `StalenessDetectionWorker`: BullMQ, 06:15 + 14:15 Warsaw, 5-min retry, mirrors OrlenIngestionWorker pattern.
- AC3 (regional cluster) deferred; AC4 caller deferred to Epic 3 submission verification flow.
- 265/265 tests passing, tsc clean.

### Change Log

- 2026-03-26 — Story 2.8 implemented: `StationFuelStaleness` schema + migration, `StalenessDetectionService`, `StalenessDetectionWorker`, 34 new tests (265 total), tsc clean.

## Review Notes (2026-04-04)

No new patches. Prior review applied all patches — see sprint-status.yaml for details.
