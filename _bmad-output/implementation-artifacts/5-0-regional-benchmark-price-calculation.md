# Story 5.0: Regional Benchmark Price Calculation & Storage

Status: ready-for-dev

## Story

As a **developer**,
I want the system to periodically calculate and snapshot voivodeship-level average prices per fuel type,
So that savings calculations have a reliable, consistent benchmark to compare against.

## Acceptance Criteria

**AC1 — Daily snapshot job:**
Given a scheduled job runs every 24 hours at 03:00 UTC
When it calculates regional benchmarks
Then for each (voivodeship × fuel_type) combination it computes the median community price from all PriceHistory entries in the last 30 days (one price per station — the most recent)
And stores it as a `RegionalBenchmark` record with: voivodeship, fuel_type, median_price, calculated_at, station_count
And never overwrites previous records — each run appends a new snapshot row

**AC2 — Minimum data threshold:**
Given a voivodeship × fuel_type combination has fewer than 5 stations with a non-seeded price in the last 30 days
When the benchmark job runs
Then no record is written for that combination — insufficient data is silently skipped, not stored as zero or estimate

**AC3 — Lookup helper for fill-ups:**
Given a FillUp record is being created (Story 5.2)
When savings are to be calculated
Then `RegionalBenchmarkService.getLatestForStation(stationId, fuelType)` returns the most recent benchmark for that station's voivodeship × fuel_type combination — or `null` if none exists
And the caller (Story 5.2) stores the returned median_price as `area_avg_at_fillup` on the FillUp record permanently

**AC4 — Job observability:**
Given the benchmark job runs
When it completes
Then it logs: number of (voivodeship × fuel_type) combinations processed, number skipped (insufficient data), duration in ms
When it fails
Then it logs `[OPS-ALERT]` prefixed error with retry count, following existing worker patterns

## Tasks / Subtasks

- [ ] T1: Schema — `RegionalBenchmark` model + migration (AC1, AC2, AC3)
  - [ ] T1a: Add `RegionalBenchmark` model to `packages/db/prisma/schema.prisma`
  - [ ] T1b: Create migration file `packages/db/prisma/migrations/<timestamp>_add_regional_benchmarks/migration.sql`

- [ ] T2: `RegionalBenchmarkService` (AC1, AC2, AC3)
  - [ ] T2a: Create `apps/api/src/regional-benchmark/regional-benchmark.service.ts`
  - [ ] T2b: Implement `calculateAndStore()` — runs the aggregate SQL, filters `count < 5`, bulk-inserts new rows
  - [ ] T2c: Implement `getLatestForStation(stationId, fuelType)` — joins Station to get voivodeship, returns most recent benchmark row or null

- [ ] T3: `RegionalBenchmarkWorker` — BullMQ scheduled job (AC1, AC4)
  - [ ] T3a: Create `apps/api/src/regional-benchmark/regional-benchmark.worker.ts` following `station-sync.worker.ts` pattern
  - [ ] T3b: Schedule: cron `'0 3 * * *'` (03:00 UTC daily); jobId `'daily-benchmark-calc'` for idempotent restart
  - [ ] T3c: Log completion summary and `[OPS-ALERT]` on failure

- [ ] T4: `RegionalBenchmarkModule` + app registration (AC1)
  - [ ] T4a: Create `apps/api/src/regional-benchmark/regional-benchmark.module.ts` — registers service, worker, BullMQ queue
  - [ ] T4b: Import `RegionalBenchmarkModule` in `apps/api/src/app.module.ts`

- [ ] T5: Tests
  - [ ] T5a: `regional-benchmark.service.spec.ts` — `calculateAndStore`: inserts rows for voivodeship+fuel_type combos with ≥5 stations; skips combos below threshold; does not overwrite previous rows (appends); uses median not mean (odd-count and even-count cases)
  - [ ] T5b: `regional-benchmark.service.spec.ts` — `getLatestForStation`: returns correct latest row; returns null when no benchmark exists for that voivodeship × fuel_type
  - [ ] T5c: Full regression suite — all existing tests still pass

## Dev Notes

### Schema

