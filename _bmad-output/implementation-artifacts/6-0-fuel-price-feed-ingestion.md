# Story 6.0: Fuel Price Feed Ingestion

Status: ready-for-dev

## Story

As a **developer**,
I want the system to extend the existing rack price ingestion with Brent crude in PLN and publish rise signal events,
So that sharp rise alerts (Story 6.3) have an upstream early-warning signal beyond what ORLEN rack alone provides.

## Acceptance Criteria

**AC1 — Brent crude + NBP rate fetched:**
Given the existing twice-daily scheduled job (06:00 and 14:00 Warsaw)
When it runs
Then it also fetches the current Brent crude price (USD/barrel) from Alpha Vantage
And fetches the current USD/PLN exchange rate from the NBP public API
And calculates `brent_crude_pln = (USD/barrel × PLN/USD) ÷ 158.987` (PLN/litre equivalent)
And stores a `MarketSignal` record: signal_type `brent_crude_pln`, value (PLN/litre), pct_change vs previous, rate_source `live`

**AC2 — NBP rate unavailable:**
Given the NBP exchange rate API is unavailable or times out
When the ingestion job runs
Then the last known USD/PLN rate is read from Redis cache (key `market:nbp:usd_pln`, up to 24h stale)
And the `MarketSignal` record is stored with `rate_source: 'cached'`
And if no cached rate exists at all, Brent ingestion is skipped entirely for this run (logged as warning, not error)

**AC3 — Brent feed unavailable:**
Given the Alpha Vantage API is unavailable or times out
When the ingestion job runs
Then the ORLEN rack ingestion completes normally — Brent failure is logged as `[OPS-ALERT]` but does not block or fail the job

**AC4 — Rise signal published:**
Given either ORLEN rack price or Brent crude in PLN shows upward movement of ≥3% within 24 hours
When the ingestion job completes
Then a job is added to the `price-rise-signals` BullMQ queue with: `signalSource`, `fuelTypes`, `pctMovement`, `recordedAt`
And only upward movements publish events — downward movements are stored in `MarketSignal` but do not trigger alerts

**AC5 — Data retention:**
Given MarketSignal records older than 90 days
When they are queried or cleaned up
Then they are retained — never deleted; full history preserved for trend analysis

## Tasks / Subtasks

- [ ] T1: Schema — extend `MarketSignal` + `SignalType` enum (AC1, AC2)
  - [ ] T1a: Add `brent_crude_pln` to `SignalType` enum in `packages/db/prisma/schema.prisma`
  - [ ] T1b: Add `rate_source String?` to `MarketSignal` model (`'live'` | `'cached'` | null for ORLEN signals)
  - [ ] T1c: Create migration `packages/db/prisma/migrations/<timestamp>_add_brent_crude_signal/migration.sql`

- [ ] T2: `BrentIngestionService` (AC1, AC2, AC3)
  - [ ] T2a: Create `apps/api/src/market-signal/brent-ingestion.service.ts`
  - [ ] T2b: Implement `fetchBrentUsd()` — calls Alpha Vantage BRENT daily endpoint; 10s `AbortSignal.timeout`; returns `number | null`
  - [ ] T2c: Implement `fetchNbpRate()` — calls NBP `/api/exchangerates/rates/A/USD/`; 10s timeout; on success writes rate to Redis `market:nbp:usd_pln` with 24h TTL; returns `{ rate: number; source: 'live' | 'cached' }`
  - [ ] T2d: Implement `ingest()` — orchestrates T2b/T2c; calculates PLN/litre; stores `MarketSignal`; returns `BrentSignalRecord | null` (null = skipped)

- [ ] T3: `PriceRiseSignalPublisher` (AC4)
  - [ ] T3a: Create `apps/api/src/market-signal/price-rise-signal.publisher.ts`
  - [ ] T3b: Inject `PRICE_RISE_SIGNALS_QUEUE` (BullMQ queue name constant); exported as `PRICE_RISE_SIGNALS_QUEUE = 'price-rise-signals'`
  - [ ] T3c: Implement `maybePublish(signals: MovementRecord[])` — filters to upward movements ≥3%; maps to `PriceRiseSignalJobData`; adds to queue; returns count of jobs published

