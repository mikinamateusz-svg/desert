import { Inject, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

const logger = new Logger('RedisModule');

/**
 * Hardening-2 — shared client also serves as the non-blocking
 * (Queue-side) connection for every BullMQ Worker. Because of that:
 *
 * 1. `maxRetriesPerRequest: null` is REQUIRED by BullMQ — recent
 *    versions throw at Queue construction if a connection has a
 *    finite retry count, and even older versions silently lose
 *    commands when ioredis times out after 3 retries. Was `3`
 *    pre-Hardening-2; the bump corresponds to making this client
 *    BullMQ-eligible.
 *
 * 2. The Queue side of every BullMQ worker must talk to the SAME
 *    Redis broker as that worker's blocking side (which uses
 *    `BULL_REDIS_URL`). If they diverge, every queue producer
 *    publishes to one Redis and every consumer reads from another
 *    → silent 100% job loss with no error surface. The factory
 *    asserts the two env vars are identical at boot to fail fast
 *    if anyone tries to point them at different instances. When a
 *    future story genuinely needs to split cache Redis from queue
 *    Redis, this assertion needs to be relaxed to a documented
 *    "must override REDIS_CLIENT injection in worker modules" rule.
 */
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (config: ConfigService) => {
        const redisUrl = config.getOrThrow<string>('REDIS_URL');
        const bullRedisUrl = config.getOrThrow<string>('BULL_REDIS_URL');
        if (redisUrl !== bullRedisUrl) {
          throw new Error(
            'REDIS_URL and BULL_REDIS_URL must point at the same Redis instance. ' +
              'Hardening-2 routes BullMQ Queue.add() through the shared REDIS_CLIENT ' +
              '(built from REDIS_URL) while Workers use BULL_REDIS_URL for their ' +
              'blocking side; if they diverge, queue producers and consumers will ' +
              'talk to different brokers and every job is silently lost.',
          );
        }
        const client = new Redis(redisUrl, {
          // Hardening-2: required for BullMQ Queue eligibility — see
          // the module docblock for the full rationale.
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
          lazyConnect: false,
        });
        client.on('connect', () => logger.log('Redis connected'));
        client.on('error', (err) => logger.error('Redis error', err));
        return client;
      },
      inject: [ConfigService],
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  /**
   * Hardening-2 — workers' `onModuleDestroy` deliberately does NOT
   * quit the shared client; this is where it actually gets closed.
   * Requires `app.enableShutdownHooks()` in `main.ts` to fire on
   * SIGTERM (added at the same time as this hook).
   */
  async onModuleDestroy(): Promise<void> {
    try {
      await this.client.quit();
    } catch (e) {
      logger.warn(
        `Shared REDIS_CLIENT.quit() failed (non-fatal during shutdown): ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }
}
