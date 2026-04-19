# Story 11.1: Station Picker — Recommendation Engine & API

## Metadata
- **Epic:** 11 — Station Picker
- **Story ID:** 11.1
- **Status:** ready-for-dev
- **Date:** 2026-04-08
- **Depends on:** Story 2.2 (StationController, `GET /v1/stations/nearby`, PostGIS patterns), Story 2.3 (PriceHistory populated), Story 1.5 (JwtAuthGuard, `@Public()` decorator)
- **Required by:** Story 11.2 (mobile UI calls `POST /v1/stations/recommend`)

---

## User Story

**As a driver,**
I want the app to recommend the best two nearby fuel stations for my chosen fuel type,
So that I can make a quick, confident choice without manually comparing multiple stations.

---

## Context & Why

The map gives drivers a spatial overview of all nearby pins, but choosing the best station still requires manually comparing price, distance, and data freshness. FR72–FR75 define a "Pick for me" feature that automates this comparison with a disclosed, transparent algorithm.

This story builds the recommendation engine backend: a single `POST /v1/stations/recommend` endpoint that accepts the driver's location and desired fuel type, scores all candidate stations across four weighted factors (price 40%, distance 30%, freshness 20%, active deals 10%), and returns the top two with full score breakdowns. The algorithm weights are returned in the response itself — satisfying FR73's requirement that the ranking factors be disclosed to the user.

The endpoint is `@Public()` — guest users should be able to use the station picker without an account, consistent with the product principle of letting users explore value before registering.

### Algorithm Design Rationale

The four factors and their weights were chosen to reflect what drivers actually care about:

- **Price (40%):** The primary reason to choose one station over another. Normalised within the result set so relative differences are meaningful regardless of absolute price level.
- **Distance (30%):** The second most important factor — a marginally cheaper station 5 km away may not be worth the extra fuel. Normalised against the furthest candidate in the result set.
- **Freshness (20%):** A price that was submitted 4 days ago is much less reliable than one submitted 2 hours ago. Three tiers: ≤24h = full score, ≤72h = half score, older = zero.
- **Active deals (10%):** A deal promotion (loyalty points, discount voucher, etc.) can meaningfully change effective cost. Capped at 10% so it cannot override a much closer or cheaper station.

Scoring is done in TypeScript (not SQL) for auditability and to keep the raw query simple. The `score_breakdown` returned per recommendation makes each factor contribution visible, supporting future UI transparency features.

### Deal Model Handling

As of this story, the `Deal` (or equivalent) model from Epic 8 may not be in the schema. The service handles this gracefully: if the deal table does not exist or the query fails, the deal bonus defaults to 0 and `has_active_deal` to `false`. This allows Epic 11 to ship independently of Epic 8's schedule.

---

## Acceptance Criteria

**Given** a driver sends `POST /v1/stations/recommend` with valid `lat`, `lng`, and `fuel_type`
**When** stations with price data exist within `radius_km`
**Then** the response contains up to 2 `recommendations` ranked by score descending, each with a `score_breakdown` showing all four component scores

**Given** a recommendation is returned
**When** the response is serialised
**Then** the `algorithm` field is always present with `weights: { price: '40%', distance: '30%', freshness: '20%', deals: '10%' }` and a human-readable `description`

**Given** a station does not have a `PriceHistory` record for the requested `fuel_type`
**When** candidates are evaluated
**Then** that station is excluded from the result set entirely — it never appears in `recommendations`

**Given** a station has an active `Deal` record where `status = 'ACTIVE'` and `NOW()` falls within `active_from` and `active_until`
**When** that station is scored
**Then** `has_active_deal: true`, `deal_bonus: 10` in `score_breakdown`, and `active_deal.headline` is populated

**Given** all candidate stations have identical prices for the requested fuel type
**When** the price score is computed
**Then** all stations receive `price_score: 20` (not 0) — the equal-price guard fires

**Given** `radius_km` is not provided in the request
**When** the search executes
**Then** the default radius of 5 km is used

**Given** `radius_km` is provided as 25 (exceeding maximum)
**When** the DTO is validated
**Then** the API returns HTTP 400

