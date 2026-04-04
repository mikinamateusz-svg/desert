# Story 2.1: Station Database & Google Places Sync

Status: done

## Story

As a **developer**,
I want all Polish fuel stations stored in our database and kept in sync with Google Places,
so that GPS matching and map display work from local data without per-request API calls.

## Why

~8,000 Polish stations in local PostGIS makes GPS-to-station matching fast and cheap (single local query vs. per-submission API call). Weekly Google Places sync keeps data fresh at ~$0 cost (within $200/month free credit). Without this, every photo submission requires a live external API call in the hot path — adding latency, cost, and a point of failure.

## Acceptance Criteria

1. **Given** the sync job runs for the first time, **When** it completes, **Then** all discoverable Polish fuel stations are stored in the `stations` table with name, location (PostGIS `geography` point), address, and Google Places ID.

2. **Given** a station stored in the database, **When** a PostGIS `ST_DWithin` query runs with a 200m radius around a GPS coordinate, **Then** the nearest station within range is returned in under 100ms.

3. **Given** the weekly sync job runs, **When** Google Places returns updated station data, **Then** existing stations are updated and new stations are added — no duplicates created.

4. **Given** the weekly sync job fails (Google Places API unavailable), **When** the failure is detected, **Then** the job retries ×3 with exponential backoff (1 hour → 6 hours → 24 hours). If all retries fail, an ops alert is triggered. Existing station data remains intact. The next scheduled weekly run fires regardless of prior failure.

5. **Given** the stations table, **When** it is queried, **Then** it includes a `last_synced_at` timestamp per station.

## Tasks / Subtasks

### Phase 1 — DB Schema: Extend Station model with PostGIS + sync fields (AC: 1, 2, 5)

- [x] **1.1** Update `packages/db/prisma/schema.prisma` — add three fields to the `Station` model:

  ```prisma
  google_places_id String?   @unique
  location         Unsupported("geography(Point,4326)")?
  last_synced_at   DateTime?
  ```

  Full updated Station model:
  ```prisma
  model Station {
    id               String       @id @default(uuid())
    name             String
    address          String?
    google_places_id String?      @unique
    location         Unsupported("geography(Point,4326)")?
    last_synced_at   DateTime?
    created_at       DateTime     @default(now())
    updated_at       DateTime     @updatedAt
    submissions      Submission[]
  }
  ```

- [x] **1.2** Create migration directory and file `packages/db/prisma/migrations/20260324000000_station_postgis_sync_fields/migration.sql`:

  ```sql
  CREATE EXTENSION IF NOT EXISTS postgis;

  ALTER TABLE "Station" ADD COLUMN IF NOT EXISTS "google_places_id" TEXT UNIQUE;
  ALTER TABLE "Station" ADD COLUMN IF NOT EXISTS "location" geography(Point,4326);
  ALTER TABLE "Station" ADD COLUMN IF NOT EXISTS "last_synced_at" TIMESTAMP(3);

  CREATE INDEX IF NOT EXISTS "Station_location_idx" ON "Station" USING gist("location");
  ```

### Phase 2 — StationService: PostGIS nearest-station query (AC: 2)

- [x] **2.1** Create `apps/api/src/station/station.service.ts`:

  ```ts
  import { Injectable } from '@nestjs/common';
  import { PrismaService } from '../prisma/prisma.service.js';

  export interface NearbyStation {
    id: string;
    name: string;
    address: string | null;
    google_places_id: string | null;
  }

  @Injectable()
  export class StationService {
    constructor(private readonly prisma: PrismaService) {}

    async findNearestStation(lat: number, lng: number, radiusMeters = 200): Promise<NearbyStation | null> {
      const results = await this.prisma.$queryRaw<NearbyStation[]>`
        SELECT id, name, address, google_places_id
        FROM "Station"
        WHERE ST_DWithin(location, ST_Point(${lng}, ${lat})::geography, ${radiusMeters})
        ORDER BY location <-> ST_Point(${lng}, ${lat})::geography
        LIMIT 1
      `;
      return results[0] ?? null;
    }
  }
  ```

