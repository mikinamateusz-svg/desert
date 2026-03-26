# Story 2.9 — Redis Price Cache

## Status
review

## Story
As a **developer**,
I want price data served from Redis cache rather than hitting PostgreSQL on every request,
So that the map loads within 3 seconds even under high concurrent load.

**Why:** Price data is read thousands of times per day but changes only 1–2 times per station per day. Without a cache, every map load hits the database — at 100K+ MAU with concurrent rush-hour traffic, this becomes a bottleneck fast. Redis is already in the stack for BullMQ, so this costs nothing extra in infrastructure.

## Acceptance Criteria

**AC1 — Cache hit:**
**Given** a price is requested for a station
**When** it exists in Redis cache
**Then** it is returned from cache without a database price query (sub-millisecond response)

**AC2 — Cache miss:**
**Given** a price is requested for a station
**When** it is not in Redis cache (cache miss)
**Then** it is fetched from PostgreSQL, returned to the caller, and written to Redis for subsequent requests

**AC3 — Atomic invalidation on price verify:**
**Given** a new price is verified (e.g. by OCR pipeline)
**When** the database is updated
**Then** the Redis cache for that station is invalidated and rewritten atomically in the same operation — stale cache is never served after a verified update

**AC4 — 24h TTL safety fallback:**
**Given** a cached price entry
**When** 24 hours have elapsed with no update
**Then** the TTL expires and the next request fetches fresh data from PostgreSQL — the TTL is a safety fallback, not the primary freshness mechanism

**AC5 — Redis unavailable fallback:**
**Given** Redis is unavailable
**When** a price request is made
**Then** the API falls back to PostgreSQL directly — the app remains functional with no user-facing error

## Tasks/Subtasks

- [x] Task 1: Create `PriceCacheService` with per-station cache operations
  - [x] 1a: `getMany(stationIds)` — MGET all station price keys, returns Map<id, row|null>
  - [x] 1b: `set(stationId, data)` — SET with 24h TTL (write on miss)
  - [x] 1c: `setAtomic(stationId, data)` — MULTI: DEL + SETEX (for verified price updates, AC3)
  - [x] 1d: `invalidate(stationId)` — DEL (for cache invalidation without rewrite)
  - [x] 1e: JSON serialize/deserialize StationPriceRow (Date ↔ ISO string)

- [x] Task 2: Refactor `PriceService.findPricesInArea` to use cache (AC1–AC5)
  - [x] 2a: Extract `findStationIdsInArea(lat, lng, radius)` — spatial query only (PostGIS)
  - [x] 2b: Extract `findPricesByStationIds(stationIds)` — DISTINCT ON filtered by station IDs
  - [x] 2c: Implement read-through cache in `findPricesInArea`: station IDs → MGET → DB for misses → write misses to cache
  - [x] 2d: Redis error fallback: on MGET failure, use `findPricesByStationIds` (ids already known)

- [x] Task 3: Add `setVerifiedPrice(stationId, data)` on `PriceService` for future OCR pipeline (AC3)

- [x] Task 4: Update `PriceModule` — import `RedisModule`, provide `PriceCacheService`

- [x] Task 5: Write `price-cache.service.spec.ts` — unit tests for all cache operations

- [x] Task 6: Update `price.service.spec.ts` — cover cache hit, cache miss, fallback, empty area

## Dev Notes

### Architecture
- Cache key: `price:station:{stationId}` (per-station, 24h TTL = 86400s)
- `REDIS_CLIENT` injection token from `apps/api/src/redis/redis.module.ts`
- Use ioredis `mget(keys[])` for bulk get, `multi().del().setex().exec()` for atomic write
- `PriceCacheService` lives in the `price` module (domain-specific)

### Query split rationale
`findPricesInArea` currently does one combined DISTINCT ON query (station discovery + price fetch). Splitting into two enables per-station caching:
1. `findStationIdsInArea` — cheap spatial query, always hits DB (PostGIS index makes this fast)
2. `findPricesByStationIds` — DISTINCT ON, only for cache-missed stations; uses `Prisma.join` for parameterised IN clause

### Fallback hierarchy
1. Redis available: station IDs from DB → MGET → DB for misses → cache misses → return all
2. Redis MGET throws: station IDs already known → `findPricesByStationIds(stationIds)` → return (no caching)
3. Redis SET throws on miss-write: swallow error, return result anyway

### setVerifiedPrice
Called by OCR worker (Story 2.10+) when a submission is verified. Not wired to a caller yet in this story — just the hook needs to exist on `PriceService`.

### Prisma IN clause
Dynamic `IN (...)` requires `Prisma.sql` + `Prisma.join`:
```ts
import { Prisma } from '@prisma/client';
this.prisma.$queryRaw<StationPriceRow[]>(
  Prisma.sql`SELECT ... WHERE station_id IN (${Prisma.join(stationIds)}) ...`
)
```

## Dev Agent Record

### Implementation Plan
- Create `price-cache.service.ts` with ioredis MGET/SET/MULTI operations
- Refactor `price.service.ts`: split query + add cache read-through
- Update `price.module.ts`: add RedisModule import + PriceCacheService provider
- Tests: full coverage of cache hit/miss/fallback/atomic paths

### Debug Log
_empty_

### Completion Notes
- `PriceCacheService`: per-station Redis cache with `getMany` (MGET), `set` (SETEX, errors swallowed), `setAtomic` (MULTI DEL+SETEX for verified writes), `invalidate` (DEL). Key: `price:station:{stationId}`, TTL: 86400s (24h).
- `PriceService.findPricesInArea`: split into station discovery (`findStationIdsInArea` — PostGIS spatial query) + price fetch (`findPricesByStationIds` — DISTINCT ON by IDs). Read-through: MGET → DB for misses → cache misses. Fallback: on MGET error, use `findPricesByStationIds` directly.
- `PriceService.setVerifiedPrice`: delegates to `PriceCacheService.setAtomic` — hook for OCR pipeline (Story 2.10+).
- `PriceModule`: imports `RedisModule`, provides `PriceCacheService`.
- 23 new tests (14 cache service + 9 service). 302 total, 0 regressions.

## File List
- apps/api/src/price/price-cache.service.ts (new)
- apps/api/src/price/price-cache.service.spec.ts (new)
- apps/api/src/price/price.service.ts (modified)
- apps/api/src/price/price.service.spec.ts (modified)
- apps/api/src/price/price.module.ts (modified)
- _bmad-output/implementation-artifacts/2-9-redis-price-cache.md (new)

## Change Log
- 2026-03-26: Story 2.9 implemented — Redis per-station price cache with read-through, 24h TTL, atomic verified-price writes, and DB fallback on Redis unavailability.
