# Story 3.4: GPS-to-Station Matching

**Status:** ready-for-dev
**Epic:** 3 — Photo Contribution Pipeline
**Created:** 2026-04-02

---

## User Story

As a **developer**,
I want the pipeline worker to match a submission's GPS coordinates to the nearest fuel station,
So that every price submission is correctly attributed to the right station.

**Why:** GPS matching is one of the two critical assumptions validated in the PoC (100% accuracy at ≤100m noise, 87% at 200m). Doing it in the worker — not at submission time — keeps the API fast. Using PostGIS on our local stations table means no external API call per submission.

---

## Acceptance Criteria

### AC1 — GPS query uses PostGIS within 200m radius
**Given** the BullMQ worker picks up a submission job
**When** it runs the GPS matching step
**Then** it queries the `stations` table using `ST_DWithin` with a 200m radius around the submission's GPS coordinates and selects the nearest result

### AC2 — Successful match: station set, candidates returned, GPS nulled
**Given** a matching station is found within 200m
**When** the match succeeds
**Then** `station_id` is set on the `Submission` record with the nearest match
**And** `gps_lat` and `gps_lng` are nulled on the `Submission` — GPS coordinates are never retained after matching
**And** top candidates with their distances are available in-memory for the logo recognition step (Story 3.6) to evaluate ambiguity

### AC3 — No match: reject, delete photo, no retry
**Given** no station is found within 200m
**When** the match fails
**Then** the submission is marked `status: rejected`
**And** `gps_lat`/`gps_lng` are nulled on the `Submission`
**And** the photo is deleted from R2 (best-effort)
**And** the job completes without throwing — no retry is attempted (GPS match failure is a data quality issue, not a transient error)

### AC4 — PostGIS query under 100ms
**Given** the GPS matching query runs
**When** it executes
**Then** it completes in under 100ms using the PostGIS spatial index on `Station.location`

---

## Out of Scope (Story 3.4)

- OCR price extraction → **Story 3.5**
- Logo recognition for station disambiguation → **Story 3.6**
- Price validation and R2 photo deletion after OCR → **Story 3.7**
- Backfilling GPS for existing submissions
- Storing rejection reason in DB (logged only — no schema field needed)

---

## Technical Specification

### 1. Key architectural rules

- **Job payload is `{ submissionId }` only** — worker always fetches Submission from DB; never cache data in BullMQ payload.
- **GPS match failure = complete (not throw)** — BullMQ retries only if the processor throws. GPS failure must be handled gracefully (update DB, delete R2, return) so no retry happens.
- **Transient errors (DB timeout, Redis down) = throw** — these should surface as BullMQ retries.
- **GDPR:** `gps_lat`/`gps_lng` must be nulled after matching completes — including the preselected station path.
- **Idempotency:** if Submission is already non-pending, skip processing and complete silently.

### 2. Files to modify

```
apps/api/src/
├── photo/
│   ├── photo.module.ts                  ← add imports: [StationModule, StorageModule]
│   └── photo-pipeline.worker.ts         ← replace stub processor; inject StationService + StorageService
├── station/
│   └── station.service.ts               ← add findNearbyWithDistance() method
```

**No new files. No schema changes. No migration needed.** (`gps_lat`, `gps_lng`, `station_id` columns already exist from Story 3.3.)

### 3. `StationService` — add `findNearbyWithDistance()`

`findNearestStation()` already exists but returns only the nearest station. Story 3.4 needs multiple candidates with distances for Story 3.6's ambiguity evaluation. Add a new method; do **not** modify the existing one.

New interface (add alongside existing ones):
```typescript
export interface NearbyStationWithDistance {
  id: string;
  name: string;
  address: string | null;
  google_places_id: string | null;
  distance_m: number;
}
```

New method:
```typescript
async findNearbyWithDistance(
  lat: number,
  lng: number,
  radiusMeters = 200,
  limit = 5,
): Promise<NearbyStationWithDistance[]> {
  return this.prisma.$queryRaw<NearbyStationWithDistance[]>`
    SELECT
      id,
      name,
      address,
      google_places_id,
      ST_Distance(location, ST_Point(${lng}, ${lat})::geography) AS distance_m
    FROM "Station"
    WHERE ST_DWithin(location, ST_Point(${lng}, ${lat})::geography, ${radiusMeters})
    ORDER BY location <-> ST_Point(${lng}, ${lat})::geography
    LIMIT ${limit}
  `;
}
```

