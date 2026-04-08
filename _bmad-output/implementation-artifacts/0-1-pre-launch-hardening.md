# Story 0.1 — Pre-Launch Technical Hardening

**Epic:** 0 (cross-cutting)
**Story ID:** hardening-1
**Status:** ready-for-dev
**Depends on:** Stories 1.9, 1.12, 2.3, 2.8, 3.x pipeline, 6.3, web-5

---

## Overview

This story bundles 8 small hardening fixes that were explicitly deferred during code reviews of Phase 1 stories. Each fix is too small to justify a standalone story, but all are required before public launch. They are grouped here for a single focused development pass.

**Why bundled?** All 8 items share the same risk profile: they are low-complexity changes with no new user-facing behaviour, each carrying a concrete pre-launch risk if left unresolved (unenforced rate limits, missing DB indexes, stale push token accumulation, shared BullMQ connections). Bundling avoids 8 separate story overheads while keeping ACs and technical specs precisely documented per fix.

---

## Acceptance Criteria

### AC-1: ThrottlerGuard registered as global APP_GUARD

- `ThrottlerGuard` is added to the `providers` array in `app.module.ts` as an `APP_GUARD`
- `POST /v1/me/export` enforces its existing `@Throttle()` limit (rejects over-limit requests with HTTP 429)
- `POST /v1/feedback` enforces its existing `@Throttle()` limit (rejects over-limit requests with HTTP 429)
- All existing `@Public()` endpoints remain accessible without authentication — `ThrottlerGuard` does not require auth
- `ThrottlerGuard` is registered **before** `JwtAuthGuard` in the providers array so rate limiting applies to unauthenticated requests

### AC-2: Submission partial index on (station_id, created_at DESC) WHERE status='verified'

- Migration `add_submission_price_index` exists under `packages/db/prisma/migrations/`
- The migration creates index `idx_submission_station_verified` on `Submission(station_id, created_at DESC)` WHERE `status = 'verified'`
- Index is created with `CONCURRENTLY` (non-blocking on live data)
- Migration file is structured to allow the `CONCURRENTLY` statement to run outside a transaction (see Dev Notes)

### AC-3: DB-level DEFAULT now() on all updated_at columns

- Migration `add_updated_at_defaults` exists under `packages/db/prisma/migrations/`
- All tables with an `updated_at @updatedAt` column have `DEFAULT now()` set at the DB level
- Migration is additive — no data altered, no columns dropped
- A raw SQL `INSERT` without specifying `updated_at` on any of the affected tables uses `now()` as the default

### AC-4: Stale Expo push token cleared on DeviceNotRegistered

- In `apps/api/src/alert/alert.service.ts`, the `DeviceNotRegistered` branch in `sendInChunks()` issues a `prisma.notificationPreference.updateMany()` to set `expo_push_token: null` for the affected token
- The call uses `updateMany` (defensive — handles the edge case of multiple rows sharing a token)
- A `warn`-level log is emitted after clearing (not `error` — this is expected behaviour for uninstalled apps)
- The existing `error`-level log for other ticket errors (`ticket.message`) is preserved
- Subsequent alert runs skip the cleared token (query already filters `expo_push_token: { not: null }`)

### AC-5: GET /v1/market-signal/summary is rate-limited

- `MarketSignalController.getSummary()` has `@Throttle({ default: { limit: 60, ttl: 60000 } })` applied
- The endpoint remains `@Public()` — no auth required
- Requests exceeding 60 per minute from the same IP receive HTTP 429

### AC-6: BullMQ workers use separate Redis connections for Queue and Worker

- All 6 BullMQ workers use separate ioredis instances for `Queue` and `Worker`
- The Worker's ioredis instance has `maxRetriesPerRequest: null`
- The Queue's ioredis instance has `maxRetriesPerRequest: null` (consistent; BullMQ tolerates it on Queue side)
- `onModuleDestroy` closes both connections
- Queue names, job names, cron schedules, retry logic, and job IDs are unchanged

### AC-7: getStaleFuelTypes ignores flags older than 7 days