- [x] **2.2** Create `apps/api/src/station/station.service.spec.ts`:

  ```ts
  import { Test, TestingModule } from '@nestjs/testing';
  import { StationService } from './station.service.js';
  import { PrismaService } from '../prisma/prisma.service.js';

  const mockPrisma = { $queryRaw: jest.fn() };

  describe('StationService', () => {
    let service: StationService;

    beforeEach(async () => {
      jest.clearAllMocks();
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          StationService,
          { provide: PrismaService, useValue: mockPrisma },
        ],
      }).compile();
      service = module.get<StationService>(StationService);
    });

    describe('findNearestStation', () => {
      it('returns the nearest station when one is within radius', async () => {
        const fakeStation = { id: 'abc', name: 'Orlen', address: 'ul. Test 1', google_places_id: 'gp_1' };
        mockPrisma.$queryRaw.mockResolvedValueOnce([fakeStation]);

        const result = await service.findNearestStation(52.23, 21.01);

        expect(result).toEqual(fakeStation);
        expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
      });

      it('returns null when no station is within radius', async () => {
        mockPrisma.$queryRaw.mockResolvedValueOnce([]);
        const result = await service.findNearestStation(52.23, 21.01);
        expect(result).toBeNull();
      });

      it('uses $queryRaw tagged template (not $queryRawUnsafe)', () => {
        // $queryRaw is called as a tagged template — verify it is not $queryRawUnsafe
        expect(mockPrisma.$queryRaw).toBeDefined();
        expect((mockPrisma as Record<string, unknown>)['$queryRawUnsafe']).toBeUndefined();
      });
    });
  });
  ```

### Phase 3 — StationSyncService: Google Places sync logic (AC: 1, 3)

- [x] **3.1** Create `apps/api/src/station/station-sync.service.ts`:

  ```ts
  import { Injectable, Logger } from '@nestjs/common';
  import { ConfigService } from '@nestjs/config';
  import { PrismaService } from '../prisma/prisma.service.js';

  interface PlacesResult {
    place_id: string;
    name: string;
    vicinity: string;
    geometry: { location: { lat: number; lng: number } };
  }

  interface PlacesResponse {
    results: PlacesResult[];
    next_page_token?: string;
    status: string;
  }

  @Injectable()
  export class StationSyncService {
    private readonly logger = new Logger(StationSyncService.name);

    constructor(
      private readonly prisma: PrismaService,
      private readonly config: ConfigService,
    ) {}

    async runSync(): Promise<void> {
      const apiKey = this.config.getOrThrow<string>('GOOGLE_PLACES_API_KEY');
      const gridPoints = this.buildPolandGrid();
      let upserted = 0;

      for (const [lat, lng] of gridPoints) {
        const stations = await this.fetchStationsAtPoint(lat, lng, apiKey);
        for (const s of stations) {
          await this.upsertStation(s);
          upserted++;
        }
      }

      this.logger.log(`Sync complete: ${upserted} station records processed`);
    }

    buildPolandGrid(): [number, number][] {
      // ~50km grid over Poland bbox (lat 49.0–54.9, lng 14.1–24.2)
      // ~0.45° lat ≈ 50km; ~0.65° lng ≈ 50km at Polish latitudes
      const points: [number, number][] = [];
      for (let lat = 49.2; lat <= 54.8; lat += 0.45) {
        for (let lng = 14.2; lng <= 24.1; lng += 0.65) {
          points.push([
            Math.round(lat * 100) / 100,
            Math.round(lng * 100) / 100,
          ]);
        }
      }
      return points;
    }

    async fetchStationsAtPoint(lat: number, lng: number, apiKey: string): Promise<PlacesResult[]> {
      const results: PlacesResult[] = [];
      let pageToken: string | undefined;

      do {
        const url = new URL('https://maps.googleapis.com/maps/api/place/nearbysearch/json');
        url.searchParams.set('location', `${lat},${lng}`);
        url.searchParams.set('radius', '50000');
        url.searchParams.set('type', 'gas_station');
        url.searchParams.set('key', apiKey);
        if (pageToken) {
          url.searchParams.set('pagetoken', pageToken);
          // Google requires ~2s delay before requesting next_page_token
          await new Promise(r => setTimeout(r, 2000));
        }

        const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
        if (!res.ok) throw new Error(`Places API HTTP error: ${res.status}`);

        const data = await res.json() as PlacesResponse;
        if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
          throw new Error(`Places API status: ${data.status}`);
        }

        results.push(...data.results);
        pageToken = data.next_page_token;
      } while (pageToken);

      return results;
    }

    async upsertStation(s: PlacesResult): Promise<void> {
      await this.prisma.$executeRaw`
        INSERT INTO "Station" (id, name, address, google_places_id, location, last_synced_at, created_at, updated_at)
        VALUES (
          gen_random_uuid()::text,
          ${s.name},
          ${s.vicinity},
          ${s.place_id},
          ST_Point(${s.geometry.location.lng}, ${s.geometry.location.lat})::geography,
          NOW(),
          NOW(),
          NOW()
        )
        ON CONFLICT (google_places_id) DO UPDATE SET
          name = EXCLUDED.name,
          address = EXCLUDED.address,
          location = EXCLUDED.location,
          last_synced_at = NOW(),
          updated_at = NOW()
      `;
    }
  }
  ```

