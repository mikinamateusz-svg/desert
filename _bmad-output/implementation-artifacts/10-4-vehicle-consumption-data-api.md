# Story 10.4: Vehicle Consumption Data API

## Metadata
- **Epic:** 10 — Data Licensing & Public Portal
- **Story ID:** 10.4
- **Status:** ready-for-dev
- **Date:** 2026-04-08
- **Depends on:** Story 10.3 (DataApiKeyGuard, DataApiModule, DataApiKey model, `req.dataBuyerTier`), Story 10.2 (DataBuyerProfile, DataTier enum), Story 9.3 (FillUp.fleet_id denormalisation, Fleet model), Story 5.2 (FillUp model — `filled_at`, `litres`, `price_per_litre_pln`, `odometer_km`), Story 9.1 (Fleet model, fleet Vehicle model), Story 5.1 (personal Vehicle model — `make`, `model`, `year`)
- **Required by:** None (Story 10.4 is the final data API story in Epic 10)

---

## User Story

**As an approved data buyer with CONSUMPTION_DATA or FULL_ACCESS tier,**
I want to query anonymised vehicle fill-up and consumption data via a REST API,
So that I can build fleet efficiency benchmarks, route planning tools, and real-world fuel consumption datasets for Polish vehicles.

---

## Context & Why

The PRICE_DATA tier (Story 10.3) exposes station-level pricing data. This story adds the CONSUMPTION_DATA tier: anonymised, fleet-sourced fill-up records that reveal real-world vehicle consumption in Polish driving conditions. Fleet operators opt in to sharing their data under a consent flag (`Fleet.shares_consumption_data`). When opted in, their fill-up records become available to data buyers — with all identifying fields stripped.

### Consent Model & Anonymisation

Fleet participation is strictly opt-in. A new `Fleet.shares_consumption_data Boolean @default(false)` flag controls inclusion. The opt-in UI and consent flow are deferred to a future story (post-MVP). For MVP, ops sets the flag manually via Prisma Studio or admin SQL. No records from non-consenting fleets ever appear in any response, at any tier.

Anonymisation removes all identifying information:
- No `fleet_id`, `vehicle_id`, `user_id`, or `driver_id` in any response field
- No vehicle registration plate
- Vehicle identity is reduced to: fuel type, make/model/year (where available — fleet vehicles may omit these)
- Station identity is retained (station_id, name, location) — stations are public entities, not private actors

The `sample_fleet_count` field in aggregated responses uses `COUNT(DISTINCT fu.fleet_id)` internally to show data breadth, but the fleet IDs themselves are never returned.

### Guard Reuse — Tier Enforcement Pattern

`DataApiKeyGuard` (Story 10.3) authenticates API keys and attaches `req.dataBuyerTier` to the request. This story's controller imports `DataApiKeyGuard` from `DataApiModule` (already exported) and adds a tier check at the start of every handler:

```typescript
if (req.dataBuyerTier !== 'CONSUMPTION_DATA' && req.dataBuyerTier !== 'FULL_ACCESS') {
  throw new ForbiddenException('This endpoint requires CONSUMPTION_DATA or FULL_ACCESS tier');
}
```

`PRICE_DATA` buyers get HTTP 403 on all consumption endpoints. The guard itself does not enforce tier — it only authenticates and attaches context. This mirrors the documented pattern in Story 10.3's Dev Notes.

### Vehicle Schema Note

There are two distinct Vehicle models in this codebase:

1. **Personal vehicle** (Story 5.1): `make`, `model`, `year`, `fuel_type` — belongs to a `User`. Fill-ups from personal vehicles have these fields available.
2. **Fleet vehicle** (Story 9.1): `name`, `registration`, `fuel_type?` — belongs to a `Fleet`. No `make`, `model`, or `year` fields. Fleet fill-ups route through these vehicles.

Because `Fleet.shares_consumption_data` applies to fleet operators, the fill-ups this API exposes come primarily from fleet vehicles. Consequently, `vehicle_brand`, `vehicle_model`, and `vehicle_year` will be `null` for most records at launch. These fields are included in the schema for forward compatibility (future stories may add make/model/year to fleet vehicles). The `vehicle_fuel_type` field is available on fleet vehicles when set.

### FillUp Field Names (confirmed from schema)

- `filled_at` — DateTime (confirmed — not `created_at`)
- `litres` — Float (not `volume_litres` — mapped to `volume_litres` in the response for buyer-friendly naming)
- `price_per_litre_pln` — Float (mapped to `price_per_litre` in response)
- `total_cost_pln` — Float
- `odometer_km` — Int? (nullable until Story 5.4 OCR path populates it)
- `fleet_id` — String? (denormalised — set when fill-up was made by a fleet driver; added in Story 9.3)
- `vehicle_id` — String

---

## Acceptance Criteria

**Given** migration `add_fleet_consumption_sharing` has been run
**When** a Fleet record is created or already exists
**Then** it has a `shares_consumption_data` field that defaults to `false`

