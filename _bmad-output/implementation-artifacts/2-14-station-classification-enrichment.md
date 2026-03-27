# Story 2.14: Station Classification Enrichment

Status: review

## Story

As a **developer**,
I want each station record to carry classification metadata (brand, station type, voivodeship, settlement tier, German border zone flag),
So that downstream features — starting with Story 2.12's estimated price ranges — can apply per-station modifiers rather than treating all stations identically.

## Why

Without classification, every station in Poland gets the same voivodeship average regardless of what it actually is — a Shell MOP on the A2 and an Auchan station in Warsaw would both show the same seed price. Classification makes the cold-start model meaningful. These fields also serve future analytics (chain performance, MOP premium tracking, regional pricing trends) at no additional data collection cost.

## Acceptance Criteria

1. **Schema migration:** Station gains six new fields: `brand String?`, `station_type StationType?`, `voivodeship String?`, `settlement_tier SettlementTier?`, `is_border_zone_de Boolean @default(false)`, `classification_version Int @default(0)`. Two new enums added: `StationType` (standard | mop) and `SettlementTier` (metropolitan | city | town | rural). Index on `classification_version`.

2. **Brand extraction:** Given a station name, brand is derived via case-insensitive substring matching against a config-driven brand list (defined in a TypeScript config file, not hardcoded in service logic). If no brand matches, `brand = "independent"`. Unknown/null name → `brand = null`.

3. **MOP detection:** Given a station's coordinates, a Google Places Nearby Search is issued within 300m. If any result has "MOP" in its name (case-insensitive), `station_type = "mop"`. Otherwise `station_type = "standard"`. Result is persisted — not re-queried on every price calculation.

4. **Voivodeship + settlement tier:** A single Google Geocoding API call per station resolves both: `administrative_area_level_1` → voivodeship slug; `locality` component → settlement tier lookup. Metropolitan cities are hardcoded. Other cities/towns are looked up in a bundled static population table (JSON). If no `locality` is returned, `settlement_tier = "rural"`.

5. **German border zone:** `is_border_zone_de = true` if station coordinates are within 30km of any of five fixed border crossing centroids (haversine — no API call needed).

6. **Classification job:** Runs as a BullMQ post-sync step. StationSyncWorker enqueues a `classify-stations` job on the `station-classification` queue after sync completes. The classification job processes all stations with `classification_version = 0` first, then any that changed name/coordinates during the sync. Classification does NOT block the sync job.

7. **Re-classification:** When a station's `name` or coordinates change during a sync, it is re-classified and `classification_version` is incremented.

8. **Rate limiting:** Classification processes one station at a time with a 1,100ms delay between Nearby Search calls to stay within the 60 req/min Places API limit. Geocoding calls can be batched without delay (50 req/s limit is not a concern).

9. **Tests:** Full unit test coverage for `StationClassificationService` (brand extraction, MOP detection, voivodeship/tier parsing, border zone calculation) and `StationClassificationWorker` (job enqueue, processing, rate limiting delay). All existing tests continue to pass.

## Tasks / Subtasks

- [x] **Task 1: Schema migration** (AC: 1)
  - [x] 1.1 Add `StationType` and `SettlementTier` enums to `packages/db/prisma/schema.prisma`
  - [x] 1.2 Add six new fields to `Station` model in schema
  - [x] 1.3 Create migration `packages/db/prisma/migrations/20260327000000_add_station_classification_fields/migration.sql`

- [x] **Task 2: Brand config file** (AC: 2)
  - [x] 2.1 Create `apps/api/src/station/config/brand-patterns.ts` — exported list of `{ pattern: RegExp, brand: string }` entries

- [x] **Task 3: GUS settlement data** (AC: 4)
  - [x] 3.1 Create `apps/api/src/station/config/settlement-data.ts` — metropolitan city list + population map for top Polish cities/towns