- `StalenessDetectionService.getStaleFuelTypes()` filters results to only include `StationFuelStaleness` records where `flagged_at >= now() - 7 days`
- Flags older than 7 days are silently ignored (not deleted)
- No migration is needed
- `clearStaleFlag()` and `detectStaleness()` are unchanged

### AC-8: PriceHistory index on (station_id, fuel_type, recorded_at DESC)

- The schema at `packages/db/prisma/schema.prisma` already declares `@@index([station_id, fuel_type, recorded_at(sort: Desc)])` on `PriceHistory`
- The migration `20260328000000_add_price_history` already creates `PriceHistory_station_id_fuel_type_recorded_at_idx`
- **Verify** this index exists in the DB using `\d "PriceHistory"` on the production DB after next migration run
- If the index was not applied (e.g., migration was run before the index directive was added), create a standalone migration `add_price_history_index` with `CREATE INDEX CONCURRENTLY` (see Technical Spec)
- No code change needed if the index already exists

---

## Technical Specification

### Fix 1 — ThrottlerGuard as global APP_GUARD

**File:** `apps/api/src/app.module.ts`

**Current state:**
```typescript
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';
import { RolesGuard } from './auth/guards/roles.guard.js';

providers: [
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
],
```

**Required change:** Add `ThrottlerGuard` as the **first** `APP_GUARD` entry. NestJS executes guards in registration order. Rate limiting must run before auth checks so that IP-based throttling applies even to unauthenticated endpoints.

```typescript
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';
import { RolesGuard } from './auth/guards/roles.guard.js';

providers: [
  { provide: APP_GUARD, useClass: ThrottlerGuard },   // NEW — runs first
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
],
```

`ThrottlerModule` is already imported in `app.module.ts`:
```typescript
ThrottlerModule.forRoot([{ ttl: 3600, limit: 3 }]),
```
The module-level defaults (3 req/hour) are the global floor. Individual handlers that need higher limits (e.g., `GET /v1/market-signal/summary`) override via `@Throttle()` decorator. `@Public()` endpoints are unaffected — `ThrottlerGuard` is IP-based and has no concept of auth state.

---

### Fix 2 — DB index on Submission(station_id, created_at DESC) WHERE status='verified'

**Schema model:** `Submission` (in `packages/db/prisma/schema.prisma`)

The `findPricesInArea` query in `price.service.ts` uses `DISTINCT ON (sub.station_id) ORDER BY sub.station_id, sub.created_at DESC WHERE status = 'verified'`. Without a partial index this is a seq-scan at scale.

**Migration file:** `packages/db/prisma/migrations/20260408000000_add_submission_price_index/migration.sql`

```sql
-- This migration uses CREATE INDEX CONCURRENTLY which cannot run inside a transaction.
-- The Prisma migration runner wraps SQL in a transaction by default.
-- To avoid the error, this migration must NOT be wrapped — see Dev Notes.

CREATE INDEX CONCURRENTLY "idx_submission_station_verified"
ON "Submission"(station_id, created_at DESC)
WHERE status = 'verified';
```

**How to create:**
```bash
cd packages/db
pnpm prisma migrate dev --create-only --name add_submission_price_index
# Edit the generated SQL file to contain only the CREATE INDEX CONCURRENTLY statement above.
# Do NOT add a BEGIN/COMMIT block — the migration runner handles that,
# and CONCURRENTLY is incompatible with explicit transactions.
```

Prisma's `-- @prisma:disable-transaction` pragma is not needed here because the file contains only a single DDL statement with no DML. The index creation simply needs to be the only statement in the file.

---

### Fix 3 — DB-level DEFAULT now() on all updated_at columns

**Affected models** (all have `updated_at @updatedAt` in schema):
- `User`
- `Station`
- `Submission`
- `UserConsent`
- `NotificationPreference`
- `StationFuelStaleness`

Not affected (no `updated_at` column): `MarketSignal`, `AdminAuditLog`, `AnomalyAlert`, `PriceHistory`.

**Migration file:** `packages/db/prisma/migrations/20260408000001_add_updated_at_defaults/migration.sql`

