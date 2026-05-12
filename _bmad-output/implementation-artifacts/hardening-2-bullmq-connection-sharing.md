# Story Hardening-2: BullMQ Connection Sharing

Status: ready-for-dev

> **Context — staging deploy outage 2026-05-12:** Phase 2 worker count
> pushed the API past the Redis Cloud free tier's 30-connection cap on
> staging, causing every boot to fail with `ERR max number of clients
> reached`. Counted: 15 BullMQ workers × 2 connections each + 1 main
> `REDIS_CLIENT` = 31 connections — exactly one over the cap. Prod
> survived because Upstash's plan has a higher cap, but the connection
> footprint is wasteful on both environments and bills by-connection
> on Upstash. This story removes the per-worker queue connection so
> every worker drops to ~1 connection, halving the footprint.

## Story

As an **operator**,
I want every BullMQ worker to share a single Redis connection for
non-blocking commands,
So that staging can boot under the Redis Cloud free-tier connection
cap and prod's Upstash bill drops proportionally.

## Acceptance Criteria

**AC1 — Per-worker connection count drops from 2 to 1:**
Given the API boots on staging
When all 15 BullMQ workers initialise
Then each worker creates exactly **one** dedicated ioredis instance (for the blocking BRPOPLPUSH side only)
And the shared `REDIS_CLIENT` is reused for all `Queue` constructors (non-blocking commands)
And total Redis client count is ≤ 17 (1 main + 15 worker + ≤1 misc) — verified via `CLIENT LIST` on Redis after boot

**AC2 — No regression in BullMQ behaviour:**
Given a worker is using the shared `REDIS_CLIENT` for its Queue
When jobs are added (`queue.add(...)`) and consumed (`worker` event loop)
Then job enqueue/consume succeeds at the same rate as pre-refactor
And `getRepeatableJobs()` / `removeRepeatableByKey()` still work (used by Story 6.3 Phase 1 cron cleanup)
And `queue.close()` and `worker.close()` shut down cleanly without leaking the shared client (the shared client lives in `RedisModule`'s lifecycle, not the worker's)

**AC3 — Worker connection NEVER shared across workers (load-bearing):**
Given Worker A's blocking BRPOPLPUSH is in-flight
When Worker B tries to consume from a different queue
Then Worker B's blocking call goes to a SEPARATE ioredis connection — never the same physical socket as Worker A
*Reasoning:* Sharing the worker (blocking) connection across workers locks up: while A is blocked waiting for a job, B's command queues behind it. This is the load-bearing invariant the refactor must preserve.

**AC4 — Worker `onModuleDestroy` only closes its own connection:**
Given a worker shuts down (test teardown, graceful restart, etc.)
When `onModuleDestroy` runs
Then it calls `worker.close()` + `queue.close()` + closes only its dedicated worker-side ioredis
And it does NOT call `quit()` on the shared `REDIS_CLIENT` (other workers + services are still using it)

**AC5 — Tests pass without modification:**
Given the existing api test suite (1419 tests)
When the refactor lands
Then 1419/1419 continue to pass
And new unit tests verify: (a) worker constructors receive the shared client, (b) `onModuleDestroy` doesn't quit the shared client, (c) the per-worker blocking ioredis is correctly distinct from the shared instance

**AC6 — No staging/prod env divergence:**
Given the refactor is purely structural
When deployed to staging or prod
Then no env vars change (still reads `BULL_REDIS_URL` for the per-worker blocking instance and `REDIS_URL` for the shared)
And the refactor is fully reversible without data loss

## Tasks / Subtasks

- [ ] T1: Audit current per-worker pattern (AC1, AC3)
  - [ ] T1a: Confirm the 15 files identified (alert.worker, community-rise-alert.worker, predictive-rise-alert.worker, premium-expiry-warning.worker, price-drop-alert.worker, consumption-benchmark.worker, orlen-ingestion.worker, price-rise-signal.publisher, staleness-detection.worker, monthly-summary-notification.worker, photo-cleanup.worker, photo-pipeline.worker, regional-benchmark.worker, station-classification.worker, station-sync.worker)
  - [ ] T1b: Note any worker that deviates from the standard 2-connection pattern (e.g. price-rise-signal.publisher only needs the queue side — already uses 1 connection, just rename for consistency)

- [ ] T2: Extend `RedisModule` to expose the same `REDIS_CLIENT` it already provides — no changes needed beyond ensuring every worker module imports `RedisModule` (most already do via transitive deps)