**Given** a data buyer sends `Authorization: Bearer ddk_...` with tier `PRICE_DATA`
**When** they call any `/v1/data-api/consumption/*` endpoint
**Then** the API returns HTTP 403 with body `{ "message": "This endpoint requires CONSUMPTION_DATA or FULL_ACCESS tier", "statusCode": 403 }`

**Given** a data buyer with tier `CONSUMPTION_DATA` calls `GET /v1/data-api/consumption/fill-ups`
**When** no fleets have `shares_consumption_data = true`
**Then** the response is `{ "data": [], "meta": { "total": 0, ... } }` — not an error

**Given** a data buyer with tier `CONSUMPTION_DATA` calls `GET /v1/data-api/consumption/fill-ups`
**When** fleets with `shares_consumption_data = true` have fill-up records
**Then** the response contains anonymised records — no `fleet_id`, `vehicle_id`, `user_id`, or registration plate

**Given** a data buyer calls `GET /v1/data-api/consumption/fill-ups` with a date range exceeding 90 days
**Then** the API returns HTTP 400 with a message indicating the 90-day maximum

**Given** a data buyer calls `GET /v1/data-api/consumption/fill-ups` with valid filters
**Then** only records from consenting fleets (`fleet.shares_consumption_data = true`) are returned, respecting all query filters

**Given** a data buyer calls `GET /v1/data-api/consumption/aggregated` with `fuel_type` required
**When** valid `granularity` (day|week|month) and date range (≤365 days) are provided
**Then** the response contains time-bucketed rows with `avg_efficiency_l_per_100km`, `avg_price_per_litre`, `total_volume_litres`, `fill_up_count`, and `sample_fleet_count`

**Given** a data buyer calls `GET /v1/data-api/consumption/aggregated` with a date range exceeding 365 days
**Then** the API returns HTTP 400 indicating the 365-day maximum

**Given** a data buyer calls `GET /v1/data-api/consumption/stations`
**When** filters are applied
**Then** only stations with at least one fill-up from a consenting fleet are returned, with per-station statistics

**Given** any consumption endpoint returns data
**Then** the response includes `Cache-Control: no-store`

**Given** Story 10.3's `DataApiModule` is registered in `AppModule`
**When** `DataConsumptionApiController` and `DataConsumptionApiService` are added to `DataApiModule`
**Then** the module compiles without errors and the new endpoints are reachable

---

## Schema Changes

### Fleet Model — Add `shares_consumption_data`

**File:** `packages/db/prisma/schema.prisma`

Add to the existing `Fleet` model:

```prisma
shares_consumption_data Boolean @default(false)
```

Full updated model (showing addition in context):

```prisma
model Fleet {
  id                      String                  @id @default(cuid())
  name                    String
  owner_id                String                  @unique
  owner                   User                    @relation("FleetOwner", fields: [owner_id], references: [id])
  subscription_status     FleetSubscriptionStatus @default(FREE_TRIAL)
  trial_ends_at           DateTime?
  stripe_customer_id      String?
  stripe_subscription_id  String?
  shares_consumption_data Boolean                 @default(false)   // opt-in: expose anonymised fill-up data to data buyers
  created_at              DateTime                @default(now())
  updated_at              DateTime                @updatedAt

  members  User[]    @relation("FleetMembers")
  vehicles Vehicle[]
  fillUps  FillUp[]
}
```

**Migration name:** `add_fleet_consumption_sharing`

No UI is provided for toggling this flag. The opt-in UI and consent flow are deferred to a future story (post-MVP). Ops sets it manually via Prisma Studio or direct SQL for now.

---

## DataConsumptionApiService

**File:** `apps/api/src/data-api/data-consumption-api.service.ts` (new)

