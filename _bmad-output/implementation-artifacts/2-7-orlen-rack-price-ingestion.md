# Story 2.7: ORLEN Rack Price Ingestion

Status: review

## Story

As a **developer**,
I want the system to ingest ORLEN rack prices on a scheduled basis,
So that Stories 2.8 (staleness detection) and 2.12 (estimated price ranges) have real-time Polish
market signals to work with from Phase 1 launch.

## Why

ORLEN rack prices are the most direct leading indicator for pump prices in Poland — when ORLEN
moves their wholesale price, independents and competitors follow within 24–48h. Having this signal
from day one makes staleness detection meaningful and estimated ranges accurate.

## Scope

- **In:** `market_signal` table + Prisma model, `OrlenIngestionService` (fetch/parse/store),
  `OrlenIngestionWorker` (BullMQ cron — 06:00 + 14:00 Europe/Warsaw), 30-minute retry on failure,
  `significant_movement` flag (≥3% movement), `MarketSignalModule`, AppModule registration.
- **Out:** Staleness auto-detection (Story 2.8), rack-derived price range display (Story 2.12),
  Story 6.0 Brent crude signal, per-station stale flag writing, push notifications.
- 90-day archival policy: records are never deleted — full history retained. No archival job in
  this story.

## Acceptance Criteria

1. **Given** a scheduled job runs twice daily (06:00 and 14:00 Europe/Warsaw)
   **When** it polls ORLEN's public rack price page (`ORLEN_RACK_PRICE_URL` env var)
   **Then** it fetches PB95, ON, LPG wholesale prices and stores each as a `market_signal` record
   with `signal_type` (orlen_rack_pb95 | orlen_rack_on | orlen_rack_lpg), `value` (PLN/litre),
   `recorded_at`, and `pct_change` vs previous reading.

2. **Given** the ORLEN page is unavailable or returns unexpected data
   **When** the ingestion job runs
   **Then** it retries once after 30 minutes — if still failing, an error is logged (ops alert),
   and the previous `market_signal` record is retained (no stale zeroes written).

3. **Given** a new `market_signal` record is written
   **When** it represents a movement of ≥3% (absolute) vs the previous reading for any fuel type
   **Then** `significant_movement: true` is set on the record (for Story 2.8 consumption).

4. **Given** a fuel type's first ever ingestion
   **When** no previous `market_signal` exists for that type
   **Then** `pct_change` is `null` and `significant_movement` is `false`.

5. **Given** `market_signal` records exist
   **When** they are older than 90 days
   **Then** they are never deleted — full history retained for trend analysis (no delete logic
   in this story).

6. **Given** `tsc --noEmit`
   **When** run from `apps/api`
   **Then** zero type errors.

## Tasks / Subtasks

### Phase 1 — DB: `market_signal` table

- [x] **1.1** Add `SignalType` enum and `MarketSignal` model to
  `packages/db/prisma/schema.prisma`:
  ```prisma
  enum SignalType {
    orlen_rack_pb95
    orlen_rack_on
    orlen_rack_lpg
  }

  model MarketSignal {
    id                   String     @id @default(uuid())
    signal_type          SignalType
    value                Float      // PLN/litre
    pct_change           Float?     // fraction (0.03 = 3%); null for first ingestion
    significant_movement Boolean    @default(false)
    recorded_at          DateTime   @default(now())
    created_at           DateTime   @default(now())

    @@index([signal_type, recorded_at])
  }
  ```

- [x] **1.2** Create migration manually (no live DB):
  Create `packages/db/prisma/migrations/20260326120000_add_market_signal/migration.sql`:
  ```sql
  CREATE TYPE "SignalType" AS ENUM ('orlen_rack_pb95', 'orlen_rack_on', 'orlen_rack_lpg');

  CREATE TABLE "MarketSignal" (
    "id"                   TEXT NOT NULL,
    "signal_type"          "SignalType" NOT NULL,
    "value"                DOUBLE PRECISION NOT NULL,
    "pct_change"           DOUBLE PRECISION,
    "significant_movement" BOOLEAN NOT NULL DEFAULT false,
    "recorded_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketSignal_pkey" PRIMARY KEY ("id")
  );

  CREATE INDEX "MarketSignal_signal_type_recorded_at_idx"
    ON "MarketSignal"("signal_type", "recorded_at");
  ```
  Then run `pnpm --filter @desert/db exec prisma generate` to regenerate client.

### Phase 2 — `OrlenIngestionService`