- [ ] T3: Refactor each worker — replace `redisForQueue` with injected `REDIS_CLIENT` (AC1, AC2)
  - [ ] T3a: Inject `@Inject(REDIS_CLIENT) private readonly redisShared: Redis` into the worker class constructor
  - [ ] T3b: Drop the `redisForQueue!: Redis` field + its `new Redis(redisUrl, ...)` in `onModuleInit`
  - [ ] T3c: Use `this.redisShared` as the `connection` arg for `new Queue(...)` (replaces the `queueConnection` `as any` cast)
  - [ ] T3d: Keep the per-worker blocking ioredis (rename `redisForWorker` → `redisForBlocking` for clarity)
  - [ ] T3e: `onModuleDestroy` — remove the `redisForQueue?.quit()` call; keep `redisForBlocking?.quit()`. Shared client is closed by `RedisModule`'s own `onModuleDestroy`.

- [ ] T4: Module imports — verify each worker's parent module imports `RedisModule` (AC2)
  - Most do already via `PrismaModule` chains; spot-check `MarketSignalModule`, `PhotoModule`, `StationModule`, `RegionalBenchmarkModule`, `ConsumptionBenchmarkModule`

- [ ] T5: Tests (AC5)
  - [ ] T5a: Existing worker specs all mock `ConfigService.getOrThrow('BULL_REDIS_URL')` + check `new Redis()` was called — update to also mock the injected `REDIS_CLIENT` (provide a stub ioredis instance) and assert the Queue constructor receives THAT instance
  - [ ] T5b: New cross-worker test: spin up 2 worker instances with the same `REDIS_CLIENT` stub, verify they each got distinct blocking connections (AC3)
  - [ ] T5c: New shutdown test: trigger `onModuleDestroy`, assert `worker.close()` + `queue.close()` + `redisForBlocking.quit()` called, but the shared client `.quit()` NOT called (AC4)

- [ ] T6: Manual verification on staging (AC1)
  - [ ] T6a: After deploy, run `CLIENT LIST` in Redis Cloud console (or via `redis-cli`) — count connections from the API; assert ≤17
  - [ ] T6b: Watch boot logs for any `ERR max number of clients reached` — should be zero

## Dev Notes

### The "why" of two-connections-per-worker

BullMQ's Worker uses blocking `BRPOPLPUSH` (or equivalent in newer versions, `XREADGROUP`-style) to wait for jobs without polling. While the connection is in a blocking wait, no other command can ride through it — the connection is exclusively that worker's. Hence per-worker dedicated connection.

The Queue side (the publishing end) is non-blocking — `queue.add()` is a one-shot `RPUSH`-equivalent. Multiple Queue instances can share a connection because their commands pipeline through. The current code creates a separate ioredis per Queue purely out of habit/symmetry with the worker side — there's no correctness reason.

### Concrete change shape

```ts
// BEFORE
@Injectable()
export class PriceRiseAlertWorker implements OnModuleInit, OnModuleDestroy {
  private queue!: Queue;
  private worker!: Worker;
  private redisForQueue!: Redis;    // ← removed
  private redisForWorker!: Redis;   // ← renamed to redisForBlocking

  constructor(
    private readonly alertService: PriceRiseAlertService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    const redisUrl = this.config.getOrThrow<string>('BULL_REDIS_URL');
    this.redisForQueue = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.redisForWorker = new Redis(redisUrl, { maxRetriesPerRequest: null });
    // ...
    this.queue = new Queue(QUEUE_NAME, { connection: this.redisForQueue as any });
    this.worker = new Worker(QUEUE_NAME, processor, { connection: this.redisForWorker as any });
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
    await Promise.allSettled([this.redisForQueue?.quit(), this.redisForWorker?.quit()]);
  }
}

// AFTER
@Injectable()
export class PriceRiseAlertWorker implements OnModuleInit, OnModuleDestroy {
  private queue!: Queue;
  private worker!: Worker;
  private redisForBlocking!: Redis;  // ← only the blocking side now

  constructor(
    private readonly alertService: PriceRiseAlertService,
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redisShared: Redis,
  ) {}

  async onModuleInit() {
    const redisUrl = this.config.getOrThrow<string>('BULL_REDIS_URL');
    this.redisForBlocking = new Redis(redisUrl, { maxRetriesPerRequest: null });
    // ...
    this.queue = new Queue(QUEUE_NAME, { connection: this.redisShared as any });
    this.worker = new Worker(QUEUE_NAME, processor, { connection: this.redisForBlocking as any });
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
    await this.redisForBlocking?.quit();
    // DO NOT quit redisShared — it's owned by RedisModule
  }
}
```

### Why not use `BULL_REDIS_URL` for both?

Two env vars exist (`REDIS_URL` for the main client, `BULL_REDIS_URL` for workers) because historically they could point at different Redis instances (e.g. cache on one, queues on another). In practice today both point at the same instance, but keeping them separate at the wire level preserves the future option to split queues onto a dedicated instance without another refactor.

