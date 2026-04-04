# Story 2.11 — Price History & Regional Aggregations

**Status:** review
**Epic:** 2 — Station Map & Price Discovery
**Story ID:** 2.11
**Created:** 2026-03-28

---

## User Story

As a **developer**,
I want all price submissions retained in full and regional aggregations queryable from day one,
So that the platform builds a commercially valuable dataset from the very first contribution.

**Why:** The price history database is the long-term business asset — it's what makes B2B data licensing possible in Phase 3. Capturing it from day one means no data is ever lost. Regional aggregations (FR50) are also the foundation for the public data portal and fleet analytics in later phases.

---

## Acceptance Criteria

- **AC1 — History written on verification:** Given a price submission is verified (i.e., `setVerifiedPrice()` is called in `PriceService`), when prices are written, then one `PriceHistory` record per fuel type in `price_data` is inserted with `station_id`, `fuel_type`, `price`, `source` (community/seeded), and `recorded_at = NOW()`

- **AC2 — History query:** Given the price history table, when `GET /v1/prices/history?stationId=X&fuelType=Y` is queried (authenticated), then the full chronological history for that station + fuel type is returned, newest first, as `[{ price, source, recordedAt }]`

- **AC3 — Regional aggregation:** Given multiple verified price records across stations in a region, when `GET /v1/prices/regional?voivodeship=X&fuelType=Y` is queried (authenticated), then it returns the average of the most recent `PriceHistory` record per station in that voivodeship for that fuel type

- **AC4 — Performance:** Given the price history table at scale, when queried for a specific station + fuel type (last 30 days), then the query uses an index on `(station_id, fuel_type, recorded_at)` — no sequential scan

- **AC5 — Auth guard:** Both endpoints are auth-gated (`@UseGuards(JwtAuthGuard)`) — not `@Public()`

---

## Technical Architecture

### New Model: `PriceHistory`

```prisma
model PriceHistory {
  id          String      @id @default(uuid())
  station_id  String
  fuel_type   String      // 'PB_95' | 'PB_98' | 'ON' | 'ON_PREMIUM' | 'LPG'
  price       Float       // PLN/litre
  source      PriceSource // community | seeded
  recorded_at DateTime    @default(now())
  station     Station     @relation(fields: [station_id], references: [id], onDelete: Cascade)

  @@index([station_id, fuel_type, recorded_at(sort: Desc)])
}
```

Add `priceHistory PriceHistory[]` relation to `Station` model.

### Where History Is Written

**Hook point:** `PriceService.setVerifiedPrice()` (`apps/api/src/price/price.service.ts` line ~77).

The method receives a `StationPriceRow` containing `stationId`, `prices` (map of fuelType → number), and `sources` (map of fuelType → 'community'|'seeded'). Insert one `PriceHistory` row per fuel type entry in `prices`:

```typescript
async setVerifiedPrice(stationId: string, data: StationPriceRow): Promise<void> {
  // 1. Write to price history (new)
  await this.prisma.priceHistory.createMany({
    data: Object.entries(data.prices).map(([fuelType, price]) => ({
      station_id: stationId,
      fuel_type: fuelType,
      price,
      source: (data.sources[fuelType] ?? 'community') as PriceSource,
    })),
  });
  // 2. Existing: atomic cache invalidation + rewrite (unchanged)
  await this.priceCache.setAtomic(stationId, data);
}
```

### Endpoints

Both added to `PriceController` (`apps/api/src/price/price.controller.ts`):

**GET /v1/prices/history**
```
Query params: stationId (string, required), fuelType (string, required)
Auth: JwtAuthGuard (not Public)
Response: { history: Array<{ price: number, source: string, recordedAt: string }> }
```

**GET /v1/prices/regional**
```
Query params: voivodeship (string, required), fuelType (string, required)
Auth: JwtAuthGuard (not Public)
Response: { voivodeship: string, fuelType: string, averagePrice: number | null, stationCount: number }
```

### Regional Aggregation Query

Takes the most recent `PriceHistory` record per station in the voivodeship, then averages:

