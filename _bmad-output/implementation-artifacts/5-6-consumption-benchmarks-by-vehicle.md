# Story 5.6: Real-World Consumption Benchmarks by Vehicle

Status: ready-for-dev

## Story

As a **driver**,
I want to see how my car's fuel consumption compares to other drivers with the same make, model, and engine,
So that I know whether my driving habits and car's condition are in line with what others actually experience — not just manufacturer claims.

## Acceptance Criteria

**AC1 — Benchmark display:**
Given a driver views a vehicle's history screen (Story 5.5)
When at least 10 drivers with the same make, model, and engine variant have each contributed ≥3 consumption segments in the last 90 days
Then a benchmark section is shown: community average l/100km for that engine variant, an anonymised driver count, and where the driver sits relative to the average (e.g. "Your average: 7.2 L/100km — community: 7.6 L/100km")

**AC2 — Minimum threshold:**
Given fewer than 10 qualifying drivers exist for that engine variant
When the benchmark section would be shown
Then it is omitted entirely — no placeholder, no "not enough data yet" message in the main view

**AC3 — Clearly labelled:**
Given a benchmark is shown
When the driver views it
Then it is clearly labelled as community-sourced real-world data — never presented as manufacturer specification
And no individual driver's data is identifiable from the display

**AC4 — Daily calculation job:**
Given a scheduled job runs every 24 hours at 04:00 UTC
When it recalculates benchmarks
Then for each (make × model × engine variant) combination with ≥10 qualifying drivers it computes the median l/100km from all eligible segments in the last 90 days
And stores it as a new `ConsumptionBenchmark` row — appending, never overwriting
And skips combinations with fewer than 10 qualifying drivers entirely

**AC5 — Driver contribution eligibility:**
Given a driver has fewer than 3 recorded consumption segments for a vehicle
When their data would contribute to a benchmark
Then it is excluded — minimum 3 segments per driver per vehicle required

**AC6 — Vehicle without engine variant:**
Given a vehicle was saved without an engine variant (the field was skipped in Story 5.1)
When its consumption data would contribute to a benchmark
Then it is excluded — benchmarks require engine variant to be meaningful

## Tasks / Subtasks

- [ ] T1: Schema — `ConsumptionBenchmark` model + migration (AC4)
  - [ ] T1a: Add `ConsumptionBenchmark` model to `packages/db/prisma/schema.prisma` (see Dev Notes)
  - [ ] T1b: Create migration `packages/db/prisma/migrations/<timestamp>_add_consumption_benchmarks/migration.sql`

- [ ] T2: `ConsumptionBenchmarkService` (AC4, AC5, AC6)
  - [ ] T2a: Create `apps/api/src/consumption-benchmark/consumption-benchmark.service.ts`
  - [ ] T2b: Implement `calculateAndStore()` — runs the aggregate query (see Dev Notes); bulk-inserts new rows; returns `{ inserted, skipped }`
  - [ ] T2c: Implement `getForVehicle(vehicleId)` — looks up the most recent benchmark matching the vehicle's make, model, and engine variant; returns `ConsumptionBenchmarkDto | null`

- [ ] T3: `ConsumptionBenchmarkWorker` — BullMQ scheduled job (AC4)
  - [ ] T3a: Create `apps/api/src/consumption-benchmark/consumption-benchmark.worker.ts` — cron `'0 4 * * *'` (04:00 UTC daily); jobId `'daily-consumption-benchmark'`; follows `station-sync.worker.ts` pattern
  - [ ] T3b: Log completion summary; log `[OPS-ALERT]` on failure

- [ ] T4: `ConsumptionBenchmarkModule` + app registration
  - [ ] T4a: Create `apps/api/src/consumption-benchmark/consumption-benchmark.module.ts`; export `ConsumptionBenchmarkService`
  - [ ] T4b: Import in `apps/api/src/app.module.ts`

- [ ] T5: API — vehicle benchmark endpoint (AC1, AC2)
  - [ ] T5a: Add `GET /v1/me/vehicles/:id/benchmark` to `VehiclesController` (Story 5.1)
  - [ ] T5b: Returns `ConsumptionBenchmarkDto | null` — null means threshold not met; mobile omits section