- [x] **3.2** Create `apps/api/src/station/station-sync.service.spec.ts`:

  ```ts
  import { Test, TestingModule } from '@nestjs/testing';
  import { ConfigService } from '@nestjs/config';
  import { StationSyncService } from './station-sync.service.js';
  import { PrismaService } from '../prisma/prisma.service.js';

  global.fetch = jest.fn();

  const mockPrisma = { $executeRaw: jest.fn() };
  const mockConfig = { getOrThrow: jest.fn().mockReturnValue('test-api-key') };

  const makePlacesResponse = (results: object[], nextToken?: string) => ({
    ok: true,
    json: jest.fn().mockResolvedValue({
      status: 'OK',
      results,
      ...(nextToken ? { next_page_token: nextToken } : {}),
    }),
  });

  const fakePlacesResult = {
    place_id: 'gp_1',
    name: 'Orlen',
    vicinity: 'ul. Test 1, Warszawa',
    geometry: { location: { lat: 52.23, lng: 21.01 } },
  };

  describe('StationSyncService', () => {
    let service: StationSyncService;

    beforeEach(async () => {
      jest.clearAllMocks();
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          StationSyncService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: ConfigService, useValue: mockConfig },
        ],
      }).compile();
      service = module.get<StationSyncService>(StationSyncService);
    });

    describe('buildPolandGrid', () => {
      it('returns an array of [lat, lng] pairs within Poland bbox', () => {
        const grid = service.buildPolandGrid();
        expect(grid.length).toBeGreaterThan(100);
        grid.forEach(([lat, lng]) => {
          expect(lat).toBeGreaterThanOrEqual(49.0);
          expect(lat).toBeLessThanOrEqual(55.0);
          expect(lng).toBeGreaterThanOrEqual(14.0);
          expect(lng).toBeLessThanOrEqual(25.0);
        });
      });
    });

    describe('fetchStationsAtPoint', () => {
      it('returns results from a single-page response', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce(makePlacesResponse([fakePlacesResult]));

        const results = await service.fetchStationsAtPoint(52.23, 21.01, 'key');

        expect(results).toHaveLength(1);
        expect(results[0]).toEqual(fakePlacesResult);
        expect(global.fetch).toHaveBeenCalledTimes(1);
      });

      it('paginates when next_page_token is present', async () => {
        (global.fetch as jest.Mock)
          .mockResolvedValueOnce(makePlacesResponse([fakePlacesResult], 'page2token'))
          .mockResolvedValueOnce(makePlacesResponse([{ ...fakePlacesResult, place_id: 'gp_2' }]));

        const results = await service.fetchStationsAtPoint(52.23, 21.01, 'key');

        expect(results).toHaveLength(2);
        expect(global.fetch).toHaveBeenCalledTimes(2);
        // Second call must include pagetoken param
        const secondCallUrl = (global.fetch as jest.Mock).mock.calls[1][0] as string;
        expect(secondCallUrl).toContain('pagetoken=page2token');
      });

      it('throws on non-OK HTTP status', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 500 });
        await expect(service.fetchStationsAtPoint(52.23, 21.01, 'key')).rejects.toThrow('HTTP error: 500');
      });

      it('throws when Places API status is REQUEST_DENIED', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ status: 'REQUEST_DENIED', results: [] }),
        });
        await expect(service.fetchStationsAtPoint(52.23, 21.01, 'key')).rejects.toThrow('REQUEST_DENIED');
      });

      it('returns empty array on ZERO_RESULTS without throwing', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ status: 'ZERO_RESULTS', results: [] }),
        });
        const results = await service.fetchStationsAtPoint(52.23, 21.01, 'key');
        expect(results).toHaveLength(0);
      });
    });

    describe('upsertStation', () => {
      it('calls prisma.$executeRaw once per station', async () => {
        mockPrisma.$executeRaw.mockResolvedValueOnce(1);
        await service.upsertStation(fakePlacesResult);
        expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
      });
    });

    describe('runSync', () => {
      it('calls upsertStation for each result across grid points', async () => {
        jest.spyOn(service, 'buildPolandGrid').mockReturnValue([[52.23, 21.01]]);
        jest.spyOn(service, 'fetchStationsAtPoint').mockResolvedValue([fakePlacesResult]);
        jest.spyOn(service, 'upsertStation').mockResolvedValue(undefined);

        await service.runSync();

        expect(service.fetchStationsAtPoint).toHaveBeenCalledWith(52.23, 21.01, 'test-api-key');
        expect(service.upsertStation).toHaveBeenCalledWith(fakePlacesResult);
      });
    });
  });
  ```