```sql
SELECT AVG(ph.price)::float AS avg_price, COUNT(DISTINCT ph.station_id)::int AS station_count
FROM (
  SELECT DISTINCT ON (ph.station_id) ph.station_id, ph.price
  FROM "PriceHistory" ph
  JOIN "Station" s ON s.id = ph.station_id
  WHERE s.voivodeship = $1
    AND ph.fuel_type = $2
  ORDER BY ph.station_id, ph.recorded_at DESC
) ph
```

Use `$queryRaw` with `Prisma.sql` for this — same pattern as `findStationsInArea`.

### Service Layer

Add `PriceHistoryService` (`apps/api/src/price/price-history.service.ts`) with:
- `recordPrices(stationId, data: StationPriceRow): Promise<void>` — writes via `createMany`
- `getHistory(stationId, fuelType): Promise<HistoryEntry[]>` — ordered by `recorded_at DESC`
- `getRegionalAverage(voivodeship, fuelType): Promise<{ averagePrice: number | null; stationCount: number }>`

Inject `PriceHistoryService` into `PriceService`. Remove direct `createMany` from `PriceService.setVerifiedPrice()` — call `this.priceHistory.recordPrices()` instead.

Register `PriceHistoryService` in `PriceModule`.

---

## File List

**New:**
- `packages/db/prisma/migrations/20260328000000_add_price_history/migration.sql` — CREATE TABLE + index
- `apps/api/src/price/price-history.service.ts` — `PriceHistoryService` with `recordPrices`, `getHistory`, `getRegionalAverage`
- `apps/api/src/price/price-history.service.spec.ts` — unit tests

**Modified:**
- `packages/db/prisma/schema.prisma` — add `PriceHistory` model + `Station.priceHistory` relation
- `apps/api/src/price/price.service.ts` — `setVerifiedPrice()` calls `priceHistory.recordPrices()`
- `apps/api/src/price/price.controller.ts` — add `GET /history` and `GET /regional` endpoints
- `apps/api/src/price/price.module.ts` — register `PriceHistoryService`

---

## Dev Guardrails

### Pattern Rules (from prior stories)

- **Prisma migration naming:** `20260328000000_add_price_history` — timestamp format `YYYYMMDDHHmmss`
- **`$queryRaw` for aggregations:** Use `Prisma.sql` tagged template with `$queryRaw<[{ avg_price: number | null; station_count: number }]>` — not raw string interpolation
- **`createMany` is fire-once:** No upsert needed — each call to `setVerifiedPrice()` intentionally creates new history rows; duplicates are valid history
- **`onDelete: Cascade`** — same pattern as `StationFuelStaleness`. If a station is deleted, its history goes too
- **Auth pattern:** All endpoints in this story require `@UseGuards(JwtAuthGuard)`. Do NOT use `@Public()` — price data is not publicly queryable via API
- **No Redis caching for history:** History reads are infrequent and bounded; don't add cache complexity here

### Schema Migration SQL Template

```sql
CREATE TABLE "PriceHistory" (
  "id"          TEXT        NOT NULL,
  "station_id"  TEXT        NOT NULL,
  "fuel_type"   TEXT        NOT NULL,
  "price"       DOUBLE PRECISION NOT NULL,
  "source"      "PriceSource" NOT NULL,
  "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PriceHistory_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PriceHistory"
  ADD CONSTRAINT "PriceHistory_station_id_fkey"
  FOREIGN KEY ("station_id") REFERENCES "Station"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "PriceHistory_station_id_fuel_type_recorded_at_idx"
  ON "PriceHistory"("station_id", "fuel_type", "recorded_at" DESC);
```

### DTO / Response Types

```typescript
// GET /v1/prices/history response
interface HistoryEntry { price: number; source: 'community' | 'seeded'; recordedAt: string; }
interface PriceHistoryResponseDto { history: HistoryEntry[]; }

// GET /v1/prices/regional response
interface RegionalAverageResponseDto {
  voivodeship: string;
  fuelType: string;
  averagePrice: number | null; // null if no data
  stationCount: number;
}
```