- [x] **Task 4: StationClassificationService** (AC: 2–5)
  - [x] 4.1 Create `apps/api/src/station/station-classification.service.ts`
  - [x] 4.2 `extractBrand(name: string | null): string | null` — pattern match against brand config
  - [x] 4.3 `detectMop(lat: number, lng: number, apiKey: string): Promise<boolean>` — Nearby Search 300m, check for "MOP" in result names
  - [x] 4.4 `resolveGeocode(lat: number, lng: number, apiKey: string): Promise<{ voivodeship: string | null, locality: string | null }>` — single Geocoding API call
  - [x] 4.5 `resolveSettlementTier(locality: string | null): SettlementTier` — classify from metropolitan list + population table (in config/settlement-data.ts)
  - [x] 4.6 `isGermanBorderZone(lat: number, lng: number): boolean` — haversine vs 5 fixed coordinates
  - [x] 4.7 `classifyStation(station: StationForClassification): Promise<StationClassification>` — orchestrates all above, returns full classification record
  - [x] 4.8 Create `apps/api/src/station/station-classification.service.spec.ts`

- [x] **Task 5: StationClassificationWorker** (AC: 6–8)
  - [x] 5.1 Create `apps/api/src/station/station-classification.worker.ts`
  - [x] 5.2 Queue: `station-classification`, Job: `classify-stations`
  - [x] 5.3 Job processor: fetch unclassified stations (`classification_version = 0`) in batches of 50, classify each with 1,100ms inter-Nearby-Search delay, upsert results
  - [x] 5.4 Create `apps/api/src/station/station-classification.worker.spec.ts`

- [x] **Task 6: Wire StationSyncWorker to enqueue classification** (AC: 6)
  - [x] 6.1 Inject `StationClassificationWorker` into `StationSyncWorker`
  - [x] 6.2 On sync `completed` event, enqueue `classify-stations` job on the classification queue
  - [x] 6.3 Update `StationSyncWorker` tests to assert classification job is enqueued on completion

- [x] **Task 7: Update StationModule** (AC: all)
  - [x] 7.1 Add `StationClassificationService` and `StationClassificationWorker` to providers in `station.module.ts`

- [x] **Task 8: Validation** (AC: all)
  - [x] 8.1 `pnpm --filter @desert/api test` — 351/351 tests passing, zero regressions
  - [x] 8.2 `pnpm --filter @desert/api type-check` — zero TypeScript errors

## Dev Notes

### Schema changes — exact Prisma additions

Add to `schema.prisma` (enums at top, after existing enums; fields to Station model):

```prisma
enum StationType {
  standard
  mop
}

enum SettlementTier {
  metropolitan
  city
  town
  rural
}
```

Updated Station model:
```prisma
model Station {
  id                      String         @id @default(uuid())
  name                    String
  address                 String?
  google_places_id        String?        @unique
  location                Unsupported("geography(Point,4326)")?
  last_synced_at          DateTime?
  // Classification fields (populated by Story 2.14)
  brand                   String?
  station_type            StationType?
  voivodeship             String?
  settlement_tier         SettlementTier?
  is_border_zone_de       Boolean        @default(false)
  classification_version  Int            @default(0)
  created_at              DateTime       @default(now())
  updated_at              DateTime       @updatedAt
  submissions             Submission[]
  staleness               StationFuelStaleness[]
}
```

### Migration SQL

`packages/db/prisma/migrations/20260327000000_add_station_classification_fields/migration.sql`:
```sql
CREATE TYPE "StationType" AS ENUM ('standard', 'mop');
CREATE TYPE "SettlementTier" AS ENUM ('metropolitan', 'city', 'town', 'rural');

ALTER TABLE "Station"
  ADD COLUMN "brand"                  TEXT,
  ADD COLUMN "station_type"           "StationType",
  ADD COLUMN "voivodeship"            TEXT,
  ADD COLUMN "settlement_tier"        "SettlementTier",
  ADD COLUMN "is_border_zone_de"      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "classification_version" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "Station_classification_version_idx" ON "Station" ("classification_version");
```