For this story, the shared `REDIS_CLIENT` is constructed from `REDIS_URL` and used for Queue side. Workers continue to use `BULL_REDIS_URL` for their dedicated blocking connection. If `REDIS_URL === BULL_REDIS_URL` (current setup), everything talks to the same Redis. If a future env splits them, queue add() goes to the cache cluster but consumer blocks on the queue cluster — broken. So **a follow-up note in this spec:** if/when `REDIS_URL` and `BULL_REDIS_URL` diverge, every Queue construction needs to switch back to a dedicated ioredis on `BULL_REDIS_URL`. Document this in `redis.module.ts`.

### Connection count math

| | Before | After |
|---|---|---|
| Main REDIS_CLIENT | 1 | 1 |
| Per worker × 15 workers | 2 each (30 total) | 1 each (15 total) |
| **Total** | **31** | **16** |

Comfortably under the 30-connection free-tier cap with headroom for transient overlap during pod restarts.

### Test fixture migration

The worker specs (~15 files) currently mock the Redis module by checking `new Redis()` is called twice. Change to: `expect(mockRedisClass).toHaveBeenCalledTimes(1)` (only the blocking instance) AND assert the Queue constructor received the shared mock.

### Risks

1. **ioredis pipelining starvation** — if `REDIS_CLIENT` is heavily used by service-level cache/dedup operations AND all 15 Queue.add() calls also use it, commands could queue up. In practice the throughput of `queue.add()` is low (photo pipeline + rare alerts), but worth monitoring after deploy.
2. **`maxRetriesPerRequest: null`** — the per-worker blocking instance MUST keep this option (BullMQ requirement). The shared `REDIS_CLIENT` in `RedisModule` already uses different defaults — verify it works for Queue.add() too. Likely fine because Queue.add() is non-blocking, but spot-check after deploy.
3. **Shutdown ordering** — `RedisModule.onModuleDestroy` may run BEFORE worker `onModuleDestroy`, leaving the worker's `queue.close()` to fire on a dead client. NestJS shutdown order is FIFO-by-default; verify by adding shutdown order logs in dev.

### Project Structure Notes

- `apps/api/src/redis/redis.module.ts` — no changes needed (already exports `REDIS_CLIENT`)
- 15 worker files modified (listed above)
- 15 worker spec files modified (mock setup updates)
- New cross-worker integration test: `apps/api/src/redis/redis-connection-sharing.spec.ts` (covers AC3, AC4)

### References

- BullMQ docs on shared connections: https://docs.bullmq.io/guide/connections (the "Sharing connections" section explicitly documents the Queue-can-share / Worker-cannot pattern)
- Current `RedisModule` provider: [apps/api/src/redis/redis.module.ts](apps/api/src/redis/redis.module.ts)
- Example worker to mirror: [apps/api/src/alert/alert.worker.ts](apps/api/src/alert/alert.worker.ts)
- 2026-05-12 staging outage logs (lost — was the trigger for this story)

## Dev Agent Record

### Agent Model Used

claude-opus-4-7

### Debug Log References

### Completion Notes List

### File List

- `apps/api/src/alert/alert.worker.ts` (modified)
- `apps/api/src/alert/community-rise-alert.worker.ts` (modified)
- `apps/api/src/alert/predictive-rise-alert.worker.ts` (modified)
- `apps/api/src/alert/premium-expiry-warning.worker.ts` (modified)
- `apps/api/src/alert/price-drop-alert.worker.ts` (modified)
- `apps/api/src/consumption-benchmark/consumption-benchmark.worker.ts` (modified)
- `apps/api/src/market-signal/orlen-ingestion.worker.ts` (modified)
- `apps/api/src/market-signal/price-rise-signal.publisher.ts` (modified)
- `apps/api/src/market-signal/staleness-detection.worker.ts` (modified)
- `apps/api/src/monthly-summary/monthly-summary-notification.worker.ts` (modified)
- `apps/api/src/photo/photo-cleanup.worker.ts` (modified)
- `apps/api/src/photo/photo-pipeline.worker.ts` (modified)
- `apps/api/src/regional-benchmark/regional-benchmark.worker.ts` (modified)
- `apps/api/src/station/station-classification.worker.ts` (modified)
- `apps/api/src/station/station-sync.worker.ts` (modified)
- corresponding `.spec.ts` files (15 files, modified)
- `apps/api/src/redis/redis-connection-sharing.spec.ts` (new)
- `_bmad-output/implementation-artifacts/hardening-2-bullmq-connection-sharing.md` (this file)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — new hardening-2 entry)