**Given** no stations with price data for the requested fuel type exist within the search radius
**When** the endpoint is called
**Then** the response is `{ recommendations: [], algorithm: { ... }, searched_at: "..." }` — HTTP 200, not an error

**Given** the endpoint is called without any `Authorization` header
**When** the request is processed
**Then** HTTP 200 is returned — the endpoint is `@Public()` and requires no authentication

---

## Technical Specification

### RecommendRequestDto

**File:** `apps/api/src/station/dto/recommend-request.dto.ts` (new)

```typescript
import { IsEnum, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export enum FuelType {
  PB_95      = 'PB_95',
  PB_98      = 'PB_98',
  ON         = 'ON',
  ON_PREMIUM = 'ON_PREMIUM',
  LPG        = 'LPG',
}

export class RecommendRequestDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  @Type(() => Number)
  lat!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  @Type(() => Number)
  lng!: number;

  @IsEnum(FuelType)
  fuel_type!: FuelType;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(20)
  @Type(() => Number)
  radius_km?: number;
}
```

### RecommendationResult and AlgorithmExplanation interfaces

**File:** `apps/api/src/station/recommendation.types.ts` (new)

```typescript
export interface ScoreBreakdown {
  price_score:     number;  // 0–40
  distance_score:  number;  // 0–30
  freshness_score: number;  // 0 | 10 | 20
  deal_bonus:      number;  // 0 | 10
}

export interface ActiveDealInfo {
  headline:    string;
  conditions?: string;
}

export interface RecommendationResult {
  station_id:        string;
  station_name:      string;
  address:           string | null;
  lat:               number;
  lng:               number;
  fuel_type:         string;
  price_pln:         number;    // maps from PriceHistory.price
  price_recorded_at: string;    // ISO 8601
  freshness:         'fresh' | 'stale' | 'unknown';
  distance_m:        number;
  score:             number;    // 0–100, sum of breakdown components
  score_breakdown:   ScoreBreakdown;
  has_active_deal:   boolean;   // FR74: drives UI label
  active_deal?:      ActiveDealInfo;
}

export interface AlgorithmExplanation {
  weights: {
    price:     '40%';
    distance:  '30%';
    freshness: '20%';
    deals:     '10%';
  };
  description: string;
}

export interface RecommendResponse {
  recommendations: RecommendationResult[];
  algorithm:       AlgorithmExplanation;
  searched_at:     string;  // ISO 8601
}
```

### RecommendationService

**File:** `apps/api/src/station/recommendation.service.ts` (new)

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  RecommendationResult,
  RecommendResponse,
  AlgorithmExplanation,
  ScoreBreakdown,
} from './recommendation.types';
import { RecommendRequestDto } from './dto/recommend-request.dto';

const DEFAULT_RADIUS_KM = 5;
const TOP_N = 2;

const ALGORITHM_EXPLANATION: AlgorithmExplanation = {
  weights: {
    price:     '40%',
    distance:  '30%',
    freshness: '20%',
    deals:     '10%',
  },
  description:
    'Stations are ranked by a composite score: price accounts for 40% ' +
    '(lower is better, normalised within results), distance 30% ' +
    '(closer is better, normalised within results), data freshness 20% ' +
    '(prices reported within 24 h score highest), and active deal promotions 10%. ' +
    'Score is out of 100.',
};

interface RawStationRow {
  station_id:  string;
  name:        string;
  address:     string | null;
  lat:         number;
  lng:         number;
  price:       number;
  recorded_at: Date;
  distance_m:  number;
}