- [ ] T6: Mobile — benchmark section in `log.tsx` (AC1–AC3)
  - [ ] T6a: Replace the `{/* TODO(Story 5.6): benchmark section here */}` comment from Story 5.5 with `<BenchmarkSection vehicleId={selectedVehicleId} t={t} />`
  - [ ] T6b: Implement `BenchmarkSection` inline component — fetches `GET /v1/me/vehicles/:id/benchmark`; renders nothing on null response (AC2); renders benchmark card on success (AC1, AC3)
  - [ ] T6c: Only show `BenchmarkSection` when a specific vehicle is selected (not "All vehicles" view)

- [ ] T7: i18n — all 3 locales (AC1, AC3)
  - [ ] T7a: Add `benchmark` section to `apps/mobile/src/i18n/locales/{en,pl,uk}.ts` (see Dev Notes)

- [ ] T8: Tests
  - [ ] T8a: `consumption-benchmark.service.spec.ts` — `calculateAndStore`: inserts benchmark for group with ≥10 drivers each with ≥3 segments; skips group with <10 drivers; skips drivers with <3 segments; excludes vehicles without engine_variant; does not overwrite previous rows
  - [ ] T8b: `consumption-benchmark.service.spec.ts` — `getForVehicle`: returns latest benchmark for matching make/model/engine_variant; returns null when none exists; returns null when vehicle has no engine_variant
  - [ ] T8c: Full regression suite — all existing tests still pass

## Dev Notes

### Schema

```prisma
model ConsumptionBenchmark {
  id                  String   @id @default(uuid())
  make                String
  model               String
  engine_variant      String
  median_l_per_100km  Float
  driver_count        Int
  calculated_at       DateTime @default(now())

  @@index([make, model, engine_variant, calculated_at(sort: Desc)])
}
```

No unique constraint — each daily run appends a new row, preserving history. The index supports efficient `getForVehicle` lookups.

### Core aggregate query

Two-step approach to enforce the per-driver minimum (≥3 segments):

**Step 1 — identify eligible (driver × vehicle) pairs:**
```sql
WITH eligible_drivers AS (
  SELECT
    f.user_id,
    v.make,
    v.model,
    v.engine_variant
  FROM "FillUp" f
  JOIN "Vehicle" v ON v.id = f.vehicle_id
  WHERE f.consumption_l_per_100km IS NOT NULL
    AND f.filled_at >= NOW() - INTERVAL '90 days'
    AND v.engine_variant IS NOT NULL
    AND v.engine_variant != ''
  GROUP BY f.user_id, v.make, v.model, v.engine_variant
  HAVING COUNT(*) >= 3
),
```

**Step 2 — aggregate over eligible drivers only:**
```sql
benchmarks AS (
  SELECT
    ed.make,
    ed.model,
    ed.engine_variant,
    PERCENTILE_CONT(0.5) WITHIN GROUP (
      ORDER BY f.consumption_l_per_100km
    ) AS median_l_per_100km,
    COUNT(DISTINCT ed.user_id)::int AS driver_count
  FROM eligible_drivers ed
  JOIN "FillUp" f ON f.user_id = ed.user_id
  JOIN "Vehicle" v ON v.id = f.vehicle_id
    AND v.make = ed.make
    AND v.model = ed.model
    AND v.engine_variant = ed.engine_variant
  WHERE f.consumption_l_per_100km IS NOT NULL
    AND f.filled_at >= NOW() - INTERVAL '90 days'
  GROUP BY ed.make, ed.model, ed.engine_variant
  HAVING COUNT(DISTINCT ed.user_id) >= 10
)
SELECT * FROM benchmarks;
```

Run as a single `$queryRaw` CTE. This approach handles the nested eligibility check without multiple round trips.

### ConsumptionBenchmarkDto

```ts
export interface ConsumptionBenchmarkDto {
  make: string;
  model: string;
  engineVariant: string;
  medianL100km: number;       // community median
  driverCount: number;        // anonymised count — show as "10+ drivers" up to actual
  calculatedAt: string;       // ISO datetime
  yourAvgL100km: number | null; // driver's own avg for this vehicle — computed on the fly
}
```

`yourAvgL100km` is computed in `getForVehicle()` from the driver's own FillUp records for that vehicle (avg of `consumption_l_per_100km` where not null, last 90 days, ≥1 segment). Returns null if driver has no consumption data yet.

