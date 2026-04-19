# Story 10.3: Fuel Price Data API

## Metadata
- **Epic:** 10 — Data Licensing & Public Portal
- **Story ID:** 10.3
- **Status:** ready-for-dev
- **Date:** 2026-04-08
- **Depends on:** Story 10.2 (DataBuyerProfile, DataBuyerStatus, DataTier enums, DataBuyerService.approveAccess()), Story 1.5 (JwtAuthGuard, @Public() decorator), Story 1.0b (RedisModule, REDIS_CLIENT injection token)
- **Required by:** Story 10.4 (DataConsumptionApiController reuses DataApiKeyGuard from this story)

---

## User Story

**As an approved data buyer,**
I want to query fuel price data via a REST API using my API key,
So that I can integrate live and historical Polish fuel prices into my product without manual data pulls.

---

## Context & Why

Data buyers approved in Story 10.2 receive a `ddk_`-prefixed API key delivered by email. This story defines the `DataApiKey` model (referenced but deferred in 10.2), the guard that authenticates those keys, and the four data endpoints that constitute the PRICE_DATA tier.

The PRICE_DATA tier covers the most commercially valuable dataset: station-level prices, raw history, regional aggregates, and station master data. These four endpoints together satisfy the majority of buyer use cases — route cost estimation, price index products, market monitoring dashboards.

### API Key Design