@Injectable()
export class RecommendationService {
  private readonly logger = new Logger(RecommendationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getRecommendations(dto: RecommendRequestDto): Promise<RecommendResponse> {
    const radiusM = (dto.radius_km ?? DEFAULT_RADIUS_KM) * 1000;
    const { lat, lng, fuel_type } = dto;

    // ── 1. Fetch candidate stations with their latest price ─────────────────
    // Uses DISTINCT ON to get the most recent PriceHistory row per station.
    // Distance is computed via PostGIS geography cast for accuracy in metres.
    const rows = await this.prisma.$queryRaw<RawStationRow[]>`
      SELECT
        s.id                                                          AS station_id,
        s.name,
        s.address,
        ST_Y(s.location::geometry)                                    AS lat,
        ST_X(s.location::geometry)                                    AS lng,
        ph.price,
        ph.recorded_at,
        ST_Distance(
          s.location::geography,
          ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
        )                                                             AS distance_m
      FROM "Station" s
      JOIN LATERAL (
        SELECT price, recorded_at
        FROM   "PriceHistory"
        WHERE  station_id = s.id
          AND  fuel_type  = ${fuel_type}
        ORDER  BY recorded_at DESC
        LIMIT  1
      ) ph ON TRUE
      WHERE s.location IS NOT NULL
        AND ST_DWithin(
          s.location,
          ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
          ${radiusM}
        )
      ORDER BY distance_m ASC
    `;

    if (rows.length === 0) {
      return {
        recommendations: [],
        algorithm:       ALGORITHM_EXPLANATION,
        searched_at:     new Date().toISOString(),
      };
    }

    // ── 2. Fetch active deals for candidate stations (Epic 8 may not be shipped) ──
    const dealMap = await this.fetchActiveDeals(rows.map((r) => r.station_id));

    // ── 3. Compute normalisation bounds ─────────────────────────────────────
    const prices    = rows.map((r) => Number(r.price));
    const distances = rows.map((r) => Number(r.distance_m));

    const minPrice    = Math.min(...prices);
    const maxPrice    = Math.max(...prices);
    const maxDistance = Math.max(...distances);
    const priceRange  = maxPrice - minPrice;

    // ── 4. Score each station ────────────────────────────────────────────────
    const scored = rows.map((row) => {
      const price      = Number(row.price);
      const distanceM  = Number(row.distance_m);
      const recordedAt = new Date(row.recorded_at);

      // Price score (40 pts): lower price → higher score
      const priceScore: number =
        priceRange === 0
          ? 20  // all prices identical — all stations score equally
          : ((maxPrice - price) / priceRange) * 40;

      // Distance score (30 pts): closer → higher score
      const distanceScore: number =
        maxDistance === 0
          ? 30  // all stations at same distance (single result edge-case)
          : (1 - distanceM / maxDistance) * 30;

      // Freshness score (20 pts)
      const ageMs           = Date.now() - recordedAt.getTime();
      const ageHours        = ageMs / (1000 * 60 * 60);
      const freshnessScore: number =
        ageHours <= 24  ? 20 :
        ageHours <= 72  ? 10 : 0;

      const freshness: 'fresh' | 'stale' | 'unknown' =
        ageHours <= 24  ? 'fresh' :
        ageHours <= 72  ? 'stale' : 'unknown';

      // Deal bonus (10 pts)
      const deal       = dealMap.get(row.station_id) ?? null;
      const dealBonus  = deal ? 10 : 0;

      const breakdown: ScoreBreakdown = {
        price_score:     Math.round(priceScore * 10) / 10,
        distance_score:  Math.round(distanceScore * 10) / 10,
        freshness_score: freshnessScore,
        deal_bonus:      dealBonus,
      };

      const score = Math.round(
        breakdown.price_score +
        breakdown.distance_score +
        breakdown.freshness_score +
        breakdown.deal_bonus,
      );

      const result: RecommendationResult = {
        station_id:        row.station_id,
        station_name:      row.name,
        address:           row.address,
        lat:               Number(row.lat),
        lng:               Number(row.lng),
        fuel_type,
        price_pln:         price,
        price_recorded_at: recordedAt.toISOString(),
        freshness,
        distance_m:        Math.round(distanceM),
        score,
        score_breakdown:   breakdown,
        has_active_deal:   deal !== null,
        ...(deal ? { active_deal: { headline: deal.headline, conditions: deal.conditions ?? undefined } } : {}),
      };

      return result;
    });

    // ── 5. Sort by score descending, return top N ────────────────────────────
    const recommendations = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_N);

    return {
      recommendations,
      algorithm:   ALGORITHM_EXPLANATION,
      searched_at: new Date().toISOString(),
    };
  }