### getForVehicle() implementation

```ts
async getForVehicle(
  vehicleId: string,
  userId: string,
): Promise<ConsumptionBenchmarkDto | null> {
  const vehicle = await this.prisma.vehicle.findUnique({
    where: { id: vehicleId },
    select: { make: true, model: true, engine_variant: true },
  });
  if (!vehicle?.engine_variant) return null;

  const benchmark = await this.prisma.consumptionBenchmark.findFirst({
    where: { make: vehicle.make, model: vehicle.model, engine_variant: vehicle.engine_variant },
    orderBy: { calculated_at: 'desc' },
  });
  if (!benchmark) return null;

  // Driver's own average
  const ownAvg = await this.prisma.fillUp.aggregate({
    where: {
      vehicle_id: vehicleId,
      user_id: userId,
      consumption_l_per_100km: { not: null },
      filled_at: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
    },
    _avg: { consumption_l_per_100km: true },
  });

  return {
    make: vehicle.make,
    model: vehicle.model,
    engineVariant: vehicle.engine_variant,
    medianL100km: benchmark.median_l_per_100km,
    driverCount: benchmark.driver_count,
    calculatedAt: benchmark.calculated_at.toISOString(),
    yourAvgL100km: ownAvg._avg.consumption_l_per_100km ?? null,
  };
}
```

### BenchmarkSection component

```tsx
function BenchmarkSection({ vehicleId, t }: { vehicleId: string; t: TFunction }) {
  const { accessToken } = useAuth();
  const [benchmark, setBenchmark] = useState<ConsumptionBenchmarkDto | null | 'loading'>('loading');

  useEffect(() => {
    if (!accessToken) return;
    apiGetVehicleBenchmark(accessToken, vehicleId)
      .then(setBenchmark)
      .catch(() => setBenchmark(null)); // network error → omit silently
  }, [vehicleId, accessToken]);

  if (benchmark === 'loading' || benchmark === null) return null; // AC2: omit entirely

  const yourAvg = benchmark.yourAvgL100km?.toFixed(1);
  const communityAvg = benchmark.medianL100km.toFixed(1);

  return (
    <View style={styles.benchmarkCard}>
      <Text style={styles.benchmarkLabel}>{t('benchmark.title')}</Text>
      <Text style={styles.benchmarkSubLabel}>{t('benchmark.subtitle')}</Text>
      <View style={styles.benchmarkRow}>
        {yourAvg && (
          <View style={styles.benchmarkStat}>
            <Text style={styles.benchmarkValue}>{yourAvg}</Text>
            <Text style={styles.benchmarkUnit}>L/100km</Text>
            <Text style={styles.benchmarkStatLabel}>{t('benchmark.yours')}</Text>
          </View>
        )}
        <View style={styles.benchmarkStat}>
          <Text style={styles.benchmarkValue}>{communityAvg}</Text>
          <Text style={styles.benchmarkUnit}>L/100km</Text>
          <Text style={styles.benchmarkStatLabel}>{t('benchmark.community')}</Text>
        </View>
      </View>
      <Text style={styles.benchmarkFooter}>
        {t('benchmark.driverCount', { count: benchmark.driverCount })}
      </Text>
    </View>
  );
}
```

Show `loading` state as nothing (not a spinner) — it resolves quickly and a spinner would be distracting for what may end up being an omitted section anyway.

### Driver count display

Never show the exact driver count if it's below 20 — show "10+ drivers" for counts 10–19 to further protect privacy. Above 20, show exact count. This is a minor privacy measure consistent with the anonymisation principle.

```ts
function formatDriverCount(count: number, t: TFunction): string {
  if (count < 20) return t('benchmark.driverCountMin'); // "10+ drivers"
  return t('benchmark.driverCountExact', { count });     // "47 drivers"
}
```

### i18n strings

Add `benchmark` section to all 3 locales:

```
title:            'Real-world consumption' | 'Rzeczywiste zużycie paliwa' | 'Реальна витрата палива'
subtitle:         'Based on community data — not manufacturer claims' | 'Na podstawie danych społeczności — nie danych producenta' | 'На основі даних спільноти — не заяв виробника'
yours:            'Your average' | 'Twoja średnia' | 'Ваша середня'
community:        'Community average' | 'Średnia społeczności' | 'Середня спільноти'
driverCountMin:   '10+ drivers' | '10+ kierowców' | '10+ водіїв'
driverCountExact: '{{count}} drivers' | '{{count}} kierowców' | '{{count}} водіїв'
```