- [ ] T4: Extend `OrlenIngestionService` (AC4)
  - [ ] T4a: Change `ingest()` return type from `void` to `MovementRecord[]` — returns the signal records already computed in `storeSignals()` so the worker can pass them to `PriceRiseSignalPublisher`

- [ ] T5: Extend `OrlenIngestionWorker` (AC1, AC3, AC4)
  - [ ] T5a: Inject `BrentIngestionService` and `PriceRiseSignalPublisher`
  - [ ] T5b: In `process()`: call `orlenIngestionService.ingest()` first; call `brentIngestionService.ingest()` in a `try/catch` (non-blocking); collect all movement records; call `riseSignalPublisher.maybePublish(allMovements)`
  - [ ] T5c: Register `PRICE_RISE_SIGNALS_QUEUE` in `MarketSignalModule`

- [ ] T6: Update `MarketSignalModule`
  - [ ] T6a: Add `BrentIngestionService`, `PriceRiseSignalPublisher` to providers
  - [ ] T6b: Register `BullModule.registerQueue({ name: PRICE_RISE_SIGNALS_QUEUE })`
  - [ ] T6c: Export `PriceRiseSignalPublisher` — Story 6.3 imports it via `MarketSignalModule`

- [ ] T7: Environment
  - [ ] T7a: Add `ALPHA_VANTAGE_API_KEY` to `apps/api/src/config/` validation schema and Railway environment variables

- [ ] T8: Tests
  - [ ] T8a: `brent-ingestion.service.spec.ts` — `fetchBrentUsd`: parses Alpha Vantage response correctly; returns null on non-200; returns null on parse error; `fetchNbpRate`: returns 'live' on success + writes to Redis; returns 'cached' when Redis has value and NBP unavailable; returns null (skip) when Redis empty and NBP unavailable; `ingest`: calculates PLN/litre correctly (USD × rate ÷ 158.987); stores `rate_source: 'cached'` when rate came from cache
  - [ ] T8b: `price-rise-signal.publisher.spec.ts` — publishes job for ≥3% upward movement; does not publish for downward movement; does not publish for <3% upward movement; publishes correct `fuelTypes` for each signal type
  - [ ] T8c: `orlen-ingestion.service.spec.ts` — `ingest()` now returns `MovementRecord[]` (non-breaking: existing test assertions still valid, just verify return value type)
  - [ ] T8d: Full regression suite — all existing tests still pass

## Dev Notes

### ⚠️ Pre-implementation checklist

Before starting implementation, validate:
1. **Alpha Vantage** free tier (25 req/day) is sufficient for 2× daily schedule — confirm API key obtained and endpoint `BRENT&interval=daily` returns current data
2. **NBP API** endpoint `https://api.nbp.pl/api/exchangerates/rates/A/USD/?format=json` — confirm it returns same-day rates (NBP publishes by ~11:30 Warsaw on business days; weekends/holidays use last published rate)

### SignalType enum extension

```prisma
enum SignalType {
  orlen_rack_pb95
  orlen_rack_on
  orlen_rack_lpg
  brent_crude_pln   // NEW — PLN/litre equivalent
}
```

### MarketSignal schema amendment

```prisma
model MarketSignal {
  // ... existing fields ...
  rate_source String?  // 'live' | 'cached' | null (null for ORLEN signals)
}
```

### Brent PLN/litre calculation

```ts
const BARRELS_TO_LITRES = 158.987;

function brentToPlnPerLitre(usdPerBarrel: number, plnPerUsd: number): number {
  return (usdPerBarrel * plnPerUsd) / BARRELS_TO_LITRES;
}
// Example: 72.00 USD/bbl × 3.92 PLN/USD ÷ 158.987 = 1.776 PLN/litre (crude cost only — not retail)
```