- Format: `ddk_` prefix + 64 hex chars (32 random bytes) — 68 chars total
- Stored as SHA-256 hash only — plaintext shown once at creation (delivered by email in 10.2's `approveAccess()`)
- `key_prefix` stores first 12 chars (`ddk_` + first 8 hex) for display in future buyer portal
- Multiple keys per buyer profile (max 5 active), each independently revocable
- Revocation via soft delete (`revoked_at`)
- Label field for buyer-set descriptions (e.g. "Production", "Staging")

### Authentication Architecture

The global `JwtAuthGuard` (registered as `APP_GUARD`) protects all routes. Data API endpoints bypass it via `@Public()` and instead use `@UseGuards(DataApiKeyGuard)` at the controller level — identical pattern to `ApiKeyGuard` in Story 9.7, with a separate guard class and different rate limit semantics.

**Rate limit:** 300 requests/hour per API key (enforced via Redis `INCR` + `EXPIRE`). Data buyers are expected to run batch jobs, not real-time polling — 300 req/hr is generous for batch use but guards against runaway scripts. The window is 1 hour (vs 1 minute for fleet keys) to accommodate large paginated exports.

### Relation to Story 10.4

`DataApiKeyGuard` is designed for reuse. It attaches `req.dataBuyerTier` to the request. Story 10.4's `DataConsumptionApiController` will import `DataApiKeyGuard` from `DataApiModule` and add a tier check: if `req.dataBuyerTier !== 'CONSUMPTION_DATA' && req.dataBuyerTier !== 'FULL_ACCESS'` → 403 Forbidden.

---

## Acceptance Criteria

**Given** Story 10.2's `approveAccess()` calls `prisma.dataApiKey.create()`
**When** migration `add_data_api_key` has been run
**Then** the call succeeds and the key is persisted with `key_hash` and `key_prefix`

**Given** an approved buyer sends `Authorization: Bearer ddk_...` to any `/v1/data-api/` endpoint
**When** the key hash matches an active, non-revoked key belonging to an ACTIVE profile
**Then** `DataApiKeyGuard` allows the request and attaches `req.dataBuyerProfileId` and `req.dataBuyerTier`

**Given** an API key makes more than 300 requests within a 3600-second window
**When** the 301st request arrives
**Then** the API returns HTTP 429 with header `Retry-After: 3600` and body `{ "error": "Rate limit exceeded" }`

**Given** a revoked or non-existent key is used
**When** any `/v1/data-api/` endpoint is called
**Then** the API returns HTTP 401

**Given** a buyer's profile is SUSPENDED
**When** they send a request with their key
**Then** the API returns HTTP 401

**Given** a buyer calls `GET /v1/data-api/prices/latest`
**When** optional filters `voivodeship` and `fuel_type` are provided
**Then** the response contains the most recent price per station matching the filters, with `Cache-Control: no-store`

**Given** a buyer calls `GET /v1/data-api/prices/history` without `station_id` or `voivodeship`
**Then** the API returns HTTP 400 with a message requiring at least one filter

**Given** a buyer calls `GET /v1/data-api/prices/history` with a date range exceeding 90 days
**Then** the API returns HTTP 400 with a message indicating the 90-day maximum

**Given** a buyer calls `GET /v1/data-api/prices/aggregated` with `fuel_type` and `granularity=week`
**When** a valid date range is provided (≤365 days)
**Then** the response contains week-bucketed avg/min/max/count rows

**Given** a buyer calls `GET /v1/data-api/stations` with `has_price_within_days=7`
**Then** only stations with at least one price record in the last 7 days are returned

**Given** a buyer calls `POST /v1/data-buyers/me/keys` and already has 5 active keys
**Then** the API returns HTTP 400 with a message indicating the 5-key limit

**Given** a buyer calls `GET /v1/data-buyers/me/keys`
**Then** they see only their own non-revoked keys (profile scoped by JWT sub)

---

## New Prisma Model

```prisma
model DataApiKey {
  id           String           @id @default(cuid())
  profile_id   String
  profile      DataBuyerProfile @relation(fields: [profile_id], references: [id], onDelete: Cascade)
  key_hash     String           @unique  // SHA-256(full key)
  key_prefix   String                    // first 12 chars: 'ddk_' + first 8 hex chars
  label        String?                   // optional buyer-set label (e.g. 'Production')
  created_at   DateTime         @default(now())
  last_used_at DateTime?
  revoked_at   DateTime?

  @@index([profile_id])
}
```

**Add to `DataBuyerProfile` model:**
```prisma
dataApiKeys  DataApiKey[]
```

**Migration name:** `add_data_api_key`

---

## DataApiKeyGuard

**File:** `apps/api/src/data-api/data-api-key.guard.ts` (new)

```typescript
import {
  CanActivate, ExecutionContext, HttpException,
  Inject, Injectable, UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import type { Redis } from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';

const RATE_LIMIT_REQUESTS = 300;
const RATE_LIMIT_WINDOW_SECONDS = 3600;

@Injectable()
export class DataApiKeyGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const authHeader: string | undefined = req.headers['authorization'];

    if (!authHeader?.startsWith('Bearer ddk_')) {
      throw new UnauthorizedException('Data API key required');
    }

    const key = authHeader.slice(7);  // strip 'Bearer '
    const hash = createHash('sha256').update(key).digest('hex');

    const apiKey = await this.prisma.dataApiKey.findUnique({
      where: { key_hash: hash },
      select: {
        id: true,
        revoked_at: true,
        profile: {
          select: { id: true, tier: true, status: true },
        },
      },
    });

    if (!apiKey || apiKey.revoked_at) {
      throw new UnauthorizedException('Invalid or revoked API key');
    }

    if (apiKey.profile.status !== 'ACTIVE') {
      throw new UnauthorizedException('Data buyer account is not active');
    }

    // Per-key rate limiting via Redis INCR + EXPIRE
    const rateLimitKey = `data_api_rl:${apiKey.id}`;
    const count = await this.redis.incr(rateLimitKey);
    if (count === 1) {
      // First request in window — set TTL
      await this.redis.expire(rateLimitKey, RATE_LIMIT_WINDOW_SECONDS);
    }
    if (count > RATE_LIMIT_REQUESTS) {
      const res = context.switchToHttp().getResponse();
      res.header('Retry-After', String(RATE_LIMIT_WINDOW_SECONDS));
      throw new HttpException({ error: 'Rate limit exceeded' }, 429);
    }

    // Update last_used_at asynchronously — don't block the request
    this.prisma.dataApiKey.update({
      where: { id: apiKey.id },
      data: { last_used_at: new Date() },
    }).catch(() => {});

    // Attach buyer context for use in controllers and downstream guards
    req.dataBuyerProfileId = apiKey.profile.id;
    req.dataBuyerTier = apiKey.profile.tier;
    return true;
  }
}
```

---

## DataPriceApiService

**File:** `apps/api/src/data-api/data-price-api.service.ts` (new)

```typescript
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  LatestPricesQueryDto,
  PriceHistoryQueryDto,
  AggregatedQueryDto,
  StationsQueryDto,
} from './dto';

export interface PriceRecord {
  station_id: string;
  station_name: string;
  voivodeship: string | null;
  lat: number | null;
  lng: number | null;
  fuel_type: string;
  price_pln: number;
  recorded_at: string;
  source: string;
}

export interface AggregatedRecord {
  period: string;
  avg_price: number;
  min_price: number;
  max_price: number;
  sample_count: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: Record<string, unknown>;
}

const MAX_HISTORY_DAYS = 90;
const MAX_AGGREGATED_DAYS = 365;

@Injectable()
export class DataPriceApiService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Latest prices ────────────────────────────────────────────────────────

  async getLatestPrices(dto: LatestPricesQueryDto): Promise<PaginatedResponse<PriceRecord>> {
    const limit = Math.min(dto.limit ?? 100, 1000);
    const offset = dto.offset ?? 0;

    // DISTINCT ON: one row per station+fuel_type combination, newest first
    const rows = await this.prisma.$queryRaw<
      {
        station_id: string;
        station_name: string;
        voivodeship: string | null;
        lat: number | null;
        lng: number | null;
        fuel_type: string;
        price: number;
        recorded_at: Date;
        source: string;
      }[]
    >`
      SELECT DISTINCT ON (ph.station_id, ph.fuel_type)
        ph.station_id,
        s.name          AS station_name,
        s.voivodeship,
        ST_Y(s.location::geometry)  AS lat,
        ST_X(s.location::geometry)  AS lng,
        ph.fuel_type,
        ph.price,
        ph.recorded_at,
        ph.source::text AS source
      FROM "PriceHistory" ph
      JOIN "Station" s ON s.id = ph.station_id
      WHERE 1=1
        ${dto.voivodeship ? this.prisma.$queryRaw`AND s.voivodeship = ${dto.voivodeship}` : this.prisma.$queryRaw``}
        ${dto.fuel_type    ? this.prisma.$queryRaw`AND ph.fuel_type   = ${dto.fuel_type}`  : this.prisma.$queryRaw``}
      ORDER BY ph.station_id, ph.fuel_type, ph.recorded_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    // Separate COUNT query
    const [{ total }] = await this.prisma.$queryRaw<[{ total: bigint }]>`
      SELECT COUNT(DISTINCT (ph.station_id, ph.fuel_type)) AS total
      FROM "PriceHistory" ph
      JOIN "Station" s ON s.id = ph.station_id
      WHERE 1=1
        ${dto.voivodeship ? this.prisma.$queryRaw`AND s.voivodeship = ${dto.voivodeship}` : this.prisma.$queryRaw``}
        ${dto.fuel_type    ? this.prisma.$queryRaw`AND ph.fuel_type   = ${dto.fuel_type}`  : this.prisma.$queryRaw``}
    `;

    return {
      data: rows.map((r) => this.mapPriceRow(r)),
      meta: { total: Number(total), limit, offset },
    };
  }

  // ─── Raw history ──────────────────────────────────────────────────────────

  async getPriceHistory(dto: PriceHistoryQueryDto): Promise<PaginatedResponse<PriceRecord>> {
    if (!dto.station_id && !dto.voivodeship) {
      throw new BadRequestException(
        'At least one of station_id or voivodeship is required to avoid full-table scans',
      );
    }

    const dateTo   = dto.date_to   ? new Date(dto.date_to)   : new Date();
    const dateFrom = dto.date_from ? new Date(dto.date_from) : new Date(dateTo.getTime() - 30 * 24 * 60 * 60 * 1000);

    const diffDays = (dateTo.getTime() - dateFrom.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays > MAX_HISTORY_DAYS) {
      throw new BadRequestException(
        `Date range exceeds maximum of ${MAX_HISTORY_DAYS} days (requested ${Math.ceil(diffDays)} days)`,
      );
    }

    const limit  = Math.min(dto.limit ?? 500, 5000);
    const offset = dto.offset ?? 0;

    const rows = await this.prisma.$queryRaw<
      {
        station_id: string;
        station_name: string;
        voivodeship: string | null;
        lat: number | null;
        lng: number | null;
        fuel_type: string;
        price: number;
        recorded_at: Date;
        source: string;
      }[]
    >`
      SELECT
        ph.station_id,
        s.name          AS station_name,
        s.voivodeship,
        ST_Y(s.location::geometry) AS lat,
        ST_X(s.location::geometry) AS lng,
        ph.fuel_type,
        ph.price,
        ph.recorded_at,
        ph.source::text AS source
      FROM "PriceHistory" ph
      JOIN "Station" s ON s.id = ph.station_id
      WHERE ph.recorded_at BETWEEN ${dateFrom} AND ${dateTo}
        ${dto.station_id  ? this.prisma.$queryRaw`AND ph.station_id  = ${dto.station_id}`  : this.prisma.$queryRaw``}
        ${dto.voivodeship ? this.prisma.$queryRaw`AND s.voivodeship  = ${dto.voivodeship}` : this.prisma.$queryRaw``}
        ${dto.fuel_type   ? this.prisma.$queryRaw`AND ph.fuel_type   = ${dto.fuel_type}`   : this.prisma.$queryRaw``}
      ORDER BY ph.recorded_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const [{ total }] = await this.prisma.$queryRaw<[{ total: bigint }]>`
      SELECT COUNT(*) AS total
      FROM "PriceHistory" ph
      JOIN "Station" s ON s.id = ph.station_id
      WHERE ph.recorded_at BETWEEN ${dateFrom} AND ${dateTo}
        ${dto.station_id  ? this.prisma.$queryRaw`AND ph.station_id  = ${dto.station_id}`  : this.prisma.$queryRaw``}
        ${dto.voivodeship ? this.prisma.$queryRaw`AND s.voivodeship  = ${dto.voivodeship}` : this.prisma.$queryRaw``}
        ${dto.fuel_type   ? this.prisma.$queryRaw`AND ph.fuel_type   = ${dto.fuel_type}`   : this.prisma.$queryRaw``}
    `;

    return {
      data: rows.map((r) => this.mapPriceRow(r)),
      meta: {
        total: Number(total),
        limit,
        offset,
        date_from: dateFrom.toISOString(),
        date_to: dateTo.toISOString(),
      },
    };
  }

  // ─── Aggregated ───────────────────────────────────────────────────────────

  async getAggregatedPrices(dto: AggregatedQueryDto): Promise<{
    data: AggregatedRecord[];
    meta: Record<string, unknown>;
  }> {
    const dateTo   = dto.date_to   ? new Date(dto.date_to)   : new Date();
    const dateFrom = dto.date_from
      ? new Date(dto.date_from)
      : new Date(dateTo.getTime() - 30 * 24 * 60 * 60 * 1000);

    const diffDays = (dateTo.getTime() - dateFrom.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays > MAX_AGGREGATED_DAYS) {
      throw new BadRequestException(
        `Date range exceeds maximum of ${MAX_AGGREGATED_DAYS} days (requested ${Math.ceil(diffDays)} days)`,
      );
    }

    const granularity = dto.granularity ?? 'day';
    // Validate granularity is one of allowed values (DTO enum handles this, but guard defensively)
    const truncUnit = granularity === 'week' ? 'week' : granularity === 'month' ? 'month' : 'day';

    const rows = await this.prisma.$queryRaw<
      {
        period: Date;
        avg_price: number;
        min_price: number;
        max_price: number;
        sample_count: bigint;
      }[]
    >`
      SELECT
        DATE_TRUNC(${truncUnit}, ph.recorded_at) AS period,
        AVG(ph.price)   AS avg_price,
        MIN(ph.price)   AS min_price,
        MAX(ph.price)   AS max_price,
        COUNT(*)        AS sample_count
      FROM "PriceHistory" ph
      JOIN "Station" s ON s.id = ph.station_id
      WHERE ph.fuel_type   = ${dto.fuel_type}
        AND ph.recorded_at BETWEEN ${dateFrom} AND ${dateTo}
        ${dto.voivodeship ? this.prisma.$queryRaw`AND s.voivodeship = ${dto.voivodeship}` : this.prisma.$queryRaw``}
      GROUP BY period
      ORDER BY period
    `;

    return {
      data: rows.map((r) => ({
        period:       r.period.toISOString(),
        avg_price:    Number(r.avg_price),
        min_price:    Number(r.min_price),
        max_price:    Number(r.max_price),
        sample_count: Number(r.sample_count),
      })),
      meta: {
        granularity,
        fuel_type:  dto.fuel_type,
        voivodeship: dto.voivodeship ?? null,
        date_from:  dateFrom.toISOString(),
        date_to:    dateTo.toISOString(),
      },
    };
  }

  // ─── Stations ─────────────────────────────────────────────────────────────

  async getStations(dto: StationsQueryDto): Promise<PaginatedResponse<{
    station_id: string;
    station_name: string;
    slug: string | null;
    address: string | null;
    voivodeship: string | null;
    lat: number | null;
    lng: number | null;
    brand: string | null;
  }>> {
    const limit  = Math.min(dto.limit ?? 200, 2000);
    const offset = dto.offset ?? 0;

    let rows: any[];
    let total: bigint;

    if (dto.has_price_within_days != null) {
      const cutoff = new Date(Date.now() - dto.has_price_within_days * 24 * 60 * 60 * 1000);
      [rows] = await Promise.all([
        this.prisma.$queryRaw`
          SELECT DISTINCT
            s.id          AS station_id,
            s.name        AS station_name,
            NULL::text    AS slug,
            s.address,
            s.voivodeship,
            ST_Y(s.location::geometry) AS lat,
            ST_X(s.location::geometry) AS lng,
            s.brand
          FROM "Station" s
          INNER JOIN "PriceHistory" ph ON ph.station_id = s.id AND ph.recorded_at > ${cutoff}
          WHERE 1=1
            ${dto.voivodeship ? this.prisma.$queryRaw`AND s.voivodeship = ${dto.voivodeship}` : this.prisma.$queryRaw``}
          ORDER BY s.name
          LIMIT ${limit} OFFSET ${offset}
        `,
      ]);
      [{ total }] = await this.prisma.$queryRaw<[{ total: bigint }]>`
        SELECT COUNT(DISTINCT s.id) AS total
        FROM "Station" s
        INNER JOIN "PriceHistory" ph ON ph.station_id = s.id AND ph.recorded_at > ${cutoff}
        WHERE 1=1
          ${dto.voivodeship ? this.prisma.$queryRaw`AND s.voivodeship = ${dto.voivodeship}` : this.prisma.$queryRaw``}
      `;
    } else {
      rows = await this.prisma.station.findMany({
        where: dto.voivodeship ? { voivodeship: dto.voivodeship } : undefined,
        orderBy: { name: 'asc' },
        take: limit,
        skip: offset,
        select: {
          id: true, name: true, address: true, voivodeship: true, brand: true,
        },
      });
      total = BigInt(
        await this.prisma.station.count({
          where: dto.voivodeship ? { voivodeship: dto.voivodeship } : undefined,
        }),
      );
      // Prisma ORM doesn't return lat/lng from geography column directly — raw query for location
      // For simplicity, lat/lng are null when using ORM path; use raw path if coordinates needed
    }

    return {
      data: rows.map((r: any) => ({
        station_id:   r.station_id ?? r.id,
        station_name: r.station_name ?? r.name,
        slug:         r.slug ?? null,
        address:      r.address ?? null,
        voivodeship:  r.voivodeship ?? null,
        lat:          r.lat ?? null,
        lng:          r.lng ?? null,
        brand:        r.brand ?? null,
      })),
      meta: { total: Number(total), limit, offset },
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private mapPriceRow(r: {
    station_id: string;
    station_name: string;
    voivodeship: string | null;
    lat: number | null;
    lng: number | null;
    fuel_type: string;
    price: number;
    recorded_at: Date;
    source: string;
  }): PriceRecord {
    return {
      station_id:   r.station_id,
      station_name: r.station_name,
      voivodeship:  r.voivodeship,
      lat:          r.lat,
      lng:          r.lng,
      fuel_type:    r.fuel_type,
      price_pln:    r.price,
      recorded_at:  r.recorded_at.toISOString(),
      source:       r.source.toLowerCase(),
    };
  }
}
```

---

## DTOs

**File:** `apps/api/src/data-api/dto/index.ts` (new — barrel export)

```typescript
export * from './latest-prices-query.dto';
export * from './price-history-query.dto';
export * from './aggregated-query.dto';
export * from './stations-query.dto';
export * from './create-data-api-key.dto';
```

**File:** `apps/api/src/data-api/dto/latest-prices-query.dto.ts`

```typescript
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export enum FuelType {
  PB_95   = 'PB_95',
  PB_98   = 'PB_98',
  ON      = 'ON',
  ON_PREMIUM = 'ON_PREMIUM',
  LPG     = 'LPG',
}

export class LatestPricesQueryDto {
  @IsOptional()
  @IsString()
  voivodeship?: string;

  @IsOptional()
  @IsEnum(FuelType)
  fuel_type?: FuelType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
```

**File:** `apps/api/src/data-api/dto/price-history-query.dto.ts`

```typescript
import { IsEnum, IsInt, IsISO8601, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { FuelType } from './latest-prices-query.dto';

export class PriceHistoryQueryDto {
  @IsOptional()
  @IsString()
  station_id?: string;

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
  @Max(5000)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
```

**File:** `apps/api/src/data-api/dto/aggregated-query.dto.ts`

```typescript
import { IsEnum, IsISO8601, IsOptional, IsString } from 'class-validator';
import { FuelType } from './latest-prices-query.dto';

export enum Granularity {
  day   = 'day',
  week  = 'week',
  month = 'month',
}

export class AggregatedQueryDto {
  @IsOptional()
  @IsString()
  voivodeship?: string;

  @IsEnum(FuelType)
  fuel_type: FuelType;

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

**File:** `apps/api/src/data-api/dto/stations-query.dto.ts`

```typescript
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class StationsQueryDto {
  @IsOptional()
  @IsString()
  voivodeship?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  has_price_within_days?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2000)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
```

**File:** `apps/api/src/data-api/dto/create-data-api-key.dto.ts`

```typescript
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateDataApiKeyDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  label?: string;
}
```

---

## DataPriceApiController

**File:** `apps/api/src/data-api/data-price-api.controller.ts` (new)

```typescript
import {
  Controller, Get, Query, Res, UseGuards,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { Public } from '../auth/decorators/public.decorator';
import { DataApiKeyGuard } from './data-api-key.guard';
import { DataPriceApiService } from './data-price-api.service';
import {
  LatestPricesQueryDto,
  PriceHistoryQueryDto,
  AggregatedQueryDto,
  StationsQueryDto,
} from './dto';

@Controller('v1/data-api')
@Public()
@UseGuards(DataApiKeyGuard)
export class DataPriceApiController {
  constructor(private readonly service: DataPriceApiService) {}

  /**
   * GET /v1/data-api/prices/latest
   * Latest price per station (DISTINCT ON station_id + fuel_type, ordered by recorded_at DESC).
   * Optional filters: voivodeship, fuel_type. Pagination: limit (max 1000), offset.
   */
  @Get('prices/latest')
  async getLatestPrices(
    @Query() dto: LatestPricesQueryDto,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    res.header('Cache-Control', 'no-store');
    return this.service.getLatestPrices(dto);
  }

  /**
   * GET /v1/data-api/prices/history
   * Raw PriceHistory rows. Requires at least one of station_id or voivodeship.
   * Max date range: 90 days. Pagination: limit (max 5000), offset.
   */
  @Get('prices/history')
  async getPriceHistory(
    @Query() dto: PriceHistoryQueryDto,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    res.header('Cache-Control', 'no-store');
    return this.service.getPriceHistory(dto);
  }

  /**
   * GET /v1/data-api/prices/aggregated
   * Day/week/month aggregates with avg/min/max/count.
   * fuel_type is required. Max date range: 365 days. Default last 30 days.
   */
  @Get('prices/aggregated')
  async getAggregatedPrices(
    @Query() dto: AggregatedQueryDto,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    res.header('Cache-Control', 'no-store');
    return this.service.getAggregatedPrices(dto);
  }

  /**
   * GET /v1/data-api/stations
   * Station master data. Optional: voivodeship filter, has_price_within_days.
   * Pagination: limit (max 2000), offset.
   */
  @Get('stations')
  async getStations(
    @Query() dto: StationsQueryDto,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    res.header('Cache-Control', 'no-store');
    return this.service.getStations(dto);
  }
}
```

---

## Buyer Key Management Endpoints

These endpoints are authenticated via the existing JWT guard (the buyer logs in to manage their own keys). They extend `DataBuyerController` at `apps/api/src/data-buyer/data-buyer.controller.ts`.

### DataBuyerKeysService

**File:** `apps/api/src/data-api/data-buyer-keys.service.ts` (new)

```typescript
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { createHash, randomBytes } from 'crypto';

export interface CreatedDataKeyDto {
  id: string;
  label: string | null;
  key: string;           // full key — shown once
  key_prefix: string;
  created_at: string;
}

export interface DataKeyListItemDto {
  id: string;
  label: string | null;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
}

const MAX_ACTIVE_KEYS = 5;

@Injectable()
export class DataBuyerKeysService {
  constructor(private readonly prisma: PrismaService) {}

  async listKeys(profileId: string): Promise<DataKeyListItemDto[]> {
    const keys = await this.prisma.dataApiKey.findMany({
      where: { profile_id: profileId, revoked_at: null },
      orderBy: { created_at: 'desc' },
      select: { id: true, label: true, key_prefix: true, created_at: true, last_used_at: true },
    });
    return keys.map((k) => ({
      id:           k.id,
      label:        k.label,
      key_prefix:   k.key_prefix,
      created_at:   k.created_at.toISOString(),
      last_used_at: k.last_used_at?.toISOString() ?? null,
    }));
  }

  async createKey(profileId: string, label?: string): Promise<CreatedDataKeyDto> {
    const activeCount = await this.prisma.dataApiKey.count({
      where: { profile_id: profileId, revoked_at: null },
    });
    if (activeCount >= MAX_ACTIVE_KEYS) {
      throw new BadRequestException(`Maximum ${MAX_ACTIVE_KEYS} active API keys per account`);
    }

    const raw    = randomBytes(32).toString('hex');
    const key    = `ddk_${raw}`;
    const keyHash   = createHash('sha256').update(key).digest('hex');
    const keyPrefix = key.slice(0, 12);  // 'ddk_' + first 8 hex chars

    const record = await this.prisma.dataApiKey.create({
      data: {
        profile_id: profileId,
        key_hash:   keyHash,
        key_prefix: keyPrefix,
        label:      label ?? null,
      },
    });

    return {
      id:         record.id,
      label:      record.label,
      key,                  // returned once — never stored in plaintext
      key_prefix: keyPrefix,
      created_at: record.created_at.toISOString(),
    };
  }

  async revokeKey(profileId: string, keyId: string): Promise<void> {
    // updateMany provides implicit ownership check via profile_id
    const result = await this.prisma.dataApiKey.updateMany({
      where: { id: keyId, profile_id: profileId, revoked_at: null },
      data: { revoked_at: new Date() },
    });
    if (result.count === 0) {
      throw new NotFoundException('Key not found or already revoked');
    }
  }
}
```

### Buyer Key Management Endpoints

**Add to `apps/api/src/data-buyer/data-buyer.controller.ts`:**

```typescript
// Add imports
import { Delete, Get, HttpCode, Param, Req } from '@nestjs/common';
import { DataBuyerKeysService, DataKeyListItemDto, CreatedDataKeyDto } from '../data-api/data-buyer-keys.service';
import { CreateDataApiKeyDto } from '../data-api/dto';
import { FastifyRequest } from 'fastify';

// Inject DataBuyerKeysService in constructor

// ── Buyer key management (JWT-authenticated) ──────────────────────────────

/**
 * GET /v1/data-buyers/me/keys
 * Lists active API keys for the authenticated data buyer.
 */
@Get('me/keys')
async listMyKeys(
  @Req() req: FastifyRequest & { user: { dataBuyerProfileId: string } },
): Promise<DataKeyListItemDto[]> {
  return this.keysService.listKeys(req.user.dataBuyerProfileId);
}

/**
 * POST /v1/data-buyers/me/keys
 * Creates a new API key. Returns full key ONCE — store it immediately.
 * Max 5 active keys per account.
 */
@Post('me/keys')
async createMyKey(
  @Req() req: FastifyRequest & { user: { dataBuyerProfileId: string } },
  @Body() dto: CreateDataApiKeyDto,
): Promise<CreatedDataKeyDto> {
  return this.keysService.createKey(req.user.dataBuyerProfileId, dto.label);
}

/**
 * DELETE /v1/data-buyers/me/keys/:keyId
 * Revokes a specific API key. Idempotent — 404 if key not found or already revoked.
 */
@Delete('me/keys/:keyId')
@HttpCode(204)
async revokeMyKey(
  @Req() req: FastifyRequest & { user: { dataBuyerProfileId: string } },
  @Param('keyId') keyId: string,
): Promise<void> {
  return this.keysService.revokeKey(req.user.dataBuyerProfileId, keyId);
}
```

**Note:** `req.user.dataBuyerProfileId` assumes the JWT payload includes `dataBuyerProfileId` for DATA_BUYER role users. If the JWT only includes `userId`, look up the profile ID:

```typescript
const profile = await this.prisma.dataBuyerProfile.findUnique({
  where: { user_id: req.user.sub },
  select: { id: true },
});
if (!profile) throw new NotFoundException('Data buyer profile not found');
```

---

## DataApiModule

**File:** `apps/api/src/data-api/data-api.module.ts` (new)

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { DataApiKeyGuard } from './data-api-key.guard';
import { DataPriceApiService } from './data-price-api.service';
import { DataPriceApiController } from './data-price-api.controller';
import { DataBuyerKeysService } from './data-buyer-keys.service';

@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [DataPriceApiController],
  providers: [DataApiKeyGuard, DataPriceApiService, DataBuyerKeysService],
  exports: [DataApiKeyGuard, DataBuyerKeysService],
})
export class DataApiModule {}
```

**Register `DataApiModule` in `AppModule`** (or whichever root module currently imports `DataBuyerModule`) to ensure the controllers are mounted and the guard is available for import by Story 10.4's module.

**Update `DataBuyerModule`** to import `DataApiModule`:

```typescript
@Module({
  imports: [DataApiModule, ...],
  ...
})
export class DataBuyerModule {}
```

---

## Admin Portal — Keys Column

The existing data buyers list page at `apps/admin/app/(protected)/data-buyers/page.tsx` (Story 10.2) fetches buyer profiles from `GET /v1/admin/data-buyers`. Update the admin API endpoint to include active key count:

**Update `AdminDataBuyerController.list()`:**

```typescript
@Get()
async list(@Query('status') status?: DataBuyerStatus) {
  const profiles = await this.dataBuyerService.listForAdmin(status);
  // Enrich with active key count
  const profileIds = profiles.map((p) => p.id);
  const keyCounts = await this.prisma.dataApiKey.groupBy({
    by: ['profile_id'],
    where: { profile_id: { in: profileIds }, revoked_at: null },
    _count: { id: true },
  });
  const countMap = new Map(keyCounts.map((k) => [k.profile_id, k._count.id]));
  return profiles.map((p) => ({
    ...p,
    activeKeyCount: countMap.get(p.id) ?? 0,
  }));
}
```

**Update `DataBuyerRow.tsx`** to display the `activeKeyCount` as a "Keys" badge in the row.

---

## Migration

**Name:** `add_data_api_key`

```sql
CREATE TABLE "DataApiKey" (
    "id"           TEXT         NOT NULL,
    "profile_id"   TEXT         NOT NULL,
    "key_hash"     TEXT         NOT NULL,
    "key_prefix"   TEXT         NOT NULL,
    "label"        TEXT,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),
    "revoked_at"   TIMESTAMP(3),

    CONSTRAINT "DataApiKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DataApiKey_key_hash_key" ON "DataApiKey"("key_hash");
CREATE INDEX "DataApiKey_profile_id_idx" ON "DataApiKey"("profile_id");

ALTER TABLE "DataApiKey" ADD CONSTRAINT "DataApiKey_profile_id_fkey"
  FOREIGN KEY ("profile_id") REFERENCES "DataBuyerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

This migration unblocks Story 10.2's `approveAccess()` which calls `prisma.dataApiKey.create()`.

---

## Tasks / Subtasks

- [ ] API: Prisma schema — `DataApiKey` model + `DataBuyerProfile.dataApiKeys` relation (AC: 1, 9)
  - [ ] Migration: `add_data_api_key`

- [ ] API: `DataApiKeyGuard` — SHA-256 lookup + profile ACTIVE check + Redis rate limit (300 req/hr) + `req.dataBuyerProfileId` + `req.dataBuyerTier` (AC: 2, 3, 4, 5)
  - [ ] `INCR` + `EXPIRE 3600` Redis pattern with `data_api_rl:{keyId}` key
  - [ ] 429 with `Retry-After: 3600` header

- [ ] API: `DataPriceApiService` — four query methods (AC: 6, 7, 8, 9, 10)
  - [ ] `getLatestPrices()`: `DISTINCT ON (station_id, fuel_type)` raw SQL + voivodeship/fuel_type filters
  - [ ] `getPriceHistory()`: require station_id OR voivodeship; enforce 90-day range; `BadRequestException` on violation
  - [ ] `getAggregatedPrices()`: `DATE_TRUNC` SQL; enforce 365-day range; default last 30 days
  - [ ] `getStations()`: Prisma ORM for unfiltered; raw SQL with JOIN for `has_price_within_days`

- [ ] API: DTOs — `LatestPricesQueryDto`, `PriceHistoryQueryDto`, `AggregatedQueryDto`, `StationsQueryDto`, `CreateDataApiKeyDto` with class-validator decorators (AC: 6, 7, 8, 9, 10)

- [ ] API: `DataPriceApiController` — `@Public() @UseGuards(DataApiKeyGuard)` + 4 GET endpoints + `Cache-Control: no-store` on all responses (AC: 6, 7, 8, 9, 10, 8)

- [ ] API: `DataBuyerKeysService` — `listKeys`, `createKey` (max 5 guard), `revokeKey` (AC: 11, 12)
  - [ ] `createKey()`: `ddk_` + `randomBytes(32).toString('hex')` + SHA-256 hash + `key.slice(0, 12)` prefix
  - [ ] `revokeKey()` uses `updateMany` (ownership check via `profile_id`); throws `NotFoundException` if not found

- [ ] API: Buyer key management endpoints on `DataBuyerController` — `GET/POST /v1/data-buyers/me/keys`, `DELETE /v1/data-buyers/me/keys/:keyId` (AC: 11, 12)
  - [ ] JWT auth only (no `@Public()`) — buyer managing their own keys

- [ ] API: `DataApiModule` — imports `PrismaModule`, `RedisModule`; exports `DataApiKeyGuard`, `DataBuyerKeysService` (Story 10.4 dependency)
  - [ ] Register in `AppModule` or `DataBuyerModule`

- [ ] Admin app: Update `DataBuyerRow.tsx` to show active key count column (AC: no new AC — admin visibility enhancement)

---

## Dev Notes

### `@Public()` + `@UseGuards(DataApiKeyGuard)` Interaction

Identical to the pattern established in Story 9.7 for `ApiKeyGuard`. The global `JwtAuthGuard` (registered as `APP_GUARD`) checks `@Public()` via `Reflector` and returns `true` early. `DataApiKeyGuard` then runs as a controller-level guard and performs full authentication. Guard execution order: global → controller → route. No security gap.

### SHA-256 for Key Hashing

`ddk_` keys are 68 chars (prefix + 64 random hex = 256 bits of entropy). SHA-256 without salt is appropriate — the entropy is too high for rainbow tables. Avoid bcrypt at the guard level; it adds ~100ms per request, which is unacceptable for API integrations. SHA-256 lookup with a `UNIQUE` index is ~0.1ms.

### Redis Rate Limit — 1-Hour Window

The 1-hour window (vs 1-minute for fleet keys) is intentional. Data buyers run batch export jobs that may issue hundreds of requests in a short burst. A 1-minute window would prevent legitimate batching. 300 req/hr allows a full paginated history export (at limit=500 per call, that's 150,000 rows/hr) without abuse potential. The Redis `INCR + EXPIRE` race condition (two simultaneous first-requests both calling `EXPIRE`) is harmless — `EXPIRE` is idempotent.

### `DISTINCT ON` Query Pattern

PostgreSQL's `DISTINCT ON (station_id, fuel_type)` combined with `ORDER BY station_id, fuel_type, recorded_at DESC` returns exactly one row per station+fuel_type pair — the most recent price. This is more efficient than a correlated subquery or window function for this access pattern. The existing `@@index([station_id, fuel_type, recorded_at(sort: Desc)])` on `PriceHistory` (defined in the schema) directly supports this query.

### `prisma.$queryRaw` Conditional Fragments

Prisma's tagged template literal `$queryRaw` does not support conditional fragments natively. The pattern used in the service — `${dto.voivodeship ? this.prisma.$queryRaw\`AND s.voivodeship = ${dto.voivodeship}\` : this.prisma.$queryRaw\`\`}` — requires Prisma v5.0+. If the project uses an older Prisma version, build the WHERE clause as an array of fragments and join with `Prisma.sql`. Alternatively, use separate query methods for each filter combination (less elegant, fully safe).

### `Cache-Control: no-store`

All four data endpoints set `Cache-Control: no-store`. Data buyers pay for fresh data — caching would undermine the value proposition. `no-store` prevents any intermediate proxy or CDN from caching responses. On Fastify, the `@Res({ passthrough: true })` pattern allows setting headers without taking over the response lifecycle.

### `source` Field Mapping

`PriceHistory.source` is a PostgreSQL enum (`PriceSource`) with values `community`, `seeded`, `admin_override`. The guard casts it to `text` in the raw SQL (`ph.source::text`). The service then calls `.toLowerCase()` for consistency in the response. Downstream buyers should treat the value as a lowercase string.

### Buyer Key Management — JWT Profile Resolution

`DataBuyerController` receives JWT-authenticated requests. The JWT payload (from Story 1.1's auth setup) includes `sub` (user ID). To resolve `dataBuyerProfileId`, either:
1. Add `dataBuyerProfileId` to the JWT payload at token creation time (preferred — no extra DB query per request), or
2. Look up `dataBuyerProfile.findUnique({ where: { user_id: req.user.sub } })` on each request (simpler but adds a query)

For MVP, option 2 is acceptable given low buyer volumes.

### Story 10.4 Reuse

`DataApiKeyGuard` is exported from `DataApiModule`. Story 10.4's `DataConsumptionApiController` imports `DataApiModule` and uses `DataApiKeyGuard` directly. Add a tier check at the controller level:

```typescript
@Get('consumption/...')
async getConsumptionData(@Req() req, ...) {
  if (req.dataBuyerTier !== 'CONSUMPTION_DATA' && req.dataBuyerTier !== 'FULL_ACCESS') {
    throw new ForbiddenException('This endpoint requires CONSUMPTION_DATA or FULL_ACCESS tier');
  }
  ...
}
```

The guard itself does not enforce tier — it only authenticates and attaches context. Tier enforcement is controller-level business logic.

### No New Env Vars

This story uses only existing `DATABASE_URL` and `REDIS_URL`. No new environment variables are required.

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