```typescript
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  FillUpsQueryDto,
  ConsumptionAggregatedQueryDto,
  StationConsumptionQueryDto,
} from './dto';

export interface FillUpRecord {
  fill_up_id: string;
  station_id: string | null;
  station_name: string | null;
  voivodeship: string | null;
  lat: number | null;
  lng: number | null;
  fuel_type: string;
  volume_litres: number;
  price_per_litre: number;
  total_cost_pln: number;
  odometer_km: number | null;
  efficiency_l_per_100km: number | null;
  vehicle_fuel_type: string | null;
  vehicle_brand: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  filled_at: string;
}

export interface ConsumptionAggregateRecord {
  period: string;
  avg_efficiency_l_per_100km: number | null;
  avg_price_per_litre: number;
  total_volume_litres: number;
  fill_up_count: number;
  sample_fleet_count: number;
}

export interface StationConsumptionRecord {
  station_id: string;
  station_name: string;
  voivodeship: string | null;
  lat: number | null;
  lng: number | null;
  fill_up_count: number;
  avg_volume_litres: number;
  avg_price_per_litre: number;
  last_fill_up_at: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: Record<string, unknown>;
}

const MAX_FILLUPS_DAYS = 90;
const MAX_AGGREGATED_DAYS = 365;

@Injectable()
export class DataConsumptionApiService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Fill-ups ─────────────────────────────────────────────────────────────

  async getFillUps(dto: FillUpsQueryDto): Promise<PaginatedResponse<FillUpRecord>> {
    const dateTo = dto.date_to ? new Date(dto.date_to) : new Date();
    const dateFrom = dto.date_from
      ? new Date(dto.date_from)
      : new Date(dateTo.getTime() - 30 * 24 * 60 * 60 * 1000);

    const diffDays = (dateTo.getTime() - dateFrom.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays > MAX_FILLUPS_DAYS) {
      throw new BadRequestException(
        `Date range exceeds maximum of ${MAX_FILLUPS_DAYS} days (requested ${Math.ceil(diffDays)} days)`,
      );
    }

    const limit = Math.min(dto.limit ?? 500, 5000);
    const offset = dto.offset ?? 0;

    // Efficiency is computed via SQL window function (LAG) on vehicle_id + filled_at ordering.
    // For the first fill-up in the result window for each vehicle, the previous odometer is
    // unknown — efficiency will be NULL. Buyers should account for this in their processing.
    const rows = await this.prisma.$queryRaw<
      {
        fill_up_id: string;
        station_id: string | null;
        station_name: string | null;
        voivodeship: string | null;
        lat: number | null;
        lng: number | null;
        fuel_type: string;
        volume_litres: number;
        price_per_litre: number;
        total_cost_pln: number;
        odometer_km: number | null;
        efficiency_l_per_100km: number | null;
        vehicle_fuel_type: string | null;
        vehicle_brand: string | null;
        vehicle_model: string | null;
        vehicle_year: number | null;
        filled_at: Date;
      }[]
    >`
      SELECT
        fu.id                             AS fill_up_id,
        fu.station_id,
        s.name                            AS station_name,
        s.voivodeship,
        ST_Y(s.location::geometry)        AS lat,
        ST_X(s.location::geometry)        AS lng,
        fu.fuel_type,
        fu.litres                         AS volume_litres,
        fu.price_per_litre_pln            AS price_per_litre,
        fu.total_cost_pln,
        fu.odometer_km,
        CASE
          WHEN fu.odometer_km IS NOT NULL
           AND LAG(fu.odometer_km) OVER (PARTITION BY fu.vehicle_id ORDER BY fu.filled_at) IS NOT NULL
           AND (fu.odometer_km - LAG(fu.odometer_km) OVER (PARTITION BY fu.vehicle_id ORDER BY fu.filled_at)) > 0
          THEN (fu.litres / NULLIF(
            fu.odometer_km - LAG(fu.odometer_km) OVER (PARTITION BY fu.vehicle_id ORDER BY fu.filled_at),
            0
          )) * 100
        END                               AS efficiency_l_per_100km,
        v.fuel_type                       AS vehicle_fuel_type,
        NULL::text                        AS vehicle_brand,
        NULL::text                        AS vehicle_model,
        NULL::int                         AS vehicle_year,
        fu.filled_at
      FROM "FillUp" fu
      JOIN "Fleet" f ON f.id = fu.fleet_id AND f.shares_consumption_data = true
      LEFT JOIN "Station" s ON s.id = fu.station_id
      LEFT JOIN "Vehicle" v ON v.id = fu.vehicle_id
      WHERE fu.filled_at BETWEEN ${dateFrom} AND ${dateTo}
        AND fu.fleet_id IS NOT NULL
        ${dto.voivodeship ? this.prisma.$queryRaw`AND s.voivodeship = ${dto.voivodeship}` : this.prisma.$queryRaw``}
        ${dto.fuel_type ? this.prisma.$queryRaw`AND fu.fuel_type = ${dto.fuel_type}` : this.prisma.$queryRaw``}
        ${dto.vehicle_year_min != null ? this.prisma.$queryRaw`AND 1=1` : this.prisma.$queryRaw``}
        ${dto.vehicle_year_max != null ? this.prisma.$queryRaw`AND 1=1` : this.prisma.$queryRaw``}
      ORDER BY fu.filled_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    // Note: vehicle_brand/model/year filters are no-ops against fleet vehicles (which lack these
    // fields). They are included in the DTO for forward compatibility when fleet vehicles gain
    // make/model/year in a future story.

    const [{ total }] = await this.prisma.$queryRaw<[{ total: bigint }]>`
      SELECT COUNT(*) AS total
      FROM "FillUp" fu
      JOIN "Fleet" f ON f.id = fu.fleet_id AND f.shares_consumption_data = true
      LEFT JOIN "Station" s ON s.id = fu.station_id
      WHERE fu.filled_at BETWEEN ${dateFrom} AND ${dateTo}
        AND fu.fleet_id IS NOT NULL
        ${dto.voivodeship ? this.prisma.$queryRaw`AND s.voivodeship = ${dto.voivodeship}` : this.prisma.$queryRaw``}
        ${dto.fuel_type ? this.prisma.$queryRaw`AND fu.fuel_type = ${dto.fuel_type}` : this.prisma.$queryRaw``}
    `;

    return {
      data: rows.map((r) => ({
        fill_up_id:             r.fill_up_id,
        station_id:             r.station_id,
        station_name:           r.station_name,
        voivodeship:            r.voivodeship,
        lat:                    r.lat,
        lng:                    r.lng,
        fuel_type:              r.fuel_type,
        volume_litres:          Number(r.volume_litres),
        price_per_litre:        Number(r.price_per_litre),
        total_cost_pln:         Number(r.total_cost_pln),
        odometer_km:            r.odometer_km ?? null,
        efficiency_l_per_100km: r.efficiency_l_per_100km != null ? Number(r.efficiency_l_per_100km) : null,
        vehicle_fuel_type:      r.vehicle_fuel_type,
        vehicle_brand:          r.vehicle_brand,
        vehicle_model:          r.vehicle_model,
        vehicle_year:           r.vehicle_year,
        filled_at:              r.filled_at.toISOString(),
      })),
      meta: {
        total:     Number(total),
        limit,
        offset,
        date_from: dateFrom.toISOString(),
        date_to:   dateTo.toISOString(),
      },
    };
  }

  // ─── Aggregated ───────────────────────────────────────────────────────────

  async getAggregatedConsumption(dto: ConsumptionAggregatedQueryDto): Promise<{
    data: ConsumptionAggregateRecord[];
    meta: Record<string, unknown>;
  }> {
    const dateTo = dto.date_to ? new Date(dto.date_to) : new Date();
    const dateFrom = dto.date_from
      ? new Date(dto.date_from)
      : new Date(dateTo.getTime() - 90 * 24 * 60 * 60 * 1000);

    const diffDays = (dateTo.getTime() - dateFrom.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays > MAX_AGGREGATED_DAYS) {
      throw new BadRequestException(
        `Date range exceeds maximum of ${MAX_AGGREGATED_DAYS} days (requested ${Math.ceil(diffDays)} days)`,
      );
    }

    const granularity = dto.granularity ?? 'week';
    const truncUnit = granularity === 'month' ? 'month' : granularity === 'week' ? 'week' : 'day';

    // Efficiency is averaged from the window-function result. Rows where the LAG produces NULL
    // (first fill-up in each vehicle's history within the window) are excluded from the avg.
    const rows = await this.prisma.$queryRaw<
      {
        period: Date;
        avg_efficiency_l_per_100km: number | null;
        avg_price_per_litre: number;
        total_volume_litres: number;
        fill_up_count: bigint;
        sample_fleet_count: bigint;
      }[]
    >`
      WITH windowed AS (
        SELECT
          fu.filled_at,
          fu.fuel_type,
          fu.litres,
          fu.price_per_litre_pln,
          fu.fleet_id,
          s.voivodeship,
          CASE
            WHEN fu.odometer_km IS NOT NULL
             AND LAG(fu.odometer_km) OVER (PARTITION BY fu.vehicle_id ORDER BY fu.filled_at) IS NOT NULL
             AND (fu.odometer_km - LAG(fu.odometer_km) OVER (PARTITION BY fu.vehicle_id ORDER BY fu.filled_at)) > 0
            THEN (fu.litres / NULLIF(
              fu.odometer_km - LAG(fu.odometer_km) OVER (PARTITION BY fu.vehicle_id ORDER BY fu.filled_at),
              0
            )) * 100
          END AS efficiency_l_per_100km
        FROM "FillUp" fu
        JOIN "Fleet" f ON f.id = fu.fleet_id AND f.shares_consumption_data = true
        LEFT JOIN "Station" s ON s.id = fu.station_id
        WHERE fu.filled_at BETWEEN ${dateFrom} AND ${dateTo}
          AND fu.fleet_id IS NOT NULL
          AND fu.fuel_type = ${dto.fuel_type}
          ${dto.voivodeship ? this.prisma.$queryRaw`AND s.voivodeship = ${dto.voivodeship}` : this.prisma.$queryRaw``}
          ${dto.vehicle_brand ? this.prisma.$queryRaw`AND 1=1` : this.prisma.$queryRaw``}
      )
      SELECT
        DATE_TRUNC(${truncUnit}, filled_at)  AS period,
        AVG(efficiency_l_per_100km)          AS avg_efficiency_l_per_100km,
        AVG(price_per_litre_pln)             AS avg_price_per_litre,
        SUM(litres)                          AS total_volume_litres,
        COUNT(*)                             AS fill_up_count,
        COUNT(DISTINCT fleet_id)             AS sample_fleet_count
      FROM windowed
      GROUP BY period
      ORDER BY period
    `;

    return {
      data: rows.map((r) => ({
        period:                      r.period.toISOString(),
        avg_efficiency_l_per_100km:  r.avg_efficiency_l_per_100km != null ? Number(r.avg_efficiency_l_per_100km) : null,
        avg_price_per_litre:         Number(r.avg_price_per_litre),
        total_volume_litres:         Number(r.total_volume_litres),
        fill_up_count:               Number(r.fill_up_count),
        sample_fleet_count:          Number(r.sample_fleet_count),
      })),
      meta: {
        granularity,
        fuel_type:   dto.fuel_type,
        voivodeship: dto.voivodeship ?? null,
        date_from:   dateFrom.toISOString(),
        date_to:     dateTo.toISOString(),
      },
    };
  }

  // ─── Station consumption ──────────────────────────────────────────────────

  async getStationConsumption(
    dto: StationConsumptionQueryDto,
  ): Promise<PaginatedResponse<StationConsumptionRecord>> {
    const dateTo = dto.date_to ? new Date(dto.date_to) : new Date();
    const dateFrom = dto.date_from
      ? new Date(dto.date_from)
      : new Date(dateTo.getTime() - 30 * 24 * 60 * 60 * 1000);

    const limit = Math.min(dto.limit ?? 100, 500);
    const offset = dto.offset ?? 0;

    const rows = await this.prisma.$queryRaw<
      {
        station_id: string;
        station_name: string;
        voivodeship: string | null;
        lat: number | null;
        lng: number | null;
        fill_up_count: bigint;
        avg_volume_litres: number;
        avg_price_per_litre: number;
        last_fill_up_at: Date;
      }[]
    >`
      SELECT
        s.id                              AS station_id,
        s.name                            AS station_name,
        s.voivodeship,
        ST_Y(s.location::geometry)        AS lat,
        ST_X(s.location::geometry)        AS lng,
        COUNT(fu.id)                      AS fill_up_count,
        AVG(fu.litres)                    AS avg_volume_litres,
        AVG(fu.price_per_litre_pln)       AS avg_price_per_litre,
        MAX(fu.filled_at)                 AS last_fill_up_at
      FROM "Station" s
      JOIN "FillUp" fu ON fu.station_id = s.id
      JOIN "Fleet" f ON f.id = fu.fleet_id AND f.shares_consumption_data = true
      WHERE fu.filled_at BETWEEN ${dateFrom} AND ${dateTo}
        AND fu.fleet_id IS NOT NULL
        ${dto.voivodeship ? this.prisma.$queryRaw`AND s.voivodeship = ${dto.voivodeship}` : this.prisma.$queryRaw``}
        ${dto.fuel_type ? this.prisma.$queryRaw`AND fu.fuel_type = ${dto.fuel_type}` : this.prisma.$queryRaw``}
      GROUP BY s.id, s.name, s.voivodeship, s.location
      ORDER BY fill_up_count DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const [{ total }] = await this.prisma.$queryRaw<[{ total: bigint }]>`
      SELECT COUNT(DISTINCT s.id) AS total
      FROM "Station" s
      JOIN "FillUp" fu ON fu.station_id = s.id
      JOIN "Fleet" f ON f.id = fu.fleet_id AND f.shares_consumption_data = true
      WHERE fu.filled_at BETWEEN ${dateFrom} AND ${dateTo}
        AND fu.fleet_id IS NOT NULL
        ${dto.voivodeship ? this.prisma.$queryRaw`AND s.voivodeship = ${dto.voivodeship}` : this.prisma.$queryRaw``}
        ${dto.fuel_type ? this.prisma.$queryRaw`AND fu.fuel_type = ${dto.fuel_type}` : this.prisma.$queryRaw``}
    `;

    return {
      data: rows.map((r) => ({
        station_id:          r.station_id,
        station_name:        r.station_name,
        voivodeship:         r.voivodeship,
        lat:                 r.lat,
        lng:                 r.lng,
        fill_up_count:       Number(r.fill_up_count),
        avg_volume_litres:   Number(r.avg_volume_litres),
        avg_price_per_litre: Number(r.avg_price_per_litre),
        last_fill_up_at:     r.last_fill_up_at.toISOString(),
      })),
      meta: { total: Number(total), limit, offset },
    };
  }
}
```

---

## DTOs

Update the barrel export at `apps/api/src/data-api/dto/index.ts` — add the three new DTOs:

```typescript
// Existing exports (from Story 10.3)
export * from './latest-prices-query.dto';
export * from './price-history-query.dto';
export * from './aggregated-query.dto';
export * from './stations-query.dto';
export * from './create-data-api-key.dto';

// Story 10.4 additions
export * from './fill-ups-query.dto';
export * from './consumption-aggregated-query.dto';
export * from './station-consumption-query.dto';
```

**File:** `apps/api/src/data-api/dto/fill-ups-query.dto.ts` (new)

```typescript
import { IsEnum, IsInt, IsISO8601, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { FuelType } from './latest-prices-query.dto';

export class FillUpsQueryDto {
  @IsOptional()
  @IsString()
  voivodeship?: string;

  @IsOptional()
  @IsEnum(FuelType)
  fuel_type?: FuelType;

  @IsOptional()
  @IsString()
  vehicle_brand?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(2100)
  vehicle_year_min?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(2100)
  vehicle_year_max?: number;

  @IsOptional()
  @IsISO8601()
  date_from?: string;

  @IsOptional()
  @IsISO8601()
  date_to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
```

**File:** `apps/api/src/data-api/dto/consumption-aggregated-query.dto.ts` (new)

```typescript
import { IsEnum, IsISO8601, IsOptional, IsString } from 'class-validator';
import { FuelType } from './latest-prices-query.dto';
import { Granularity } from './aggregated-query.dto';

export class ConsumptionAggregatedQueryDto {
  @IsOptional()
  @IsString()
  voivodeship?: string;

  @IsEnum(FuelType)
  fuel_type: FuelType;

  @IsOptional()
  @IsString()
  vehicle_brand?: string;

  @IsOptional()
  @IsEnum(Granularity)
  granularity?: Granularity;

  @IsOptional()
  @IsISO8601()
  date_from?: string;

  @IsOptional()
  @IsISO8601()
  date_to?: string;
}
```

**File:** `apps/api/src/data-api/dto/station-consumption-query.dto.ts` (new)

```typescript
import { IsEnum, IsInt, IsISO8601, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { FuelType } from './latest-prices-query.dto';

export class StationConsumptionQueryDto {
  @IsOptional()
  @IsString()
  voivodeship?: string;

  @IsOptional()
  @IsEnum(FuelType)
  fuel_type?: FuelType;

  @IsOptional()
  @IsISO8601()
  date_from?: string;

  @IsOptional()
  @IsISO8601()
  date_to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
```

---

## DataConsumptionApiController

**File:** `apps/api/src/data-api/data-consumption-api.controller.ts` (new)

```typescript
import {
  Controller, ForbiddenException, Get, Query, Req, Res, UseGuards,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Public } from '../auth/decorators/public.decorator';
import { DataApiKeyGuard } from './data-api-key.guard';
import { DataConsumptionApiService } from './data-consumption-api.service';
import {
  FillUpsQueryDto,
  ConsumptionAggregatedQueryDto,
  StationConsumptionQueryDto,
} from './dto';

@Controller('v1/data-api/consumption')
@Public()
@UseGuards(DataApiKeyGuard)
export class DataConsumptionApiController {
  constructor(private readonly service: DataConsumptionApiService) {}

  /**
   * GET /v1/data-api/consumption/fill-ups
   *
   * Anonymised fill-up records from fleets that have opted in to data sharing
   * (Fleet.shares_consumption_data = true). No fleet_id, vehicle_id, driver_id,
   * or registration plate in responses. Efficiency is computed via SQL LAG window
   * function — null for the first fill-up of each vehicle in the result window.
   *
   * Filters: voivodeship, fuel_type, vehicle_brand, vehicle_year_min/max, date_from, date_to.
   * Pagination: limit (max 5000, default 500), offset.
   * Default date range: last 30 days. Max date range: 90 days.
   *
   * Requires CONSUMPTION_DATA or FULL_ACCESS tier — PRICE_DATA buyers receive 403.
   */
  @Get('fill-ups')
  async getFillUps(
    @Req() req: FastifyRequest & { dataBuyerTier: string },
    @Query() dto: FillUpsQueryDto,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    if (req.dataBuyerTier !== 'CONSUMPTION_DATA' && req.dataBuyerTier !== 'FULL_ACCESS') {
      throw new ForbiddenException('This endpoint requires CONSUMPTION_DATA or FULL_ACCESS tier');
    }
    res.header('Cache-Control', 'no-store');
    return this.service.getFillUps(dto);
  }

  /**
   * GET /v1/data-api/consumption/aggregated
   *
   * Time-bucketed consumption aggregates (day/week/month) from consenting fleets.
   * fuel_type is required. Includes avg_efficiency_l_per_100km (null if no odometer data),
   * avg_price_per_litre, total_volume_litres, fill_up_count, and sample_fleet_count
   * (COUNT DISTINCT fleet_id — shows data breadth without revealing IDs).
   *
   * Default date range: last 90 days. Max date range: 365 days.
   *
   * Requires CONSUMPTION_DATA or FULL_ACCESS tier — PRICE_DATA buyers receive 403.
   */
  @Get('aggregated')
  async getAggregated(
    @Req() req: FastifyRequest & { dataBuyerTier: string },
    @Query() dto: ConsumptionAggregatedQueryDto,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    if (req.dataBuyerTier !== 'CONSUMPTION_DATA' && req.dataBuyerTier !== 'FULL_ACCESS') {
      throw new ForbiddenException('This endpoint requires CONSUMPTION_DATA or FULL_ACCESS tier');
    }
    res.header('Cache-Control', 'no-store');
    return this.service.getAggregatedConsumption(dto);
  }

  /**
   * GET /v1/data-api/consumption/stations
   *
   * Per-station fill-up statistics aggregated from consenting fleet fill-ups only.
   * Only stations with at least one qualifying fill-up in the date range are included.
   * Ordered by fill_up_count DESC.
   *
   * Default date range: last 30 days. Pagination: limit (max 500, default 100), offset.
   *
   * Requires CONSUMPTION_DATA or FULL_ACCESS tier — PRICE_DATA buyers receive 403.
   */
  @Get('stations')
  async getStations(
    @Req() req: FastifyRequest & { dataBuyerTier: string },
    @Query() dto: StationConsumptionQueryDto,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    if (req.dataBuyerTier !== 'CONSUMPTION_DATA' && req.dataBuyerTier !== 'FULL_ACCESS') {
      throw new ForbiddenException('This endpoint requires CONSUMPTION_DATA or FULL_ACCESS tier');
    }
    res.header('Cache-Control', 'no-store');
    return this.service.getStationConsumption(dto);
  }
}
```

---

## DataApiModule Update

**File:** `apps/api/src/data-api/data-api.module.ts` (update)

Add `DataConsumptionApiController` to `controllers` and `DataConsumptionApiService` to `providers`:

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { DataApiKeyGuard } from './data-api-key.guard';
import { DataPriceApiService } from './data-price-api.service';
import { DataPriceApiController } from './data-price-api.controller';
import { DataConsumptionApiService } from './data-consumption-api.service';
import { DataConsumptionApiController } from './data-consumption-api.controller';
import { DataBuyerKeysService } from './data-buyer-keys.service';

@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [DataPriceApiController, DataConsumptionApiController],
  providers: [
    DataApiKeyGuard,
    DataPriceApiService,
    DataConsumptionApiService,
    DataBuyerKeysService,
  ],
  exports: [DataApiKeyGuard, DataBuyerKeysService],
})
export class DataApiModule {}
```

---

## Migration

**Name:** `add_fleet_consumption_sharing`

```sql
ALTER TABLE "Fleet"
  ADD COLUMN "shares_consumption_data" BOOLEAN NOT NULL DEFAULT false;