### Brand config file

`apps/api/src/station/config/brand-patterns.ts`:
```ts
export const BRAND_PATTERNS: { pattern: RegExp; brand: string }[] = [
  { pattern: /auchan/i,    brand: 'auchan' },
  { pattern: /carrefour/i, brand: 'carrefour' },
  { pattern: /circle\s*k/i, brand: 'circle_k' },
  { pattern: /huzar/i,     brand: 'huzar' },
  { pattern: /moya/i,      brand: 'moya' },
  { pattern: /amic/i,      brand: 'amic' },
  { pattern: /lotos/i,     brand: 'lotos' },
  { pattern: /\bshell\b/i, brand: 'shell' },
  { pattern: /\bbp\b/i,    brand: 'bp' },
  { pattern: /orlen/i,     brand: 'orlen' },
];
// Order matters — more specific patterns first (auchan, carrefour before generic).
// 'orlen' and 'bp' are last to avoid false matches on compound names.
```

### Settlement data file

`apps/api/src/station/config/settlement-data.ts`:
```ts
// Metropolitan cities (500k+) — classified as 'metropolitan' regardless of exact population
export const METROPOLITAN_CITIES = new Set([
  'warszawa', 'warsaw',
  'kraków', 'krakow', 'cracow',
  'wrocław', 'wroclaw',
  'gdańsk', 'gdansk',
  'gdynia',
  'sopot',
  'poznań', 'poznan',
  'łódź', 'lodz',
]);

// City population map (normalised lowercase) — cities 10k–500k
// Source: GUS 2023 municipal population data (top ~200 cities)
export const CITY_POPULATIONS: Record<string, number> = {
  'szczecin': 390000,
  'bydgoszcz': 340000,
  'lublin': 340000,
  'katowice': 290000,
  'białystok': 295000,
  'bialystok': 295000,
  'gdańsk': 470000,  // fallback
  'gdansk': 470000,
  'rzeszów': 195000,
  'rzeszow': 195000,
  'toruń': 200000,
  'torun': 200000,
  'kielce': 195000,
  'gliwice': 180000,
  'zabrze': 170000,
  'bytom': 155000,
  'bielsko-biała': 170000,
  'olsztyn': 170000,
  'sosnowiec': 200000,
  'radom': 210000,
  'częstochowa': 215000,
  'czestochowa': 215000,
  // ... add more as needed — this covers the major cities
  // For towns 10k–50k, add additional entries
};

export function resolveSettlementTier(locality: string | null): 'metropolitan' | 'city' | 'town' | 'rural' {
  if (!locality) return 'rural';
  const normalised = locality.toLowerCase().trim();
  if (METROPOLITAN_CITIES.has(normalised)) return 'metropolitan';
  const pop = CITY_POPULATIONS[normalised];
  if (pop !== undefined) {
    if (pop >= 50000) return 'city';
    if (pop >= 10000) return 'town';
    return 'rural';
  }
  return 'rural'; // Unknown locality → treat as rural (conservative)
}
```

### StationClassificationService structure