```prisma
model RegionalBenchmark {
  id             String   @id @default(uuid())
  voivodeship    String
  fuel_type      String   // 'PB_95' | 'PB_98' | 'ON' | 'ON_PREMIUM' | 'LPG'
  median_price   Float    // PLN/litre
  station_count  Int      // number of stations contributing to this benchmark
  calculated_at  DateTime @default(now())

  @@index([voivodeship, fuel_type, calculated_at(sort: Desc)])
}
```

No unique constraint on (voivodeship, fuel_type) — each run appends a new row, preserving history. The index supports the `getLatestForStation` lookup efficiently.

### Core aggregate query

Use a raw Prisma `$queryRaw` call:

```sql
SELECT
  s.voivodeship,
  ph.fuel_type,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ph.price)  AS median_price,
  COUNT(DISTINCT ph.station_id)::int                      AS station_count
FROM (
  SELECT DISTINCT ON (ph2.station_id, ph2.fuel_type)
    ph2.station_id,
    ph2.fuel_type,
    ph2.price
  FROM "PriceHistory" ph2
  WHERE ph2.recorded_at >= NOW() - INTERVAL '30 days'
    AND ph2.source != 'seeded'
  ORDER BY ph2.station_id, ph2.fuel_type, ph2.recorded_at DESC
) ph
JOIN "Station" s ON s.id = ph.station_id
WHERE s.voivodeship IS NOT NULL
GROUP BY s.voivodeship, ph.fuel_type
HAVING COUNT(DISTINCT ph.station_id) >= 5
```

**Why median not mean:** A single price-gouging MOP (motorway service station) in a sparse voivodeship would skew the mean significantly. Median is robust to outliers and gives drivers a more honest "area average" to compare against.

**Why exclude `seeded`:** Seeded prices are calculated estimates, not observed community prices. Including them would circularly contaminate the benchmark with our own estimates. `community` and `admin_override` are both acceptable — admin overrides represent known real prices.

**Why DISTINCT ON (station × fuel_type):** We want one vote per station, not one vote per submission. A busy ORLEN in Warsaw with 200 community submissions should count once, the same as a quiet rural station with 2 submissions.

### `calculateAndStore()` implementation

```ts
async calculateAndStore(): Promise<{ inserted: number; skipped: number }> {
  const rows = await this.prisma.$queryRaw<BenchmarkRow[]>`...` // query above

  if (rows.length === 0) return { inserted: 0, skipped: 0 };

  await this.prisma.regionalBenchmark.createMany({
    data: rows.map((r) => ({
      voivodeship: r.voivodeship,
      fuel_type: r.fuel_type,
      median_price: r.median_price,
      station_count: r.station_count,
      // calculated_at defaults to now()
    })),
  });

  return { inserted: rows.length, skipped: /* total combos - rows.length — not easily known, log 0 */ 0 };
}
```

The HAVING clause in the query already filters out sub-threshold combinations, so `skipped` is not directly observable from this query alone. Log it as "X combinations written" — exact skip count is not needed for ops.

### `getLatestForStation()` implementation

```ts
async getLatestForStation(
  stationId: string,
  fuelType: string,
): Promise<{ medianPrice: number } | null> {
  const station = await this.prisma.station.findUnique({
    where: { id: stationId },
    select: { voivodeship: true },
  });
  if (!station?.voivodeship) return null;

  const benchmark = await this.prisma.regionalBenchmark.findFirst({
    where: { voivodeship: station.voivodeship, fuel_type: fuelType },
    orderBy: { calculated_at: 'desc' },
    select: { median_price: true },
  });

  return benchmark ? { medianPrice: benchmark.median_price } : null;
}
```

Two queries is acceptable — stations are cached in Prisma's connection pool and voivodeship lookups are indexed. Do not over-optimise with a JOIN here; clarity matters more.

### Worker pattern

Follow `apps/api/src/station/station-sync.worker.ts` exactly:

```ts
// regional-benchmark.worker.ts
export const BENCHMARK_JOB = 'calculate-regional-benchmarks';
export const BENCHMARK_QUEUE = 'regional-benchmark';

@Injectable()
export class RegionalBenchmarkWorker extends WorkerHost implements OnApplicationBootstrap {
  constructor(
    @InjectQueue(BENCHMARK_QUEUE) private readonly queue: Queue,
    private readonly benchmarkService: RegionalBenchmarkService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async onApplicationBootstrap() {
    await this.queue.add(
      BENCHMARK_JOB,
      {},
      {
        repeat: { pattern: '0 3 * * *' },
        jobId: 'daily-benchmark-calc',
        removeOnComplete: { count: 5 },
        removeOnFail: { count: 20 },
      },
    );
  }

  async process(job: Job): Promise<void> {
    const start = Date.now();
    this.logger.log(`[BenchmarkWorker] starting job ${job.id}`);
    const result = await this.benchmarkService.calculateAndStore();
    const duration = Date.now() - start;
    this.logger.log(
      `[BenchmarkWorker] complete — ${result.inserted} combinations written in ${duration}ms`,
    );
  }
}
```

Register `BullModule.registerQueue({ name: BENCHMARK_QUEUE })` in `RegionalBenchmarkModule`. Use the same Redis connection config as `StationSyncWorker` (inherit from shared BullModule config in AppModule).

### Module registration

```ts
// regional-benchmark.module.ts
@Module({
  imports: [
    BullModule.registerQueue({ name: BENCHMARK_QUEUE }),
    PrismaModule,
  ],
  providers: [RegionalBenchmarkService, RegionalBenchmarkWorker],
  exports: [RegionalBenchmarkService],  // exported for Story 5.2 (FillUp service)
})
export class RegionalBenchmarkModule {}
```

Export `RegionalBenchmarkService` — Story 5.2's `FillUpService` will inject it to look up benchmarks at fill-up time.

### Note on Story 3.7 usage

The epics spec notes this table also serves Story 3.7 (price validation tier 2). Story 3.7 would import `RegionalBenchmarkService` and call `getLatestForStation()` to cross-check submitted prices against the regional median. No changes to Story 3.7 scope needed now — the service interface is sufficient.

### Project Structure Notes

- New directory: `apps/api/src/regional-benchmark/`
  - `regional-benchmark.service.ts` (new)
  - `regional-benchmark.worker.ts` (new)
  - `regional-benchmark.module.ts` (new)
- `packages/db/prisma/schema.prisma` (modified — new RegionalBenchmark model)
- `packages/db/prisma/migrations/<timestamp>_add_regional_benchmarks/migration.sql` (new)
- `apps/api/src/app.module.ts` (modified — import RegionalBenchmarkModule)
- **No admin UI changes** — this is a pure backend story

### References

- BullMQ worker pattern: [apps/api/src/station/station-sync.worker.ts](apps/api/src/station/station-sync.worker.ts)
- Existing voivodeship query pattern: [apps/api/src/price/price-history.service.ts](apps/api/src/price/price-history.service.ts)
- `Station` model with `voivodeship` index: [packages/db/prisma/schema.prisma](packages/db/prisma/schema.prisma#L74)
- `PriceHistory` model and index: [packages/db/prisma/schema.prisma](packages/db/prisma/schema.prisma#L194)
- Story 5.2 (FillUp recording — consumes `getLatestForStation`)
- Story 3.7 (price validation tier 2 — also consumes `getLatestForStation`)
- Story epics spec: [_bmad-output/planning-artifacts/epics.md](_bmad-output/planning-artifacts/epics.md) — Story 5.0 (line ~2099)

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List

- `packages/db/prisma/schema.prisma` (modified — new RegionalBenchmark model)
- `packages/db/prisma/migrations/<timestamp>_add_regional_benchmarks/migration.sql` (new)
- `apps/api/src/regional-benchmark/regional-benchmark.service.ts` (new)
- `apps/api/src/regional-benchmark/regional-benchmark.worker.ts` (new)
- `apps/api/src/regional-benchmark/regional-benchmark.module.ts` (new)
- `apps/api/src/app.module.ts` (modified — import RegionalBenchmarkModule)
- `apps/api/src/regional-benchmark/regional-benchmark.service.spec.ts` (new)
- `_bmad-output/implementation-artifacts/5-0-regional-benchmark-price-calculation.md` (this file)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)