```

This is a non-breaking, additive migration. All existing Fleet rows default to `false` — no data is exposed until ops explicitly opts a fleet in. No index needed: the column is used as a filter in JOIN conditions and the fleet table is small (hundreds to thousands of rows, not millions).

---

## Tasks / Subtasks

- [ ] API: Prisma schema — add `shares_consumption_data Boolean @default(false)` to `Fleet` model (AC: 1)
  - [ ] Migration: `add_fleet_consumption_sharing` — `ALTER TABLE "Fleet" ADD COLUMN`

- [ ] API: DTOs — `FillUpsQueryDto`, `ConsumptionAggregatedQueryDto`, `StationConsumptionQueryDto` with class-validator decorators (AC: 3, 4, 5, 7, 8, 9)
  - [ ] `FillUpsQueryDto`: voivodeship, fuel_type, vehicle_brand, vehicle_year_min/max, date_from, date_to, limit (max 5000), offset
  - [ ] `ConsumptionAggregatedQueryDto`: voivodeship, fuel_type (required), vehicle_brand, granularity (day|week|month), date_from, date_to
  - [ ] `StationConsumptionQueryDto`: voivodeship, fuel_type, date_from, date_to, limit (max 500), offset
  - [ ] Update `dto/index.ts` barrel export with new DTOs

- [ ] API: `DataConsumptionApiService` — three query methods using `prisma.$queryRaw` (AC: 3, 4, 5, 6, 7, 8, 9)
  - [ ] `getFillUps()`: JOIN `Fleet` with `shares_consumption_data = true`; LAG window function for efficiency; enforce 90-day max range; `BadRequestException` on violation; no fleet_id/vehicle_id/user_id in SELECT
  - [ ] `getAggregatedConsumption()`: CTE with LAG for efficiency per row; outer GROUP BY DATE_TRUNC; `COUNT(DISTINCT fleet_id)` for `sample_fleet_count`; enforce 365-day max range
  - [ ] `getStationConsumption()`: GROUP BY station; INNER JOIN Fleet with consent filter; no station without fill-ups appears; separate COUNT query for total

- [ ] API: `DataConsumptionApiController` — `@Public() @UseGuards(DataApiKeyGuard)` + tier check on every handler + 3 GET endpoints + `Cache-Control: no-store` (AC: 2, 3, 4, 5, 7, 8, 9, 10)
  - [ ] `GET /v1/data-api/consumption/fill-ups`
  - [ ] `GET /v1/data-api/consumption/aggregated`
  - [ ] `GET /v1/data-api/consumption/stations`
  - [ ] Tier check in every handler: `CONSUMPTION_DATA | FULL_ACCESS` only; `PRICE_DATA` → 403

- [ ] API: `DataApiModule` — add `DataConsumptionApiController` to `controllers`, `DataConsumptionApiService` to `providers` (AC: 11)

---

## Dev Notes

### Two Vehicle Models — No make/model/year on Fleet Vehicles

The codebase has two `Vehicle` models:

- **Personal vehicles** (Story 5.1): `make`, `model`, `year`, `fuel_type` — linked to `User`. Fill-ups from personal vehicles carry full vehicle specs.
- **Fleet vehicles** (Story 9.1): `name`, `registration`, `fuel_type?` — linked to `Fleet`. No `make`, `model`, or `year` fields.

Because `Fleet.shares_consumption_data` controls which fill-ups are exposed, and fleet fill-ups use fleet vehicles, `vehicle_brand`, `vehicle_model`, and `vehicle_year` will be `null` in almost all responses at launch. The response fields are included now for forward compatibility — a future story that adds make/model/year to fleet vehicles will populate them without any API contract change. The `vehicle_brand` filter in `FillUpsQueryDto` and `ConsumptionAggregatedQueryDto` is a no-op against current data; dev should document this in API documentation.

### Efficiency Calculation — LAG Window Function and NULL Semantics

Efficiency (`l/100km`) requires two consecutive fill-ups for the same vehicle: `(volume / distance) * 100`. The SQL pattern:

```sql
CASE
  WHEN fu.odometer_km IS NOT NULL
   AND LAG(fu.odometer_km) OVER (PARTITION BY fu.vehicle_id ORDER BY fu.filled_at) IS NOT NULL
   AND (fu.odometer_km - LAG(fu.odometer_km) OVER (...)) > 0
  THEN (fu.litres / NULLIF(fu.odometer_km - LAG(fu.odometer_km) OVER (...), 0)) * 100