```sql
-- Additive: sets DB-level default for updated_at on all tables that have the column.
-- No data is altered. Existing rows are unchanged (DEFAULT only affects future INSERTs).
-- Prisma @updatedAt continues to manage this column at the ORM layer;
-- this default is a safety net for raw SQL writes.

ALTER TABLE "User"                    ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "Station"                 ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "Submission"              ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "UserConsent"             ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "NotificationPreference"  ALTER COLUMN "updated_at" SET DEFAULT now();
ALTER TABLE "StationFuelStaleness"    ALTER COLUMN "updated_at" SET DEFAULT now();
```

This migration can run inside a transaction (no `CONCURRENTLY` involved). Standard `prisma migrate dev` is fine.

---

### Fix 4 — Stale push token cleanup on DeviceNotRegistered

**File:** `apps/api/src/alert/alert.service.ts`

**Current state** (lines 129–138 in `sendInChunks()`):
```typescript
if (ticket.details?.error === 'DeviceNotRegistered') {
  // Stale token — log for ops cleanup; token clearing deferred to a future story
  this.logger.warn(
    'DeviceNotRegistered error on push ticket — stale token detected, ops cleanup needed',
  );
} else {
  this.logger.warn(`Push ticket error: ${ticket.message}`);
}
```

**Required change:** Add a `prisma.notificationPreference.updateMany()` call. The push ticket carries the message (which is the token) but `sendChunk` operates on a `chunk` array. The token must be matched from the original `messages` array by index.

The current loop iterates over `tickets` returned by `sendChunk(chunk)`. Expo guarantees tickets are returned in the same order as messages sent. Use index alignment to retrieve the token:

```typescript
private async sendInChunks(messages: ExpoPushMessage[]): Promise<void> {
  const chunks = this.expoPush.chunkMessages(messages);

  for (const chunk of chunks) {
    try {
      const tickets: ExpoPushTicket[] = await this.expoPush.sendChunk(chunk);

      for (let i = 0; i < tickets.length; i++) {
        const ticket = tickets[i];
        if (ticket.status === 'error') {
          if (ticket.details?.error === 'DeviceNotRegistered') {
            const token = (chunk[i] as ExpoPushMessage).to as string;
            await this.prisma.notificationPreference.updateMany({
              where: { expo_push_token: token },
              data: { expo_push_token: null },
            });
            this.logger.warn(`Cleared stale push token: ${token.slice(0, 20)}...`);
          } else {
            this.logger.warn(`Push ticket error: ${ticket.message}`);
          }
        }
      }
    } catch (e: unknown) {
      // Partial delivery is better than no delivery — log and continue next chunk
      this.logger.error(
        `Failed to send push chunk: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