- [x] **2.1** Create `apps/api/src/market-signal/orlen-ingestion.service.ts`:
  - Constructor injects `PrismaService` + `ConfigService`, reads `ORLEN_RACK_PRICE_URL`.
  - `async ingest(): Promise<void>` — orchestrates fetch → parse → store.
  - `async fetchPage(): Promise<string>` — GET with 15s `AbortSignal.timeout`, throws on
    non-OK status.
  - `parsePrices(html: string): RackPrices` — extracts PB95, ON, LPG from ORLEN table HTML.
    Fuel labels: `Eurosuper 95` (PB95), `Ekodiesel` (ON), `Autogas` (LPG).
    ORLEN publishes PLN/1000L → divide by 1000.
    Throws `Error` if any fuel cannot be found or parsed.
  - `private async storeSignals(prices: RackPrices): Promise<void>`:
    - For each signal type: fetch most recent record, compute `pct_change` fraction
      (`(value - prev) / prev`), set `significant_movement` if `|pct_change| >= 0.03`.
    - Create new `MarketSignal` record.
    - Logger.warn on significant movement.

- [x] **2.2** `RackPrices` interface exported:
  ```ts
  export interface RackPrices {
    pb95: number; // PLN/litre
    on: number;
    lpg: number;
  }
  ```

### Phase 3 — `OrlenIngestionWorker`

- [x] **3.1** Create `apps/api/src/market-signal/orlen-ingestion.worker.ts` (mirrors
  `StationSyncWorker` pattern):
  - Dedicated ioredis connection (`maxRetriesPerRequest: null`).
  - Queue: `orlen-ingestion`; job: `run-ingestion`.
  - Two repeat schedules (idempotent jobIds):
    - Morning: `{ pattern: '0 6 * * *', tz: 'Europe/Warsaw' }`, jobId: `orlen-morning`
    - Afternoon: `{ pattern: '0 14 * * *', tz: 'Europe/Warsaw' }`, jobId: `orlen-afternoon`
  - `JOB_OPTIONS`: `attempts: 2` (1 initial + 1 retry), `backoff: { type: 'custom' }`.
  - `backoffStrategy`: always returns `30 * 60 * 1000` ms (30 min).
  - On final failure: `Logger.error` "ORLEN ingestion FAILED — ops alert required".
  - `onModuleDestroy`: close worker, queue, redis.
  - `getQueue()` exposed for tests.

### Phase 4 — Module wiring

- [x] **4.1** Create `apps/api/src/market-signal/market-signal.module.ts`:
  ```ts
  @Module({
    providers: [OrlenIngestionService, OrlenIngestionWorker],
  })
  export class MarketSignalModule {}
  ```

- [x] **4.2** Add `MarketSignalModule` to `apps/api/src/app.module.ts` imports.

### Phase 5 — Tests

- [x] **5.1** Create `apps/api/src/market-signal/orlen-ingestion.service.spec.ts`:
  - Mock `PrismaService` and `ConfigService`.
  - Test `parsePrices`: valid HTML → correct PLN/litre values; missing fuel → throws.
  - Test `ingest` / `storeSignals`:
    - First ingestion: `pct_change: null`, `significant_movement: false`.
    - 2% movement: `significant_movement: false`.
    - 3% movement exactly: `significant_movement: true`.
    - Negative movement ≥3%: `significant_movement: true`.
    - `fetchPage` non-OK response → throws (no record created).

- [x] **5.2** Create `apps/api/src/market-signal/orlen-ingestion.worker.spec.ts`:
  - Mock `OrlenIngestionService`, `ConfigService`.
  - Verifies worker skips initialisation gracefully when tested (spy on `onModuleInit`).
  - Verifies `getQueue()` returns the queue instance after init.

### Phase 6 — Final checks

- [x] **6.1** Run `pnpm test` from `apps/api` — all tests pass (no regressions).
- [x] **6.2** Run `tsc --noEmit` from `apps/api` — zero errors.

## Definition of Done

- `SignalType` enum + `MarketSignal` model in schema; migration SQL file present
- Prisma client regenerated
- `OrlenIngestionService`: fetch, parse (regex), store with pct_change + significant_movement
- `OrlenIngestionWorker`: BullMQ, twice-daily cron (06:00 + 14:00 Europe/Warsaw), 30-min retry
- `MarketSignalModule` registered in `AppModule`
- All API tests passing; `tsc --noEmit` clean

## Deferred

- **90-day archival job** — records are never deleted in this story; archival mechanism deferred
- **Story 2.8 integration** — `significant_movement` flag is written but consumed by Story 2.8
- **Story 2.12 integration** — seeded price range display uses Story 2.7 + 2.12 together
- **Story 6.0 Brent crude signal** — Phase 2 extension; same module, new signal type
- **ORLEN page parser maintenance** — parser may need updates if ORLEN changes page layout