  // ── Deal lookup (graceful degradation if Epic 8 not shipped) ──────────────
  private async fetchActiveDeals(
    stationIds: string[],
  ): Promise<Map<string, { headline: string; conditions: string | null }>> {
    const result = new Map<string, { headline: string; conditions: string | null }>();
    if (stationIds.length === 0) return result;

    try {
      // Use raw SQL so this compiles even if the Deal model is not in the Prisma client yet.
      // If the "Deal" table doesn't exist, the query throws and we return an empty map.
      const deals = await this.prisma.$queryRaw<
        { station_id: string; headline: string; conditions: string | null }[]
      >`
        SELECT station_id, headline, conditions
        FROM   "Deal"
        WHERE  station_id = ANY(${stationIds}::text[])
          AND  status     = 'ACTIVE'
          AND  active_from <= NOW()
          AND  active_until >= NOW()
        ORDER  BY active_from DESC
      `;

      // One deal per station — first (most recent) wins
      for (const deal of deals) {
        if (!result.has(deal.station_id)) {
          result.set(deal.station_id, {
            headline:   deal.headline,
            conditions: deal.conditions,
          });
        }
      }
    } catch (err) {
      // Epic 8 not shipped yet — deal table may not exist. Silently return empty map.
      this.logger.debug(
        'Deal lookup skipped (table may not exist yet): ' + String(err),
      );
    }

    return result;
  }
}
```

### StationController — new endpoint

**File:** `apps/api/src/station/station.controller.ts` (modify existing)

Add the following import and method to `StationController`:

```typescript
import { Body, Post } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { RecommendationService } from './recommendation.service';
import { RecommendRequestDto } from './dto/recommend-request.dto';

// In constructor, inject RecommendationService:
constructor(
  private readonly stationService: StationService,
  private readonly recommendationService: RecommendationService,
) {}

/**
 * POST /v1/stations/recommend
 * Returns top 2 station recommendations ranked by composite score.
 * FR72, FR73, FR74: disclosed algorithm + deal labels.
 * @Public() — guest users can use the picker without auth.
 */
@Post('recommend')
@Public()
async recommend(@Body() dto: RecommendRequestDto) {
  return this.recommendationService.getRecommendations(dto);
}
```

### StationModule — register RecommendationService

**File:** `apps/api/src/station/station.module.ts` (modify existing)

```typescript
import { RecommendationService } from './recommendation.service';