### Phase 4 — BullMQ Worker: Scheduled sync + retry + ops alert (AC: 4)

- [x] **4.1** Create `apps/api/src/station/station-sync.worker.ts`:

  ```ts
  import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject } from '@nestjs/common';
  import { ConfigService } from '@nestjs/config';
  import { Queue, Worker, type Job } from 'bullmq';
  import type Redis from 'ioredis';
  import { REDIS_CLIENT } from '../redis/redis.module.js';
  import { StationSyncService } from './station-sync.service.js';

  export const STATION_SYNC_QUEUE = 'station-sync';
  export const STATION_SYNC_JOB = 'run-sync';

  // Retry delays: 1h → 6h → 24h (in ms)
  const RETRY_DELAYS = [
    1 * 60 * 60 * 1000,
    6 * 60 * 60 * 1000,
    24 * 60 * 60 * 1000,
  ] as const;

  @Injectable()
  export class StationSyncWorker implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(StationSyncWorker.name);
    private queue!: Queue;
    private worker!: Worker;

    constructor(
      private readonly syncService: StationSyncService,
      @Inject(REDIS_CLIENT) private readonly redis: Redis,
    ) {}

    async onModuleInit(): Promise<void> {
      const connection = this.redis;

      this.queue = new Queue(STATION_SYNC_QUEUE, { connection });

      // Schedule weekly sync: every Sunday at 02:00 UTC
      // jobId ensures only one repeat entry exists in Redis (idempotent on restart)
      await this.queue.add(
        STATION_SYNC_JOB,
        {},
        {
          repeat: { pattern: '0 2 * * 0' },
          jobId: 'weekly-station-sync',
          attempts: 4, // 1 initial + 3 retries
          backoff: { type: 'custom' },
        },
      );

      this.worker = new Worker(
        STATION_SYNC_QUEUE,
        async (_job: Job) => {
          await this.syncService.runSync();
        },
        {
          connection,
          settings: {
            backoffStrategy: (attemptsMade: number): number =>
              RETRY_DELAYS[attemptsMade - 1] ?? RETRY_DELAYS[RETRY_DELAYS.length - 1],
          },
        },
      );

      this.worker.on('completed', () => {
        this.logger.log('Station sync job completed successfully');
      });

      this.worker.on('failed', (job: Job | undefined, err: Error) => {
        const attemptsMade = job?.attemptsMade ?? 0;
        const maxAttempts = job?.opts?.attempts ?? 1;
        const willRetry = attemptsMade < maxAttempts;

        if (!willRetry) {
          // All retries exhausted — ops alert required
          this.logger.error(
            `Station sync FAILED after ${attemptsMade} attempts — manual intervention required`,
            err.stack,
          );
        } else {
          this.logger.warn(
            `Station sync attempt ${attemptsMade} failed — retrying (${maxAttempts - attemptsMade} left)`,
            err.message,
          );
        }
      });

      this.logger.log('StationSyncWorker initialised — weekly sync scheduled (Sundays 02:00 UTC)');
    }

    async onModuleDestroy(): Promise<void> {
      await this.worker?.close();
      await this.queue?.close();
    }

    /** Exposed for integration tests and manual trigger from ops */
    getQueue(): Queue {
      return this.queue;
    }
  }
  ```