### Note on data maturity

From the spec: *"Minimum viable dataset: ~500 drivers with consumption data across varied engine variants — expected to be available 3–6 months post Phase 2 launch."*

The feature is fully implemented but the benchmark section will be hidden for all vehicles at launch (no driver has data yet). It will gradually appear as the user base builds consumption history. No special launch flag is needed — the AC2 threshold naturally handles this.

### Project Structure Notes

- `packages/db/prisma/schema.prisma` (modified — ConsumptionBenchmark model)
- `packages/db/prisma/migrations/<timestamp>_add_consumption_benchmarks/migration.sql` (new)
- New directory: `apps/api/src/consumption-benchmark/`
  - `consumption-benchmark.service.ts` (new)
  - `consumption-benchmark.worker.ts` (new)
  - `consumption-benchmark.module.ts` (new)
  - `consumption-benchmark.service.spec.ts` (new)
- `apps/api/src/vehicle/vehicles.controller.ts` (modified — add GET /v1/me/vehicles/:id/benchmark)
- `apps/api/src/vehicle/vehicles.service.ts` or new injection — route handler calls `ConsumptionBenchmarkService.getForVehicle()`
- `apps/api/src/vehicle/vehicle.module.ts` (modified — import ConsumptionBenchmarkModule)
- `apps/api/src/app.module.ts` (modified — import ConsumptionBenchmarkModule)
- `apps/mobile/src/api/vehicles.ts` (modified — add `apiGetVehicleBenchmark`)
- `apps/mobile/app/(app)/log.tsx` (modified — replace TODO with BenchmarkSection)
- `apps/mobile/src/i18n/locales/en.ts` (modified)
- `apps/mobile/src/i18n/locales/pl.ts` (modified)
- `apps/mobile/src/i18n/locales/uk.ts` (modified)

### References

- RegionalBenchmarkWorker pattern (BullMQ daily job): [apps/api/src/regional-benchmark/regional-benchmark.worker.ts](apps/api/src/regional-benchmark/regional-benchmark.worker.ts) (Story 5.0)
- Vehicle model + engine_variant: [apps/api/src/vehicle/vehicles.service.ts](apps/api/src/vehicle/vehicles.service.ts) (Story 5.1)
- FillUp.consumption_l_per_100km: [apps/api/src/fillup/](apps/api/src/fillup/) (Stories 5.2, 5.4)
- Benchmark section placeholder: [apps/mobile/app/(app)/log.tsx](apps/mobile/app/(app)/log.tsx) (Story 5.5)
- Story epics spec: [_bmad-output/planning-artifacts/epics.md](_bmad-output/planning-artifacts/epics.md) — Story 5.6 (line ~2372)

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List

- `packages/db/prisma/schema.prisma` (modified — ConsumptionBenchmark model)
- `packages/db/prisma/migrations/<timestamp>_add_consumption_benchmarks/migration.sql` (new)
- `apps/api/src/consumption-benchmark/consumption-benchmark.service.ts` (new)
- `apps/api/src/consumption-benchmark/consumption-benchmark.worker.ts` (new)
- `apps/api/src/consumption-benchmark/consumption-benchmark.module.ts` (new)
- `apps/api/src/consumption-benchmark/consumption-benchmark.service.spec.ts` (new)
- `apps/api/src/vehicle/vehicles.controller.ts` (modified)
- `apps/api/src/vehicle/vehicle.module.ts` (modified)
- `apps/api/src/app.module.ts` (modified)
- `apps/mobile/src/api/vehicles.ts` (modified)
- `apps/mobile/app/(app)/log.tsx` (modified)
- `apps/mobile/src/i18n/locales/en.ts` (modified)
- `apps/mobile/src/i18n/locales/pl.ts` (modified)
- `apps/mobile/src/i18n/locales/uk.ts` (modified)
- `_bmad-output/implementation-artifacts/5-6-consumption-benchmarks-by-vehicle.md` (this file)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)