This figure is not a retail price — it's a directional signal. A 3% upward move in Brent PLN is the trigger, not the absolute value.

### Alpha Vantage API response

```ts
// GET https://www.alphavantage.co/query?function=BRENT&interval=daily&apikey={KEY}
interface AlphaVantageResponse {
  name: string;
  data: Array<{ date: string; value: string }>;  // most recent first; value is string
}

function parseBrentUsd(response: AlphaVantageResponse): number {
  const latest = response.data?.[0];
  if (!latest || latest.value === '.' || latest.value === '') return null;
  const val = parseFloat(latest.value);
  if (isNaN(val) || val <= 0 || val > 300) return null;  // plausibility: 0–300 USD/bbl
  return val;
}
```

Alpha Vantage returns `"."` for missing values (API quirk) — guard against this.

### NBP API response

```ts
// GET https://api.nbp.pl/api/exchangerates/rates/A/USD/?format=json
interface NbpResponse {
  table: string;
  currency: string;
  code: string;
  rates: Array<{ no: string; effectiveDate: string; mid: number }>;
}

function parseNbpRate(response: NbpResponse): number {
  const rate = response.rates?.[0]?.mid;
  if (!rate || rate <= 0 || rate > 20) return null;  // plausibility: 0–20 PLN/USD
  return rate;
}
```

### Redis cache for NBP rate

```ts
// In BrentIngestionService.fetchNbpRate():
const REDIS_KEY = 'market:nbp:usd_pln';
const TTL_SECONDS = 86_400; // 24h

// On successful fetch:
await this.redis.set(REDIS_KEY, rate.toString(), 'EX', TTL_SECONDS);

// On fetch failure:
const cached = await this.redis.get(REDIS_KEY);
if (cached) return { rate: parseFloat(cached), source: 'cached' };
return null; // no cache, no rate — skip Brent entirely this run
```

### PriceRiseSignalJobData type

```ts
// apps/api/src/market-signal/price-rise-signal.publisher.ts
export const PRICE_RISE_SIGNALS_QUEUE = 'price-rise-signals';

export interface PriceRiseSignalJobData {
  signalSource: 'orlen_rack' | 'brent_crude_pln';
  fuelTypes: string[];      // e.g. ['PB_95', 'PB_98'] for orlen_rack_pb95
  pctMovement: number;      // positive fraction (e.g. 0.035 = 3.5% upward)
  signalType: string;       // raw signal_type value
  recordedAt: string;       // ISO datetime
}
```

### Fuel type mapping per signal

```ts
const SIGNAL_FUEL_TYPES: Record<string, string[]> = {
  orlen_rack_pb95:  ['PB_95', 'PB_98'],
  orlen_rack_on:    ['ON', 'ON_PREMIUM'],
  orlen_rack_lpg:   ['LPG'],
  brent_crude_pln:  ['PB_95', 'PB_98', 'ON', 'ON_PREMIUM'],  // crude-derived only; not LPG
};
```

### MovementRecord type (shared between services)

```ts
// apps/api/src/market-signal/types.ts (new shared types file)
export interface MovementRecord {
  signalType: string;
  pctChange: number;          // fraction; positive = upward
  significantMovement: boolean;
  recordedAt: Date;
}
```

`OrlenIngestionService.ingest()` returns `MovementRecord[]`. `BrentIngestionService.ingest()` returns `MovementRecord | null`.

### Extended OrlenIngestionWorker.process()

```ts
async process(job: Job): Promise<void> {
  // 1. ORLEN rack (existing — now returns movements)
  const orlenMovements = await this.orlenIngestionService.ingest();

  // 2. Brent crude (new — non-blocking)
  let brentMovement: MovementRecord | null = null;
  try {
    brentMovement = await this.brentIngestionService.ingest();
  } catch (err) {
    this.logger.warn(`[OPS-ALERT] Brent ingestion failed: ${(err as Error).message}`);
  }

  // 3. Publish rise signals
  const allMovements = [...orlenMovements, ...(brentMovement ? [brentMovement] : [])];
  const published = await this.riseSignalPublisher.maybePublish(allMovements);
  if (published > 0) {
    this.logger.log(`Published ${published} price-rise-signal event(s)`);
  }
}
```