```

Note: `PrismaService` is already injected in `PriceRiseAlertService` (it is used in `sendRiseAlerts()` for querying `notificationPreference`). No new injection is needed.

---

### Fix 5 — Rate-limit GET /v1/market-signal/summary

**File:** `apps/api/src/market-signal/market-signal.controller.ts`

**Current state:**
```typescript
@Public()
@Get('summary')
async getSummary(): Promise<{ signals: object[] }> {
```

**Required change:**
```typescript
import { Throttle } from '@nestjs/throttler';

@Public()
@Throttle({ default: { limit: 60, ttl: 60000 } })
@Get('summary')
async getSummary(): Promise<{ signals: object[] }> {
```

60 req/min per IP is consistent with the pattern used on other public read endpoints. The endpoint hits PostgreSQL via `$queryRaw` on every call with no caching layer — throttling is the primary protection against runaway clients.

---

### Fix 6 — Separate BullMQ Queue/Worker Redis connections

**Background:** All 6 workers already follow the correct pattern of creating a single `redisForBullMQ` instance with `maxRetriesPerRequest: null`. However, that single instance is shared between the `Queue` and the `Worker` via the local `connection` alias. BullMQ's `Worker` puts the ioredis connection into blocking mode (`BRPOPLPUSH`), which can starve the `Queue` (producer) from executing commands under load.

**Affected workers** (all in `apps/api/src/`):
1. `alert/alert.worker.ts` — `PriceRiseAlertWorker`
2. `market-signal/staleness-detection.worker.ts` — `StalenessDetectionWorker`
3. `market-signal/orlen-ingestion.worker.ts` — `OrlenIngestionWorker`
4. `station/station-sync.worker.ts` — `StationSyncWorker`
5. `station/station-classification.worker.ts` — `StationClassificationWorker`
6. `photo/photo-pipeline.worker.ts` — `PhotoPipelineWorker`

**Current pattern** (identical across all workers):
```typescript
private redisForBullMQ!: Redis;

async onModuleInit(): Promise<void> {
  const redisUrl = this.config.getOrThrow<string>('BULL_REDIS_URL');
  this.redisForBullMQ = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const connection = this.redisForBullMQ as any;

  this.queue = new Queue('queue-name', { connection });
  this.worker = new Worker('queue-name', processor, { connection });
}

async onModuleDestroy(): Promise<void> {
  await this.worker?.close();
  await this.queue?.close();
  await this.redisForBullMQ?.quit();
}
```

**Required pattern:**
```typescript
private redisForQueue!: Redis;
private redisForWorker!: Redis;

async onModuleInit(): Promise<void> {
  const redisUrl = this.config.getOrThrow<string>('BULL_REDIS_URL');
  this.redisForQueue  = new Redis(redisUrl, { maxRetriesPerRequest: null });
  this.redisForWorker = new Redis(redisUrl, { maxRetriesPerRequest: null });

  this.queue = new Queue('queue-name', {
    connection: this.redisForQueue as any,
    // ... existing options unchanged
  });
  this.worker = new Worker('queue-name', processor, {
    connection: this.redisForWorker as any,
    // ... existing options unchanged
  });
}

async onModuleDestroy(): Promise<void> {
  await this.worker?.close();
  await this.queue?.close();
  await this.redisForWorker?.quit();
  await this.redisForQueue?.quit();
}
```

Apply this rename to all 6 workers. All other fields — queue names, job names, cron schedules, retry logic, job IDs, `backoffStrategy`, `limiter`, `settings`, event listeners — must remain unchanged.

---

### Fix 7 — StationFuelStaleness 7-day TTL filter in getStaleFuelTypes

**File:** `apps/api/src/market-signal/staleness-detection.service.ts`

**Current state** (lines 115–121):
```typescript
async getStaleFuelTypes(stationId: string): Promise<string[]> {
  const records = await this.prisma.stationFuelStaleness.findMany({
    where: { station_id: stationId },
    select: { fuel_type: true },
  });
  return records.map((r) => r.fuel_type);
}
```

**Required change:**
```typescript
private static readonly STALE_FLAG_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

async getStaleFuelTypes(stationId: string): Promise<string[]> {
  const cutoff = new Date(Date.now() - StalenessDetectionService.STALE_FLAG_TTL_MS);
  const records = await this.prisma.stationFuelStaleness.findMany({
    where: {
      station_id: stationId,
      flagged_at: { gte: cutoff },
    },
    select: { fuel_type: true },
  });
  return records.map((r) => r.fuel_type);
}
```

Flags older than 7 days are silently excluded from the response — they are not deleted. This is the preferred approach (Option A) because: no migration required, idempotent, safe for decommissioned stations, and ops can still query old flags directly via the DB if needed.

`clearStaleFlag()` and `detectStaleness()` are not changed.

---

### Fix 8 — PriceHistory index on (station_id, fuel_type, recorded_at DESC)

**Current state:** The Prisma schema already declares `@@index([station_id, fuel_type, recorded_at(sort: Desc)])` on the `PriceHistory` model, and migration `20260328000000_add_price_history` creates `PriceHistory_station_id_fuel_type_recorded_at_idx` via standard (non-CONCURRENTLY) DDL.

**Action required:**
1. Connect to the production DB and verify the index exists: `\d "PriceHistory"` or `SELECT indexname FROM pg_indexes WHERE tablename = 'PriceHistory';`
2. If the index exists — no action needed. Mark this fix done.
3. If the index is missing (e.g., Prisma migration was partially applied or predates the index directive):

**Migration file:** `packages/db/prisma/migrations/20260408000002_add_price_history_index/migration.sql`

```sql
-- Only create this migration if the index is confirmed missing in production.
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction.
-- See Dev Notes for Prisma handling.

CREATE INDEX CONCURRENTLY "idx_price_history_station_fuel_recorded"
ON "PriceHistory"(station_id, fuel_type, recorded_at DESC);
```

Note: the existing index name in migration `20260328000000` is `PriceHistory_station_id_fuel_type_recorded_at_idx` (Prisma convention). If that index exists, this migration is not needed.

---

## Tasks / Subtasks

- [ ] **Fix 1 — ThrottlerGuard**
  - [ ] Add `ThrottlerGuard` as first `APP_GUARD` in `app.module.ts` (before `JwtAuthGuard`)
  - [ ] Add `ThrottlerGuard` import from `@nestjs/throttler`
  - [ ] Manual smoke-test: confirm `POST /v1/feedback` returns 429 after limit exceeded
  - [ ] Confirm `@Public()` GET endpoints still return 200

- [ ] **Fix 2 — Submission partial index**
  - [ ] Run `pnpm prisma migrate dev --create-only --name add_submission_price_index` in `packages/db`
  - [ ] Edit generated SQL to contain only the `CREATE INDEX CONCURRENTLY` statement
  - [ ] Apply migration to dev DB, verify index appears in `\d "Submission"`

- [ ] **Fix 3 — updated_at DEFAULT now()**
  - [ ] Run `pnpm prisma migrate dev --create-only --name add_updated_at_defaults` in `packages/db`
  - [ ] Edit generated SQL to contain the 6 `ALTER TABLE ... SET DEFAULT now()` statements
  - [ ] Apply migration, verify with `\d "User"` (and spot-check 2–3 other tables)

- [ ] **Fix 4 — DeviceNotRegistered token cleanup**
  - [ ] Refactor `sendInChunks()` in `alert.service.ts` to use index-aligned iteration
  - [ ] Add `updateMany` call to null `expo_push_token` on `DeviceNotRegistered`
  - [ ] Update `logger.warn` message to confirm clearance
  - [ ] Update/add unit test in `alert.service.spec.ts` covering the cleanup branch

- [ ] **Fix 5 — Rate-limit market-signal/summary**
  - [ ] Add `@Throttle({ default: { limit: 60, ttl: 60000 } })` to `getSummary()` in `market-signal.controller.ts`
  - [ ] Add `import { Throttle } from '@nestjs/throttler'` to the controller

- [ ] **Fix 6 — Separate BullMQ Redis connections**
  - [ ] `alert/alert.worker.ts` — split `redisForBullMQ` into `redisForQueue` + `redisForWorker`
  - [ ] `market-signal/staleness-detection.worker.ts` — same
  - [ ] `market-signal/orlen-ingestion.worker.ts` — same
  - [ ] `station/station-sync.worker.ts` — same
  - [ ] `station/station-classification.worker.ts` — same
  - [ ] `photo/photo-pipeline.worker.ts` — same
  - [ ] Verify `onModuleDestroy` closes both connections on each worker
  - [ ] Smoke-test: deploy to staging, confirm all workers initialise and scheduled jobs enqueue

- [ ] **Fix 7 — StationFuelStaleness 7-day TTL**
  - [ ] Add `STALE_FLAG_TTL_MS` constant to `staleness-detection.service.ts`
  - [ ] Add `flagged_at: { gte: cutoff }` filter to `getStaleFuelTypes()`
  - [ ] Update/add unit test covering the cutoff filter behaviour

- [ ] **Fix 8 — PriceHistory index**
  - [ ] Verify index exists on staging/prod DB (`\d "PriceHistory"`)
  - [ ] If missing: create migration `add_price_history_index` with `CREATE INDEX CONCURRENTLY`
  - [ ] If present: mark done (no code change)

---

## Dev Notes

### Fix 1 — Guard execution order is significant
NestJS applies `APP_GUARD` providers in the order they appear in the `providers` array. `ThrottlerGuard` **must** be first so that rate-limiting is enforced before `JwtAuthGuard` attempts token validation. This prevents unauthenticated clients from bypassing the rate limiter. The `@Public()` decorator tells `JwtAuthGuard` to skip auth; it has no effect on `ThrottlerGuard`. Both guards coexist without conflict.

### Fix 2 and Fix 8 — CONCURRENTLY inside Prisma migrations
`CREATE INDEX CONCURRENTLY` cannot execute inside a PostgreSQL transaction. Prisma wraps migration files in `BEGIN ... COMMIT` by default. To avoid the error:
- Use `prisma migrate dev --create-only` to generate an empty migration shell
- Manually write the SQL file containing **only** the `CREATE INDEX CONCURRENTLY` statement (no other DDL)
- When Prisma runs the migration, it will still wrap it in a transaction, but `CREATE INDEX CONCURRENTLY` inside a single-statement transaction is handled by PostgreSQL by silently downgrading to a regular (blocking) `CREATE INDEX` — this is acceptable for dev and staging environments where the table is small
- For production, if the `Submission` table has significant row counts at launch, consider running the index creation manually via `psql` outside a migration, then marking the migration as already applied via `prisma migrate resolve --applied <migration_name>`
- Document whichever approach is used in the migration file header comment

### Fix 4 — Index alignment in sendInChunks
The Expo SDK guarantees tickets are returned in the same order as the messages in the chunk. The refactored loop uses `for (let i = 0; i < tickets.length; i++)` to align ticket index with chunk message index. This is the standard pattern in Expo's own documentation. The `to` field on the chunk message is the token string.

### Fix 6 — All workers already have the right Redis config, just one instance
After reading all 6 worker files: every worker already uses `maxRetriesPerRequest: null` and a dedicated Redis connection (not the shared `REDIS_CLIENT`). The only issue is that the single instance is aliased to `connection` and used for both `Queue` and `Worker`. The fix is a mechanical rename + second instantiation. No architectural change required. The `as any` cast for the ioredis-to-BullMQ connection is an existing pattern — retain it.

### Fix 7 — Option A chosen (TTL filter, not deletion)
Option B (scheduled deletion job) was explicitly deferred. The 7-day TTL filter in `getStaleFuelTypes()` is sufficient for MVP: stale flags for decommissioned or pipeline-stuck stations will naturally stop appearing in responses after 7 days without requiring a cleanup job. Ops can still query old flags via the DB if needed for debugging.

### Fix 8 — Verify before acting
The `PriceHistory` index may already exist. Migration `20260328000000_add_price_history` creates it via a standard (non-CONCURRENTLY) `CREATE INDEX`. Check before creating a duplicate migration. Running `CREATE INDEX` twice with the same name will fail with `relation already exists`.

---

## Dev Agent Record

**Completion notes:** _(to be filled by dev agent)_

**Files changed:**
- `apps/api/src/app.module.ts` (Fix 1)
- `apps/api/src/market-signal/market-signal.controller.ts` (Fix 5)
- `apps/api/src/alert/alert.service.ts` (Fix 4)
- `apps/api/src/alert/alert.worker.ts` (Fix 6)
- `apps/api/src/market-signal/staleness-detection.worker.ts` (Fix 6)
- `apps/api/src/market-signal/staleness-detection.service.ts` (Fix 7)
- `apps/api/src/market-signal/orlen-ingestion.worker.ts` (Fix 6)
- `apps/api/src/station/station-sync.worker.ts` (Fix 6)
- `apps/api/src/station/station-classification.worker.ts` (Fix 6)
- `apps/api/src/photo/photo-pipeline.worker.ts` (Fix 6)
- `packages/db/prisma/migrations/20260408000000_add_submission_price_index/migration.sql` (Fix 2)
- `packages/db/prisma/migrations/20260408000001_add_updated_at_defaults/migration.sql` (Fix 3)
- `packages/db/prisma/migrations/20260408000002_add_price_history_index/migration.sql` (Fix 8, conditional)

**Decisions made:** _(to be filled by dev agent)_

**Blockers:** _(to be filled by dev agent)_