@Module({
  ...
  providers: [StationService, RecommendationService],
  ...
})
export class StationModule {}
```

---

## Migration

No migration required. This story adds no new database models or columns. The `PriceHistory` and `Station` models used by the query already exist. The `Deal` table query in `fetchActiveDeals` is guarded by a `try/catch` — absence of that table is handled gracefully at runtime.

---

## Tasks / Subtasks

- [ ] API: `RecommendRequestDto` with class-validator — lat/lng range, `@IsEnum(FuelType)`, optional `radius_km` 1–20 (AC: 6, 7)
  - [ ] File: `apps/api/src/station/dto/recommend-request.dto.ts`

- [ ] API: `recommendation.types.ts` — `RecommendationResult`, `AlgorithmExplanation`, `RecommendResponse`, `ScoreBreakdown` interfaces (AC: 1, 2, 3, 4)
  - [ ] File: `apps/api/src/station/recommendation.types.ts`

- [ ] API: `RecommendationService.getRecommendations()` — spatial + LATERAL price query, scoring, top-2 sort (AC: 1, 3, 4, 5, 8)
  - [ ] PostGIS `ST_DWithin` + `LATERAL` join for latest price per station
  - [ ] Normalised price score with equal-price guard (`priceRange === 0` → score 20)
  - [ ] Normalised distance score
  - [ ] Three-tier freshness score (≤24h = 20, ≤72h = 10, older = 0)
  - [ ] `fetchActiveDeals()` with `try/catch` — graceful degradation if Deal table absent
  - [ ] Sort by total score DESC, slice top 2
  - [ ] Return empty `recommendations: []` when no candidates found (AC: 8)
  - [ ] File: `apps/api/src/station/recommendation.service.ts`

- [ ] API: `StationController` — add `POST /v1/stations/recommend` with `@Public()` (AC: 9)
  - [ ] Inject `RecommendationService` in constructor
  - [ ] `@Body()` validated via global `ValidationPipe`

- [ ] API: `StationModule` — add `RecommendationService` to providers (AC: 1)

- [ ] API: Unit tests (AC: 1–9)
  - [ ] `recommendation.service.spec.ts`:
    - Returns top 2 sorted by score
    - Excludes stations with no price data (LATERAL join naturally handles this — test with mock returning rows)
    - Equal-price guard sets all `price_score` to 20
    - `freshness: 'fresh'` for price within 24h; `'stale'` within 72h; `'unknown'` older
    - `has_active_deal: true` when `fetchActiveDeals` returns a deal for that station
    - Empty `recommendations: []` when `$queryRaw` returns `[]`
    - Deal fetch failure is caught silently — no throw propagates
  - [ ] `station.controller.spec.ts` — extend existing:
    - `POST /v1/stations/recommend` 200 with `recommendations` array
    - 400 on missing `fuel_type`
    - 400 on `radius_km: 25`
    - No auth guard on this route (`@Public()`)

---

## Dev Notes

### LATERAL Join vs DISTINCT ON

The query uses `JOIN LATERAL` to fetch the single most recent `PriceHistory` row per station for the requested `fuel_type`. This is preferred over `DISTINCT ON` here because the filter is per-station (not a global distinct across the result), and LATERAL compiles to an index scan on the `(station_id, fuel_type, recorded_at DESC)` index defined in the schema. Stations with no price for the requested fuel type are naturally excluded because the LATERAL subquery returns no row and `JOIN ... ON TRUE` drops those stations.

### PostGIS Distance Function

```sql
ST_Distance(
  s.location::geography,
  ST_SetSRID(ST_MakePoint($lng, $lat), 4326)::geography
) AS distance_m
```

`ST_MakePoint` takes `(longitude, latitude)` — note the order. Casting both sides to `geography` returns the distance in metres on the Earth's surface (not planar degrees). The `ST_DWithin` filter in the `WHERE` clause uses the same geography cast for consistency.

### Score Rounding

`price_score` and `distance_score` are stored with one decimal place (e.g. `23.4`) to preserve precision in the breakdown. The top-level `score` is rounded to the nearest integer for display. The scoring arithmetic uses floating-point division — no integer truncation before final rounding.

### FuelType Enum Location

The `FuelType` enum is defined in `RecommendRequestDto`'s file for now. If a shared `FuelType` enum already exists in the codebase (e.g. from Story 10.3's `LatestPricesQueryDto`), import from that shared location instead of redeclaring. The string values must match `PriceHistory.fuel_type` in the database (`'PB_95'`, `'PB_98'`, `'ON'`, `'ON_PREMIUM'`, `'LPG'`).

### Deal Model Name

The `fetchActiveDeals` method queries a table named `"Deal"`. If Epic 8 shipped with a different model name (e.g. `"Promotion"`, `"StationDeal"`), update the table name in the raw SQL. The `try/catch` means a wrong table name will silently return no deals rather than crashing the endpoint — safe for incremental deployment.

### `$queryRaw` Type Safety

The raw query returns PostgreSQL numeric types as JavaScript `number` for `FLOAT`/`DOUBLE PRECISION` columns when using Prisma's `$queryRaw`. However, `bigint` columns (e.g. `COUNT(*)`) come back as `BigInt`. This query has no aggregations so all numeric columns are safe to cast with `Number(row.price)` etc. If Prisma returns string representations of floats (observed in some Prisma versions with certain PostgreSQL drivers), wrap all numeric fields: `parseFloat(String(row.price))`.

### No New Environment Variables

This story introduces no new env vars. It uses the existing `DATABASE_URL` via `PrismaService`.

---

## Dev Agent Record

### Agent Model Used

_to be filled by implementing agent_

### Debug Log References

_to be filled by implementing agent_

### Completion Notes List

_to be filled by implementing agent_

### File List

**Backend (new):**
- `apps/api/src/station/dto/recommend-request.dto.ts`
- `apps/api/src/station/recommendation.types.ts`
- `apps/api/src/station/recommendation.service.ts`
- `apps/api/src/station/recommendation.service.spec.ts`

**Backend (modified):**
- `apps/api/src/station/station.controller.ts`
- `apps/api/src/station/station.controller.spec.ts`
- `apps/api/src/station/station.module.ts`

**Artifacts:**
- `_bmad-output/implementation-artifacts/11-1-station-picker-algorithm.md`

### Change Log

_to be filled by implementing agent_