> **Note on `distance_m` return type:** Postgres returns `ST_Distance` as `float8`. Prisma's `$queryRaw` maps it to `number` in JS — no special handling needed.

### 4. `photo.module.ts` — add module imports

The worker now needs `StationService` and `StorageService`. `PrismaService` is globally provided (PrismaModule is `@Global()`) — no import needed.

```typescript
import { Module } from '@nestjs/common';
import { PhotoPipelineWorker } from './photo-pipeline.worker.js';
import { StationModule } from '../station/station.module.js';
import { StorageModule } from '../storage/storage.module.js';

@Module({
  imports: [StationModule, StorageModule],
  providers: [PhotoPipelineWorker],
  exports: [PhotoPipelineWorker],
})
export class PhotoModule {}
```

### 5. `photo-pipeline.worker.ts` — full replacement

Replace the existing file entirely. Key changes:
- Inject `PrismaService`, `StationService`, `StorageService` via constructor
- Replace stub processor function with GPS matching logic
- Extract `runGpsMatching()` and `rejectSubmission()` private helpers
- Update backoff delays: `[30_000, 120_000, 600_000]` (30s → 2m → 10m)

```typescript
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import { SubmissionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { StationService, type NearbyStationWithDistance } from '../station/station.service.js';

export const PHOTO_PIPELINE_QUEUE = 'photo-pipeline';
export const PHOTO_PIPELINE_JOB = 'process-submission';

export interface PhotoPipelineJobData {
  submissionId: string;
}

// Retry delays: 30s → 2m → 10m (transient infra failures only — GPS match failures do NOT retry)
const BACKOFF_DELAYS_MS = [30_000, 120_000, 600_000] as const;

const JOB_OPTIONS = {
  attempts: 4, // 1 initial + 3 retries
  backoff: { type: 'custom' as const },
} as const;

@Injectable()
export class PhotoPipelineWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PhotoPipelineWorker.name);
  private queue!: Queue;
  private worker!: Worker;
  private redisForBullMQ!: Redis;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly stationService: StationService,
    private readonly storageService: StorageService,
  ) {}

  async onModuleInit(): Promise<void> {
    const redisUrl = this.config.getOrThrow<string>('BULL_REDIS_URL');
    this.redisForBullMQ = new Redis(redisUrl, { maxRetriesPerRequest: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const connection = this.redisForBullMQ as any;

    this.queue = new Queue(PHOTO_PIPELINE_QUEUE, {
      connection,
      defaultJobOptions: JOB_OPTIONS,
    });

    this.worker = new Worker<PhotoPipelineJobData>(
      PHOTO_PIPELINE_QUEUE,
      async (job: Job<PhotoPipelineJobData>) => {
        await this.processJob(job);
      },
      {
        connection,
        settings: {
          backoffStrategy: (attemptsMade: number) =>
            BACKOFF_DELAYS_MS[attemptsMade - 1] ?? BACKOFF_DELAYS_MS[BACKOFF_DELAYS_MS.length - 1],
        },
      },
    );

    this.worker.on('failed', (job: Job | undefined, err: Error) => {
      this.logger.error(
        `Photo pipeline job failed for submission ${job?.data?.submissionId ?? 'unknown'}: ${err.message}`,
      );
    });

    this.logger.log('PhotoPipelineWorker initialised (Story 3.4 GPS matching active)');
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    await this.redisForBullMQ?.quit();
  }

  async enqueue(submissionId: string): Promise<void> {
    await this.queue.add(
      PHOTO_PIPELINE_JOB,
      { submissionId },
      {
        jobId: `photo-${submissionId}`,
        ...JOB_OPTIONS,
      },
    );
  }

  getQueue(): Queue {
    return this.queue;
  }

  // ── Job processor ─────────────────────────────────────────────────────────

  private async processJob(job: Job<PhotoPipelineJobData>): Promise<void> {
    const { submissionId } = job.data;

    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
    });

    if (!submission) {
      this.logger.warn(`Submission ${submissionId} not found — skipping (may have been deleted)`);
      return;
    }

    if (submission.status !== SubmissionStatus.pending) {
      this.logger.log(
        `Submission ${submissionId} already processed (status: ${submission.status}) — skipping`,
      );
      return;
    }

    // Story 3.4: GPS-to-station matching
    const candidates = await this.runGpsMatching(submission);
    if (candidates === null) {
      return; // rejected inside runGpsMatching — do not proceed
    }

    // Story 3.5 (OCR), 3.6 (logo recognition), 3.7 (validation) — stubs
    this.logger.log(
      `Submission ${submissionId}: GPS matched to ${candidates[0]?.name ?? 'preselected'} — OCR/logo/validation deferred to Stories 3.5+`,
    );
  }

  // ── GPS matching step ──────────────────────────────────────────────────────

  /**
   * Returns candidate stations on match, or null if the submission was rejected.
   * Preselected station path (station_id already set): nulls GPS and returns [].
   */
  private async runGpsMatching(
    submission: Awaited<ReturnType<typeof this.prisma.submission.findUnique>> & object,
  ): Promise<NearbyStationWithDistance[] | null> {
    // Preselected station: user already chose a station — just clear GPS per GDPR
    if (submission.station_id !== null) {
      await this.prisma.submission.update({
        where: { id: submission.id },
        data: { gps_lat: null, gps_lng: null },
      });
      this.logger.log(
        `Submission ${submission.id}: preselected station ${submission.station_id} — GPS cleared`,
      );
      return [];
    }

    // No GPS available — cannot match
    if (submission.gps_lat === null || submission.gps_lng === null) {
      await this.rejectSubmission(submission, 'no_gps_coordinates');
      return null;
    }

    // PostGIS match — throws on DB error (BullMQ will retry)
    const candidates = await this.stationService.findNearbyWithDistance(
      submission.gps_lat,
      submission.gps_lng,
    );

    if (candidates.length === 0) {
      await this.rejectSubmission(submission, 'no_station_match');
      return null;
    }

    // Match found — set station, clear GPS
    await this.prisma.submission.update({
      where: { id: submission.id },
      data: {
        station_id: candidates[0].id,
        gps_lat: null,
        gps_lng: null,
      },
    });

    this.logger.log(
      `Submission ${submission.id}: matched to ${candidates[0].name} (${candidates[0].distance_m.toFixed(0)}m away)`,
    );

    return candidates;
  }

  private async rejectSubmission(
    submission: { id: string; photo_r2_key: string | null },
    reason: string,
  ): Promise<void> {
    this.logger.warn(`Submission ${submission.id}: rejected — ${reason}`);

    await this.prisma.submission.update({
      where: { id: submission.id },
      data: {
        status: SubmissionStatus.rejected,
        gps_lat: null,
        gps_lng: null,
      },
    });

    if (submission.photo_r2_key) {
      await this.storageService
        .deleteObject(submission.photo_r2_key)
        .catch((err: Error) =>
          this.logger.error(
            `Failed to delete R2 object ${submission.photo_r2_key} for submission ${submission.id}: ${err.message}`,
          ),
        );
    }
  }
}
```