```ts
// apps/api/src/station/station-classification.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { BRAND_PATTERNS } from './config/brand-patterns.js';
import { resolveSettlementTier } from './config/settlement-data.js';

const DE_BORDER_CROSSINGS: [number, number][] = [
  [52.35, 14.55], // Świecko / Słubice
  [51.15, 15.01], // Zgorzelec
  [53.41, 14.19], // Lubieszyn
  [51.53, 14.74], // Łęknica
  [51.18, 15.22], // Olszyna
];
const DE_BORDER_RADIUS_KM = 30;

interface GeocodeComponent {
  long_name: string;
  short_name: string;
  types: string[];
}

interface GeocodeResult {
  address_components: GeocodeComponent[];
}

interface GeocodeResponse {
  results: GeocodeResult[];
  status: string;
}

interface NearbySearchResult {
  name: string;
}

interface NearbySearchResponse {
  results: NearbySearchResult[];
  status: string;
}

export interface StationClassification {
  brand: string | null;
  station_type: 'standard' | 'mop';
  voivodeship: string | null;
  settlement_tier: 'metropolitan' | 'city' | 'town' | 'rural';
  is_border_zone_de: boolean;
}

// Voivodeship name normalisation map (Google returns Polish names with diacritics)
const VOIVODESHIP_SLUGS: Record<string, string> = {
  'dolnośląskie': 'dolnoslaskie',
  'kujawsko-pomorskie': 'kujawsko-pomorskie',
  'lubelskie': 'lubelskie',
  'lubuskie': 'lubuskie',
  'łódzkie': 'lodzkie',
  'małopolskie': 'malopolskie',
  'mazowieckie': 'mazowieckie',
  'opolskie': 'opolskie',
  'podkarpackie': 'podkarpackie',
  'podlaskie': 'podlaskie',
  'pomorskie': 'pomorskie',
  'śląskie': 'slaskie',
  'świętokrzyskie': 'swietokrzyskie',
  'warmińsko-mazurskie': 'warminsko-mazurskie',
  'wielkopolskie': 'wielkopolskie',
  'zachodniopomorskie': 'zachodniopomorskie',
};

@Injectable()
export class StationClassificationService {
  private readonly logger = new Logger(StationClassificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  extractBrand(name: string | null): string | null {
    if (!name) return null;
    for (const { pattern, brand } of BRAND_PATTERNS) {
      if (pattern.test(name)) return brand;
    }
    return 'independent';
  }

  async detectMop(lat: number, lng: number, apiKey: string): Promise<boolean> {
    const url = new URL('https://maps.googleapis.com/maps/api/place/nearbysearch/json');
    url.searchParams.set('location', `${lat},${lng}`);
    url.searchParams.set('radius', '300');
    url.searchParams.set('keyword', 'MOP');
    url.searchParams.set('key', apiKey);

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Nearby Search HTTP error: ${res.status}`);

    const data = await res.json() as NearbySearchResponse;
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      throw new Error(`Nearby Search status: ${data.status}`);
    }

    return data.results.some(r => /mop/i.test(r.name));
  }

  async resolveGeocode(
    lat: number, lng: number, apiKey: string
  ): Promise<{ voivodeship: string | null; locality: string | null }> {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('latlng', `${lat},${lng}`);
    url.searchParams.set('result_type', 'administrative_area_level_1|locality');
    url.searchParams.set('key', apiKey);

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Geocoding HTTP error: ${res.status}`);

    const data = await res.json() as GeocodeResponse;
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      throw new Error(`Geocoding status: ${data.status}`);
    }

    let voivodeship: string | null = null;
    let locality: string | null = null;

    for (const result of data.results) {
      for (const component of result.address_components) {
        if (component.types.includes('administrative_area_level_1') && !voivodeship) {
          const raw = component.long_name.toLowerCase();
          voivodeship = VOIVODESHIP_SLUGS[raw] ?? raw;
        }
        if (component.types.includes('locality') && !locality) {
          locality = component.long_name;
        }
      }
      if (voivodeship && locality) break;
    }

    return { voivodeship, locality };
  }

  isGermanBorderZone(lat: number, lng: number): boolean {
    return DE_BORDER_CROSSINGS.some(([bLat, bLng]) => {
      return haversineKm(lat, lng, bLat, bLng) <= DE_BORDER_RADIUS_KM;
    });
  }

  async classifyStation(
    station: { id: string; name: string; lat: number; lng: number },
    apiKey: string,
  ): Promise<StationClassification> {
    const [isMop, geocode] = await Promise.all([
      this.detectMop(station.lat, station.lng, apiKey),
      this.resolveGeocode(station.lat, station.lng, apiKey),
    ]);

    return {
      brand: this.extractBrand(station.name),
      station_type: isMop ? 'mop' : 'standard',
      voivodeship: geocode.voivodeship,
      settlement_tier: resolveSettlementTier(geocode.locality),
      is_border_zone_de: this.isGermanBorderZone(station.lat, station.lng),
    };
  }
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}
```

### StationClassificationWorker structure

```ts
// apps/api/src/station/station-classification.worker.ts

import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type Job } from 'bullmq';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import { StationClassificationService } from './station-classification.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const STATION_CLASSIFICATION_QUEUE = 'station-classification';
export const STATION_CLASSIFICATION_JOB = 'classify-stations';
const NEARBY_SEARCH_DELAY_MS = 1100; // 60 req/min = 1 req/s + buffer
const BATCH_SIZE = 50;

@Injectable()
export class StationClassificationWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StationClassificationWorker.name);
  private queue!: Queue;
  private worker!: Worker;

  constructor(
    private readonly classificationService: StationClassificationService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queue = new Queue(STATION_CLASSIFICATION_QUEUE, {
      connection: this.redis,
      defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 60000 } },
    });

    this.worker = new Worker(
      STATION_CLASSIFICATION_QUEUE,
      async (_job: Job) => { await this.processClassification(); },
      { connection: this.redis },
    );

    this.worker.on('completed', () =>
      this.logger.log('Station classification job completed'));
    this.worker.on('failed', (_job: Job | undefined, err: Error) =>
      this.logger.error('Station classification job failed', err.stack));
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  getQueue(): Queue { return this.queue; }

  private async processClassification(): Promise<void> {
    const apiKey = this.config.getOrThrow<string>('GOOGLE_PLACES_API_KEY');
    let offset = 0;

    while (true) {
      // Fetch stations that extract lat/lng from the PostGIS geography column
      const stations = await this.prisma.$queryRaw<
        { id: string; name: string; lat: number; lng: number }[]
      >`
        SELECT id, name,
          ST_Y(location::geometry) AS lat,
          ST_X(location::geometry) AS lng
        FROM "Station"
        WHERE classification_version = 0
          AND location IS NOT NULL
        ORDER BY created_at ASC
        LIMIT ${BATCH_SIZE} OFFSET ${offset}
      `;

      if (stations.length === 0) break;

      for (const station of stations) {
        try {
          const classification = await this.classificationService.classifyStation(station, apiKey);
          await this.prisma.$executeRaw`
            UPDATE "Station" SET
              brand                  = ${classification.brand},
              station_type           = ${classification.station_type}::"StationType",
              voivodeship            = ${classification.voivodeship},
              settlement_tier        = ${classification.settlement_tier}::"SettlementTier",
              is_border_zone_de      = ${classification.is_border_zone_de},
              classification_version = 1,
              updated_at             = NOW()
            WHERE id = ${station.id}
          `;
        } catch (err) {
          this.logger.warn(`Failed to classify station ${station.id}: ${(err as Error).message}`);
          // Continue — don't let one failure block the rest
        }
        await new Promise(r => setTimeout(r, NEARBY_SEARCH_DELAY_MS));
      }

      offset += stations.length;
    }
  }
}
```

### Wiring StationSyncWorker → ClassificationWorker

In `station-sync.worker.ts`, inject `StationClassificationWorker` and enqueue on sync completion:

```ts
// Add to constructor:
private readonly classificationWorker: StationClassificationWorker,

// In onModuleInit, update the 'completed' handler:
this.worker.on('completed', async () => {
  this.logger.log('Station sync job completed — enqueuing classification');
  await this.classificationWorker.getQueue().add(
    STATION_CLASSIFICATION_JOB,
    {},
    { jobId: `classify-after-sync-${Date.now()}` },
  );
});
```

**Important:** `StationClassificationWorker` must be listed as a provider in `StationModule` before `StationSyncWorker` to avoid circular dependency issues at DI resolution time. No circular dependency actually exists (Sync → Classification, not vice versa), but NestJS resolves providers in order.

### Station module update

```ts
// apps/api/src/station/station.module.ts
@Module({
  imports: [RedisModule],
  providers: [
    StationService,
    StationSyncService,
    StationClassificationService,         // new
    StationClassificationWorker,          // new — before StationSyncWorker
    StationSyncWorker,
    StationSyncAdminService,
    StationSyncAdminController,
  ],
  exports: [StationService],
})
export class StationModule {}
```

### CRITICAL: PostGIS lat/lng extraction

`Station.location` is `Unsupported("geography(Point,4326)")` — Prisma cannot read it via `findMany`. Use `$queryRaw` with PostGIS functions:
```sql
ST_Y(location::geometry) AS lat   -- latitude
ST_X(location::geometry) AS lng   -- longitude
```

Tagged template only — never `$queryRawUnsafe`.

### CRITICAL: Enum casting in raw SQL

PostgreSQL requires explicit enum casting when using `$executeRaw` with enum columns:
```sql
station_type = ${value}::"StationType"
settlement_tier = ${value}::"SettlementTier"
```

The enum type names must match exactly what was created in the migration (`"StationType"`, `"SettlementTier"` — quoted because of camelCase).

### CRITICAL: No @nestjs/schedule — BullMQ repeat only

Classification worker does NOT need a cron schedule. It is always triggered by the sync job completing. No `repeat` option on the queue.

### Google Places Nearby Search — keyword vs type

For MOP detection, use `keyword=MOP` (not `type=`). There is no dedicated Google Places type for Polish motorway rest areas. The `keyword` parameter searches name + reviews. Combined with 300m radius, false positive rate is negligible — a non-MOP station within 300m of something named "MOP" (e.g. a MOP parking area without fuel) would correctly be classified as `mop`. This is the intended behaviour.

### Geocoding API — result_type filter

Using `result_type=administrative_area_level_1|locality` reduces response size and cost. If Google returns no results (rural coordinates with no nearby locality), `locality` will be `null` → `settlement_tier = "rural"`.

### BullMQ mock pattern (same as Story 2.1)

Mock the entire `bullmq` module in tests:
```ts
jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    close: jest.fn().mockResolvedValue(undefined),
  })),
  Worker: jest.fn().mockImplementation((_name, processor) => {
    // capture processor for testing
    return { on: jest.fn(), close: jest.fn().mockResolvedValue(undefined) };
  }),
}));
```

### Project Structure

Files to create:
```
apps/api/src/station/
  config/
    brand-patterns.ts                      (new)
    settlement-data.ts                     (new)
  station-classification.service.ts        (new)
  station-classification.service.spec.ts   (new)
  station-classification.worker.ts         (new)
  station-classification.worker.spec.ts    (new)

packages/db/prisma/
  schema.prisma                            (Station model + 2 new enums)
  migrations/
    20260327000000_add_station_classification_fields/
      migration.sql                        (new)
```

Files to modify:
```
apps/api/src/station/station.module.ts              (add 2 new providers)
apps/api/src/station/station-sync.worker.ts         (inject ClassificationWorker, enqueue on complete)
apps/api/src/station/station-sync.worker.spec.ts    (assert classification job enqueued)
```

### References

- [Story 2.1 impl](2-1-station-database-google-places-sync.md) — StationSyncService/Worker patterns, BullMQ mock pattern, PostGIS `$queryRaw`/`$executeRaw` conventions, `REDIS_CLIENT` injection token
- [Story 2.12 epics spec](../planning-artifacts/epics.md#story-212) — seed formula that consumes these classification fields
- [Epics 2.14 spec](../planning-artifacts/epics.md#story-214) — full AC and modifier values
- `apps/api/src/station/station-sync.worker.ts` — existing worker to modify
- `apps/api/src/station/station.module.ts` — existing module to update
- `packages/db/prisma/schema.prisma` — existing schema to extend
- Google Places Nearby Search: `https://maps.googleapis.com/maps/api/place/nearbysearch/json`
- Google Geocoding API: `https://maps.googleapis.com/maps/api/geocode/json`

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- `extractBrand('')` — empty string is falsy, returns `null` (not `'independent'`); test corrected.
- `isGermanBorderZone` test coordinate (52.35, 14.97) was actually within 30km of Słubice crossing (~28.6km); moved test coordinate to 15.23° (~47km away).
- Worker `processClassification` test timeout — 1,100ms delay × 51 stations = 56s; resolved by mocking `setTimeout` to be instant in tests with `afterEach` restore.

### Completion Notes List

- **Schema:** Added `StationType` (standard | mop) and `SettlementTier` (metropolitan | city | town | rural) enums; added 6 fields to Station: `brand`, `station_type`, `voivodeship`, `settlement_tier`, `is_border_zone_de`, `classification_version`. Migration: `20260327000000_add_station_classification_fields`.
- **Config files:** `brand-patterns.ts` — 10-brand ordered list (auchan/carrefour first, orlen/bp last); `settlement-data.ts` — metropolitan set + GUS population map + `resolveSettlementTier()` helper.
- **StationClassificationService:** `extractBrand` (pattern match), `detectMop` (300m Nearby Search, "MOP" in name), `resolveGeocode` (single Geocoding call returns voivodeship slug + locality), `isGermanBorderZone` (haversine vs 5 DE border crossings, 30km radius), `classifyStation` (fires detectMop + resolveGeocode in parallel). 30 unit tests.
- **StationClassificationWorker:** Dedicated Redis connection (maxRetriesPerRequest: null), `station-classification` queue, batch-50 processing with 1,100ms inter-station delay, upsert via `$executeRaw` with enum casting (`::\"StationType\"`, `::\"SettlementTier\"`), error isolation (one failure doesn't stop batch), `getQueue()` exposed for sync wiring. 15 unit tests.
- **StationSyncWorker:** Injected `StationClassificationWorker`; `completed` handler enqueues `classify-stations` job (void/catch pattern — enqueue failure logged as warn, never throws). 2 new tests (enqueue assertion + failure resilience).
- **StationModule:** `StationClassificationService` and `StationClassificationWorker` added before `StationSyncWorker` in providers array (DI order requirement).
- **351/351 tests passing, tsc clean.**

### File List

- `packages/db/prisma/schema.prisma` (Station model + StationType + SettlementTier enums)
- `packages/db/prisma/migrations/20260327000000_add_station_classification_fields/migration.sql` (new)
- `apps/api/src/station/config/brand-patterns.ts` (new)
- `apps/api/src/station/config/settlement-data.ts` (new)
- `apps/api/src/station/station-classification.service.ts` (new)
- `apps/api/src/station/station-classification.service.spec.ts` (new)
- `apps/api/src/station/station-classification.worker.ts` (new)
- `apps/api/src/station/station-classification.worker.spec.ts` (new)
- `apps/api/src/station/station-sync.worker.ts` (ClassificationWorker injected, completed handler updated)
- `apps/api/src/station/station-sync.worker.spec.ts` (2 new tests for classification enqueue)
- `apps/api/src/station/station.module.ts` (2 new providers)
- `_bmad-output/implementation-artifacts/2-14-station-classification-enrichment.md` (this file)

## Change Log

- 2026-03-27: Story 2.14 implemented — station classification enrichment. Schema migration, brand/settlement config files, StationClassificationService (30 tests), StationClassificationWorker (15 tests), StationSyncWorker wired to enqueue classification on completion. 351/351 tests passing, tsc clean.