- [x] **4.2** Create `apps/api/src/station/station-sync.worker.spec.ts`:

  ```ts
  import { Test, TestingModule } from '@nestjs/testing';
  import { Logger } from '@nestjs/common';
  import { StationSyncWorker, STATION_SYNC_QUEUE, STATION_SYNC_JOB } from './station-sync.worker.js';
  import { StationSyncService } from './station-sync.service.js';
  import { REDIS_CLIENT } from '../redis/redis.module.js';

  // Mock BullMQ entirely
  const mockQueueAdd = jest.fn().mockResolvedValue(undefined);
  const mockQueueClose = jest.fn().mockResolvedValue(undefined);
  const mockWorkerClose = jest.fn().mockResolvedValue(undefined);
  const mockWorkerOn = jest.fn();
  let capturedProcessor: ((job: unknown) => Promise<void>) | undefined;
  let capturedWorkerEvents: Record<string, (...args: unknown[]) => void> = {};

  jest.mock('bullmq', () => ({
    Queue: jest.fn().mockImplementation(() => ({
      add: mockQueueAdd,
      close: mockQueueClose,
    })),
    Worker: jest.fn().mockImplementation((_name: string, processor: (job: unknown) => Promise<void>) => {
      capturedProcessor = processor;
      return {
        on: (event: string, handler: (...args: unknown[]) => void) => {
          capturedWorkerEvents[event] = handler;
        },
        close: mockWorkerClose,
      };
    }),
  }));

  const mockSyncService = { runSync: jest.fn().mockResolvedValue(undefined) };
  const mockRedis = {};

  describe('StationSyncWorker', () => {
    let worker: StationSyncWorker;

    beforeEach(async () => {
      jest.clearAllMocks();
      capturedWorkerEvents = {};
      capturedProcessor = undefined;

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          StationSyncWorker,
          { provide: StationSyncService, useValue: mockSyncService },
          { provide: REDIS_CLIENT, useValue: mockRedis },
        ],
      }).compile();

      worker = module.get<StationSyncWorker>(StationSyncWorker);
      await worker.onModuleInit();
    });

    it('creates Queue with correct name', () => {
      const { Queue } = jest.requireMock<{ Queue: jest.Mock }>('bullmq');
      expect(Queue).toHaveBeenCalledWith(STATION_SYNC_QUEUE, { connection: mockRedis });
    });

    it('schedules repeat job with correct cron, attempts, and custom backoff', () => {
      expect(mockQueueAdd).toHaveBeenCalledWith(
        STATION_SYNC_JOB,
        {},
        expect.objectContaining({
          repeat: { pattern: '0 2 * * 0' },
          attempts: 4,
          backoff: { type: 'custom' },
        }),
      );
    });

    it('job processor calls syncService.runSync', async () => {
      expect(capturedProcessor).toBeDefined();
      await capturedProcessor!({});
      expect(mockSyncService.runSync).toHaveBeenCalledTimes(1);
    });

    it('logs error (not warn) when all retries are exhausted', () => {
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      const failedHandler = capturedWorkerEvents['failed'];
      failedHandler({ attemptsMade: 4, opts: { attempts: 4 } }, new Error('API down'));

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('manual intervention'), expect.anything());
      expect(warnSpy).not.toHaveBeenCalled();
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it('logs warn (not error) on intermediate failure', () => {
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      const failedHandler = capturedWorkerEvents['failed'];
      failedHandler({ attemptsMade: 1, opts: { attempts: 4 } }, new Error('timeout'));

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('retrying'), expect.anything());
      expect(errorSpy).not.toHaveBeenCalled();
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it('closes worker and queue on destroy', async () => {
      await worker.onModuleDestroy();
      expect(mockWorkerClose).toHaveBeenCalledTimes(1);
      expect(mockQueueClose).toHaveBeenCalledTimes(1);
    });
  });
  ```

### Phase 5 — StationModule + AppModule registration (AC: all)

- [x] **5.1** Create `apps/api/src/station/station.module.ts`:

  ```ts
  import { Module } from '@nestjs/common';
  import { StationService } from './station.service.js';
  import { StationSyncService } from './station-sync.service.js';
  import { StationSyncWorker } from './station-sync.worker.js';
  import { RedisModule } from '../redis/redis.module.js';

  @Module({
    imports: [RedisModule],
    providers: [StationService, StationSyncService, StationSyncWorker],
    exports: [StationService],
  })
  export class StationModule {}
  ```