### 6. Prisma type for `submission.findUnique` return

The private method signature uses an inline return type. A cleaner alternative is to define a type alias at the top of the file:

```typescript
type SubmissionRecord = NonNullable<Awaited<ReturnType<PrismaService['submission']['findUnique']>>>;
```

Then use `SubmissionRecord` in the private method signatures. This avoids importing Prisma-generated types directly and stays in sync with the schema automatically.

### 7. Backoff strategy

| Attempt | Delay |
|---------|-------|
| Retry 1 | 30s   |
| Retry 2 | 2m    |
| Retry 3 | 10m   |

Transient failures (DB down, PostGIS unreachable) will retry. GPS match failures (`no_station_match`, `no_gps_coordinates`) do **not** throw — they complete the job successfully after marking rejection.

---

## Test Requirements

### `apps/api/src/station/station.service.spec.ts` — add tests for `findNearbyWithDistance`

The existing spec tests `findNearestStation`. Add a new `describe('findNearbyWithDistance')` block:

```
it('returns stations sorted by distance within radius')
it('returns empty array when no stations within radius')
it('respects the limit parameter')
it('uses correct lng/lat order in ST_Point (lng first, then lat)')
```

Use `mockPrismaService.$queryRaw.mockResolvedValueOnce(...)`.

### `apps/api/src/photo/photo-pipeline.worker.spec.ts` — replace/extend