### Testing Requirements

- `price-history.service.spec.ts`:
  - `recordPrices` — verify `createMany` called with correct rows per fuel type
  - `getHistory` — verify ordered by `recorded_at DESC`
  - `getRegionalAverage` — verify returns `null` averagePrice when no stations have data in voivodeship
  - `getRegionalAverage` — verify correct station_count (not duplicate-counting from multiple history records per station)

- Mock `PrismaService` using the pattern from prior stories (look at `2-8-price-staleness-auto-detection.md` or `2-9-redis-price-cache.md` spec for the mock pattern used)

### Prior Art: `setVerifiedPrice` Is Currently Called Where?

`setVerifiedPrice` in `PriceService` is the OCR verification pipeline hook — currently only called by tests and the staleness detection worker. When you add `priceHistory.recordPrices()` inside it, it will automatically capture history when the OCR pipeline calls it in the future. No other callers to update.

---

## Dev Agent Record

### Completion Notes

- `PriceHistory` model added to schema with compound index `(station_id, fuel_type, recorded_at DESC)` for efficient per-station/fuel-type queries
- `PrismaService.priceHistory` available after `prisma generate` — migration SQL written manually (same pattern as prior stories)
- `PriceHistoryService.recordPrices()` uses `createMany` — each call appends new rows intentionally; history is append-only, no upsert
- `getRegionalAverage` uses `$queryRaw` with `DISTINCT ON station_id` subquery to avoid double-counting stations with multiple history records, then `AVG` over the latest-per-station prices
- `JwtAuthGuard` is a global `APP_GUARD` — new endpoints are auth-protected by default; `@Public()` intentionally not added
- `stationCount` from raw query cast with `Number()` — Postgres returns `bigint` for `COUNT`, which Jest receives as a string via the mock; `Number()` handles both
- `PriceService.setVerifiedPrice()` now calls `recordPrices` before `setAtomic` — history is written first so it's captured even if cache write fails
- 397/397 tests passing, tsc clean

### File List

**New:**
- `packages/db/prisma/migrations/20260328000000_add_price_history/migration.sql`
- `apps/api/src/price/price-history.service.ts`
- `apps/api/src/price/price-history.service.spec.ts`
- `apps/api/src/price/dto/get-price-history.dto.ts`
- `apps/api/src/price/dto/get-regional-average.dto.ts`

**Modified:**
- `packages/db/prisma/schema.prisma` — added `PriceHistory` model, `Station.priceHistory` relation
- `apps/api/src/price/price.service.ts` — inject `PriceHistoryService`, call `recordPrices` in `setVerifiedPrice`
- `apps/api/src/price/price.service.spec.ts` — add `mockPriceHistory`, update `setVerifiedPrice` tests
- `apps/api/src/price/price.controller.ts` — add `GET /history` and `GET /regional` endpoints
- `apps/api/src/price/price.controller.spec.ts` — add `mockPriceHistoryService`, tests for new endpoints
- `apps/api/src/price/price.module.ts` — register `PriceHistoryService`

### Change Log

- 2026-03-28: Story created
- 2026-03-28: Implemented — schema, migration, service, controller endpoints, tests (397/397 passing)
- 2026-03-28: Code review patches applied — P1 (getHistory take limit + optional param), P2 (fuelType @IsIn validation + @IsUUID on stationId), P3 (recordPrices best-effort try/catch), P4 (merged into P2); D2 fixed ($queryRaw tuple type corrected); D3 fixed (Station.voivodeship index added to migration + schema); D1 logged (Float vs Decimal — codebase-wide, deferred); 400/400 passing, tsc clean

### Deferred

- **D1 — `price` stored as Float (IEEE 754) instead of Decimal:** Floating-point accumulation errors in AVG(). Consistent with rest of codebase (MarketSignal.value, submission price_data all use Float). Requires a wider migration to change. Pre-existing issue, not caused by this story.


## Review Notes (2026-04-04)

No new patches. Prior review applied all patches — see sprint-status.yaml for details.