- [x] **5.2** Add `StationModule` to the `imports` array in `apps/api/src/app.module.ts` (after `FeedbackModule`). Add import statement: `import { StationModule } from './station/station.module.js';`

- [x] **5.3** Check if `apps/api/.env.example` exists. If yes, add `GOOGLE_PLACES_API_KEY=` entry. If `.env.example` does not exist, document the new var in a comment in `apps/api/src/station/station-sync.service.ts`.

### Phase 6 — Validation (AC: all)

- [x] **6.1** Run `pnpm --filter @desert/api test` — all existing 106 tests plus new tests must pass.
- [x] **6.2** Run `pnpm --filter @desert/api type-check` — zero TypeScript errors.

## Dev Notes

### CRITICAL: No @nestjs/schedule — Use BullMQ Repeat

`@nestjs/schedule` is **NOT installed**. Do not add it. BullMQ 5.71.0 is already installed and provides cron repeat scheduling via `Queue.add({ repeat: { pattern: '...' } })`. The cron `0 2 * * 0` = every Sunday at 02:00 UTC.

### CRITICAL: PostGIS via $queryRaw / $executeRaw (tagged templates only)

Prisma does not natively support PostGIS types. Use:
- `prisma.$queryRaw<T>` tagged template for SELECT
- `prisma.$executeRaw` tagged template for INSERT/UPDATE with ST_Point

**Never** use `$queryRawUnsafe` or `$executeRawUnsafe` — SQL injection risk. Tagged template syntax auto-parameterises all interpolated values.

### CRITICAL: Station.location is Unsupported type — no Prisma-level reads

```prisma
location Unsupported("geography(Point,4326)")?
```
Prisma generates no TypeScript type for this column. You cannot read `location` via `prisma.station.findMany()` — all PostGIS operations go through raw SQL tagged templates.

### CRITICAL: Migration must enable PostGIS extension first

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
```
Must be the **first statement** in the migration SQL. Project is on Neon (PostgreSQL 15) — PostGIS extension is available.

### BullMQ v5: backoffStrategy is on Worker options, not Job options

```ts
// On Worker constructor options:
settings: {
  backoffStrategy: (attemptsMade: number): number => { ... }
}
// On job add options:
backoff: { type: 'custom' }  // activates the worker's custom strategy
```

`attemptsMade` starts at 1 after first failure, so `delays[attemptsMade - 1]` gives:
- 1st failure → `delays[0]` = 1h
- 2nd failure → `delays[1]` = 6h
- 3rd failure → `delays[2]` = 24h

### BullMQ Repeat Job Idempotency

`jobId: 'weekly-station-sync'` ensures only one scheduled entry exists in Redis. Safe to call `queue.add` with the same `jobId` on every app restart — BullMQ deduplicates.

### Google Places Nearby Search API

Classic Nearby Search (not Places API New):
```
GET https://maps.googleapis.com/maps/api/place/nearbysearch/json
  ?location={lat},{lng}&radius=50000&type=gas_station&key={API_KEY}
```
- 20 results per page; paginate via `next_page_token` field in response
- **Mandatory 2s delay** before requesting next page (Google API requirement)
- Throw on HTTP error or status not `OK`/`ZERO_RESULTS`
- Use `AbortSignal.timeout(10000)` for per-request timeout (Node.js 18+)

### Poland Grid Coverage

bbox: lat 49.0–54.9, lng 14.1–24.2 | step: 0.45° lat / 0.65° lng ≈ 50km
Produces ~156 grid points → ~450 API calls (avg 3 pages per point) → fits within $200/month free credit.

### Redis Connection Pattern

```ts
import { REDIS_CLIENT } from '../redis/redis.module.js';
// In constructor:
@Inject(REDIS_CLIENT) private readonly redis: Redis
```
Do NOT create a new ioredis instance — reuse the existing singleton from RedisModule.

### gen_random_uuid() in Raw SQL

Available in PostgreSQL 13+ (Neon uses PostgreSQL 15). No `pgcrypto` extension needed.

### Testing BullMQ

Mock the entire `bullmq` module with `jest.mock('bullmq', ...)` before imports. Capture the `Worker` processor and event handlers for testing. See task 4.2 for the full mock pattern.

### New Env Var

`GOOGLE_PLACES_API_KEY` — required for StationSyncService. Add to Railway environment and `.env.example`.

### Project Structure Notes

```
apps/api/src/station/
  station.module.ts
  station.service.ts
  station.service.spec.ts
  station-sync.service.ts
  station-sync.service.spec.ts
  station-sync.worker.ts
  station-sync.worker.spec.ts