The existing spec only covers `enqueue`, `getQueue`, `onModuleDestroy`. Story 3.4 adds a significant `processJob` path. Mock `PrismaService`, `StationService`, `StorageService` in the test module.

Add to `jest.mock` and `Test.createTestingModule`:
```typescript
const mockPrismaService = {
  submission: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

const mockStationService = {
  findNearbyWithDistance: jest.fn(),
};

const mockStorageService = {
  deleteObject: jest.fn(),
};
```

Test cases for `processJob`:

```
describe('processJob — GPS match')
  it('sets station_id to nearest candidate and nulls GPS on match')
  it('returns all candidates in memory for downstream steps')
  it('uses findNearbyWithDistance (not findNearestStation)')

describe('processJob — preselected station')
  it('nulls GPS coords when station_id already set, skips GPS query')
  it('does not call findNearbyWithDistance when station_id is preselected')

describe('processJob — no match')
  it('marks submission as rejected when no station within 200m')
  it('nulls GPS coords on rejection')
  it('deletes photo from R2 on rejection')
  it('completes job without throwing (no BullMQ retry)')

describe('processJob — no GPS coords')
  it('marks submission as rejected when gps_lat is null')
  it('deletes photo from R2 on no-GPS rejection')

describe('processJob — idempotency')
  it('skips processing when submission is already non-pending')
  it('skips processing when submission is not found')

describe('processJob — error propagation')
  it('throws when DB findUnique fails (allows BullMQ retry)')
  it('throws when stationService.findNearbyWithDistance fails (allows BullMQ retry)')

describe('processJob — R2 cleanup resilience')
  it('does not throw when R2 deleteObject fails during rejection')
```

---

## Implementation Notes

- **`$queryRaw` and Prisma type inference:** `$queryRaw` returns `any[]` typed via the generic parameter. The `distance_m` column will be a JS `number` (Postgres `float8` → JS `number` via `pg` driver). If it comes back as a `string` in some pg driver versions, add `Number(row.distance_m)` coercion in the query result mapping.
- **`NearbyStationWithDistance` export:** Must be exported from `station.service.ts` (add `export` keyword to the interface). The worker imports it.
- **`PrismaService` injection:** No module import needed — `PrismaModule` is `@Global()` and exports `PrismaService`.
- **`SubmissionStatus` import:** `import { SubmissionStatus } from '@prisma/client'` — already used in `submissions.service.ts`, same pattern.
- **Private method type:** Use the `SubmissionRecord` alias approach (see §6) for `runGpsMatching` and `rejectSubmission` parameter types. Do not hardcode field names that might drift from the schema.
- **Existing enqueue tests still pass:** The new constructor parameters are injected by NestJS DI. In the test module, add mock providers for `PrismaService`, `StationService`, `StorageService`. The existing `enqueue` / `getQueue` / `onModuleDestroy` tests are unaffected.
- **GPS coordinate order:** PostGIS `ST_Point(lng, lat)` — longitude first, latitude second. This matches the existing `findNearestStation` implementation.
- **Story 3.4 is complete when:** GPS matching runs correctly in the worker, GPS is nulled, station_id is set, no-match rejects with R2 cleanup, all tests pass. Stories 3.5/3.6/3.7 remain stub log lines.

---

## D1 Resolution

Story 3.3 left GPS stored on Submission for async pipeline use. Story 3.4 fully resolves this GDPR debt: `gps_lat`/`gps_lng` are nulled in every execution path (match, preselected, rejected).
