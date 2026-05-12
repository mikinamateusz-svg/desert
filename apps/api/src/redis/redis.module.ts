import { Inject, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Cache/dedup/run-locks side. Backed by `REDIS_URL`. On prod this is
 * Upstash; on staging this is Redis Cloud. Used by all service-level
 * `ioredis` ops — `OcrSpendService`, `SubmissionDedupService`,
 * `PriceCacheService`, `MonthlySummaryNotificationService` (run-lock),
 * etc.
 */
export const REDIS_CLIENT = 'REDIS_CLIENT';

/**
 * BullMQ Queue side. Backed by `BULL_REDIS_URL`. On prod this is
 * Railway's Redis plugin; on staging this is the same Redis Cloud
 * instance as `REDIS_URL` (one provider per env, but separated by
 * token so prod's dual-broker setup is supported transparently).
 *
 * Injected into every worker's `new Queue(name, { connection: ... })`
 * construction. The matching per-worker blocking ioredis (used by
 * `new Worker(...)`) still opens against `BULL_REDIS_URL` directly,
 * because BullMQ requires a dedicated socket for BRPOPLPUSH and that
 * socket gets locked for the worker's lifetime — sharing across
 * workers would deadlock.
 *
 * Hardening-2 (rev 2): originally everything shared `REDIS_CLIENT`,
 * which broke on prod where `REDIS_URL` (Upstash) and `BULL_REDIS_URL`
 * (Railway Redis) point at DIFFERENT brokers. Queue.add() on Upstash
 * would never reach a Worker BRPOPLPUSH-ing on Railway Redis →
 * silent 100% job loss. Splitting the client preserves prod's
 * existing dual-broker architecture.
 */
export const REDIS_QUEUE_CLIENT = 'REDIS_QUEUE_CLIENT';

const logger = new Logger('RedisModule');

/**
 * Both clients are configured with `maxRetriesPerRequest: null +
 * enableReadyCheck: false` — required by BullMQ for any ioredis
 * instance passed to a Queue or Worker constructor. The
 * `REDIS_QUEUE_CLIENT` obviously needs it; the `REDIS_CLIENT` also
 * needs it because it's used for `Queue.add()`-adjacent ops in some
 * code paths (e.g. `getRepeatableJobs()` cleanup in
 * `alert.worker.ts`). Setting both consistently avoids a class of
 * "works for that worker, breaks for this one" bugs.
 */
const BULL_COMPATIBLE_OPTIONS = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: false,
} as const;

@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (config: ConfigService) => {
        const url = config.getOrThrow<string>('REDIS_URL');
        const client = new Redis(url, BULL_COMPATIBLE_OPTIONS);
        client.on('connect', () => logger.log('REDIS_CLIENT connected (cache/dedup)'));
        client.on('error', (err) => logger.error('REDIS_CLIENT error', err));
        return client;
      },
      inject: [ConfigService],
    },
    {
      provide: REDIS_QUEUE_CLIENT,
      useFactory: (config: ConfigService) => {
        const url = config.getOrThrow<string>('BULL_REDIS_URL');
        const client = new Redis(url, BULL_COMPATIBLE_OPTIONS);
        client.on('connect', () => logger.log('REDIS_QUEUE_CLIENT connected (BullMQ)'));
        client.on('error', (err) => logger.error('REDIS_QUEUE_CLIENT error', err));
        return client;
      },
      inject: [ConfigService],
    },
  ],
  exports: [REDIS_CLIENT, REDIS_QUEUE_CLIENT],
})
export class RedisModule implements OnModuleDestroy {
  constructor(
    @Inject(REDIS_CLIENT) private readonly client: Redis,
    @Inject(REDIS_QUEUE_CLIENT) private readonly queueClient: Redis,
  ) {}

  /**
   * Workers' `onModuleDestroy` deliberately do NOT quit either of
   * these clients — closing them is RedisModule's job. Requires
   * `app.enableShutdownHooks()` in `main.ts` to fire on SIGTERM.
   * NestJS destroys providers in reverse-dependency order, so all
   * workers' onModuleDestroy run before this — by which time their
   * Queues / Workers have called `.close()` (which releases the
   * shared client's subscriptions), so quitting here is safe.
   */
  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.client.quit(), this.queueClient.quit()]).then(
      (results) => {
        const names = ['REDIS_CLIENT', 'REDIS_QUEUE_CLIENT'];
        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          if (r.status === 'rejected') {
            logger.warn(
              `Shared ${names[i]}.quit() failed (non-fatal during shutdown): ${
                r.reason instanceof Error ? r.reason.message : String(r.reason)
              }`,
            );
          }
        }
      },
    );
  }
}