END AS efficiency_l_per_100km
```

**Null sources:**
1. `odometer_km` is nullable — Story 5.4 adds OCR-based odometer recording; earlier fill-ups may lack it.
2. The first fill-up in each vehicle's history within the paginated result window has no LAG predecessor — efficiency is NULL.
3. If the odometer decreased (data entry error), the distance is ≤ 0 — the `> 0` guard produces NULL.

Data buyers must handle NULL efficiency fields. The `avg_efficiency_l_per_100km` in aggregated responses is `AVG(...)` — PostgreSQL's `AVG` ignores NULLs, so buckets with no valid efficiency readings return `null`.

### `sample_fleet_count` — Privacy-Safe Fleet Count

The aggregated response includes `sample_fleet_count = COUNT(DISTINCT fleet_id)`. This is computed inside the SQL and never exposed as a raw ID. Its purpose is to help buyers assess data quality: a bucket with `fill_up_count = 50` but `sample_fleet_count = 1` comes from a single fleet and may not be representative. The fleet_id itself is used only for `COUNT(DISTINCT ...)` in the `GROUP BY` phase — it never appears in the result set.

### Consent Flag — Manual Ops for MVP, UI Deferred

`Fleet.shares_consumption_data` defaults to `false`. There is no UI for fleet operators to toggle this in Story 10.4. The consent UI and associated consent type (e.g. `ConsentType.FLEET_DATA_SHARING`) are deferred to a future story. For MVP, ops enables sharing by running:

```sql
UPDATE "Fleet" SET shares_consumption_data = true WHERE id = '<fleet_id>';
```

Or via Prisma Studio. Any fleet not explicitly opted in receives `false` and contributes no records.

### `FillUp.fleet_id` Requirement

The consumption data API only exposes fill-ups where `fu.fleet_id IS NOT NULL` — this filters to fleet-context fill-ups. Personal fill-ups (where `fleet_id` is null) are excluded regardless of any consent flag, because personal Vehicle records carry user identity. Personal vehicle data sharing (if ever added) would require a separate consent model and is out of scope for Epic 10.

### `prisma.$queryRaw` Conditional Fragment Pattern

Identical to Story 10.3 — requires Prisma v5.0+. If the project uses an older version, replace conditional interpolation with `Prisma.sql` fragment arrays. See Story 10.3 Dev Notes for the alternative pattern.

### `Cache-Control: no-store`

All three consumption endpoints set `Cache-Control: no-store` via Fastify's `@Res({ passthrough: true })` pattern, identical to Story 10.3. Data buyers pay for current data — caching undermines the value proposition and could expose one buyer's anonymised data to another buyer.

### FillUp Field Name Mapping

The `FillUp` model (confirmed from Stories 5.2 and 9.3) uses:
- `litres` (not `volume_litres`) — mapped in SQL `AS volume_litres` for buyer-friendly naming
- `price_per_litre_pln` (not `price_per_litre`) — mapped `AS price_per_litre` in response
- `total_cost_pln` — returned as-is
- `filled_at` — confirmed (not `created_at`)
- `fleet_id` — nullable String, denormalised from `User.fleet_id` at fill-up write time (Story 9.3)

### No New Environment Variables

This story uses only existing `DATABASE_URL` (Prisma) and `REDIS_URL` (DataApiKeyGuard from 10.3). No new environment variables are required.

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