### maybePublish() implementation

```ts
async maybePublish(movements: MovementRecord[]): Promise<number> {
  const rising = movements.filter(m => m.pctChange >= 0.03);
  if (rising.length === 0) return 0;

  await Promise.all(
    rising.map((m) =>
      this.queue.add('price-rise-signal', {
        signalSource: m.signalType.startsWith('orlen_rack') ? 'orlen_rack' : 'brent_crude_pln',
        fuelTypes: SIGNAL_FUEL_TYPES[m.signalType] ?? [],
        pctMovement: m.pctChange,
        signalType: m.signalType,
        recordedAt: m.recordedAt.toISOString(),
      } satisfies PriceRiseSignalJobData, {
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 20 },
      }),
    ),
  );
  return rising.length;
}
```

### Project Structure Notes

- `packages/db/prisma/schema.prisma` (modified — `brent_crude_pln` in SignalType; `rate_source` on MarketSignal)
- `packages/db/prisma/migrations/<timestamp>_add_brent_crude_signal/migration.sql` (new)
- `apps/api/src/market-signal/brent-ingestion.service.ts` (new)
- `apps/api/src/market-signal/price-rise-signal.publisher.ts` (new)
- `apps/api/src/market-signal/types.ts` (new — shared `MovementRecord` interface)
- `apps/api/src/market-signal/orlen-ingestion.service.ts` (modified — return `MovementRecord[]`)
- `apps/api/src/market-signal/orlen-ingestion.worker.ts` (modified — inject new services, extended process())
- `apps/api/src/market-signal/market-signal.module.ts` (modified — new providers + BullMQ queue)
- `apps/api/src/market-signal/brent-ingestion.service.spec.ts` (new)
- `apps/api/src/market-signal/price-rise-signal.publisher.spec.ts` (new)
- **No mobile changes** — purely backend

### References

- Existing ORLEN ingestion: [apps/api/src/market-signal/orlen-ingestion.service.ts](apps/api/src/market-signal/orlen-ingestion.service.ts)
- Existing worker pattern: [apps/api/src/market-signal/orlen-ingestion.worker.ts](apps/api/src/market-signal/orlen-ingestion.worker.ts)
- `MarketSignal` model + `SignalType` enum: [packages/db/prisma/schema.prisma](packages/db/prisma/schema.prisma#L130)
- `PRICE_RISE_SIGNALS_QUEUE` consumed by Story 6.3 (`PredictiveRiseAlertsService`)
- Story 6.3 (predictive rise alerts — processes `price-rise-signals` queue)
- Story epics spec: [_bmad-output/planning-artifacts/epics.md](_bmad-output/planning-artifacts/epics.md) — Story 6.0 (line ~2453)

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List

- `packages/db/prisma/schema.prisma` (modified)
- `packages/db/prisma/migrations/<timestamp>_add_brent_crude_signal/migration.sql` (new)
- `apps/api/src/market-signal/brent-ingestion.service.ts` (new)
- `apps/api/src/market-signal/price-rise-signal.publisher.ts` (new)
- `apps/api/src/market-signal/types.ts` (new)
- `apps/api/src/market-signal/orlen-ingestion.service.ts` (modified)
- `apps/api/src/market-signal/orlen-ingestion.worker.ts` (modified)
- `apps/api/src/market-signal/market-signal.module.ts` (modified)
- `apps/api/src/market-signal/brent-ingestion.service.spec.ts` (new)
- `apps/api/src/market-signal/price-rise-signal.publisher.spec.ts` (new)
- `_bmad-output/implementation-artifacts/6-0-fuel-price-feed-ingestion.md` (this file)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)