packages/db/prisma/
  schema.prisma                  (Station model updated)
  migrations/
    20260324000000_station_postgis_sync_fields/
      migration.sql
```

AppModule: add `StationModule` import (follows existing pattern — same level as FeedbackModule).

### References

- Architecture: `_bmad-output/planning-artifacts/architecture.md` — PostGIS query, BullMQ, StationModule, Google Places grid
- Epics: `_bmad-output/planning-artifacts/epics.md#Story-2.1`
- BullMQ installed: `apps/api/package.json` (`bullmq@5.71.0`, `ioredis@^5.10.1`)
- Redis module / REDIS_CLIENT token: `apps/api/src/redis/redis.module.ts`
- Test pattern reference: `apps/api/src/feedback/feedback.service.spec.ts`
- Existing Station model: `packages/db/prisma/schema.prisma`
- Existing migrations: `packages/db/prisma/migrations/` (5 migrations present)
- AppModule: `apps/api/src/app.module.ts`

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- ioredis version mismatch (API uses 5.10.1, BullMQ bundles 5.9.3) caused TS2322 on `connection` param. Resolved in code review P5 by creating a dedicated ioredis connection in the worker (maxRetriesPerRequest: null).

### Completion Notes List

- Phase 1: Extended `Station` Prisma model with `google_places_id`, `location` (PostGIS `Unsupported`), `last_synced_at`. Created migration enabling PostGIS extension + spatial index.
- Phase 2: `StationService.findNearestStation` uses `$queryRaw` tagged template with ST_DWithin + ST_Point for 200m radius lookup.
- Phase 3: `StationSyncService` implements Poland grid (~806 points, 0.22°/0.32° step, 25km radius), Google Places Nearby Search pagination, upsert via `$executeRaw` with `ON CONFLICT (google_places_id)`.
- Phase 4: `StationSyncWorker` registers BullMQ Queue + Worker on `onModuleInit`. Weekly cron `0 2 * * 0` (Sunday 02:00 UTC). Custom backoff 1h→6h→24h via `backoffStrategy` on Worker options. `attempts: 4`. Ops alert on exhaustion via Logger.error.
- Phase 5: `StationModule` wired into `AppModule`. `GOOGLE_PLACES_API_KEY` added to `.env.example`.
- Phase 6: 141/141 tests passing. `tsc --noEmit` clean.
- Code review patches applied 2026-03-24: P1 per-point error isolation (try/catch, log+skip), P2 grid 0.22°/0.32° + radius 25000m, P3 200ms inter-grid delay, P4 key-in-URL comment, P5 dedicated Redis connection (maxRetriesPerRequest: null), P6 defaultJobOptions on Queue, P7 geometry null guard. 145/145 tests passing, tsc clean.

### File List

- `packages/db/prisma/schema.prisma` (Station model extended)
- `packages/db/prisma/migrations/20260324000000_station_postgis_sync_fields/migration.sql`
- `apps/api/src/station/station.module.ts`
- `apps/api/src/station/station.service.ts`
- `apps/api/src/station/station.service.spec.ts`
- `apps/api/src/station/station-sync.service.ts`
- `apps/api/src/station/station-sync.service.spec.ts`
- `apps/api/src/station/station-sync.worker.ts`
- `apps/api/src/station/station-sync.worker.spec.ts`
- `apps/api/src/app.module.ts` (StationModule added)
- `apps/api/.env.example` (GOOGLE_PLACES_API_KEY added)

### Change Log

- 2026-03-24: Story 2.1 implemented — Station DB schema with PostGIS, Google Places sync worker, BullMQ weekly cron, 141/141 tests passing, tsc clean.
- 2026-03-24: Code review patches P1–P7 applied — per-point isolation, 25km grid, inter-grid delay, geometry null guard, dedicated Redis connection, defaultJobOptions. 145/145 tests passing, tsc clean.

## Review Notes (2026-04-04)

No new patches. Prior review applied all patches — see sprint-status.yaml for details.
