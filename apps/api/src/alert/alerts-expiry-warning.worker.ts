import { Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import { AlertsExpiryWarningService } from './alerts-expiry-warning.service.js';
import { REDIS_QUEUE_CLIENT } from '../redis/redis.module.js';

export const ALERTS_EXPIRY_WARNING_QUEUE = 'alerts-expiry-warning';
export const ALERTS_EXPIRY_WARNING_JOB = 'send-expiry-warnings';

const RETRY_DELAY_MS = 30 * 60 * 1000; // 30 min — the warning is much less time-sensitive than rise alerts

const JOB_OPTIONS = {
  attempts: 2,
  backoff: { type: 'custom' },
} as const;

/**
 * Story 6.10 / 6.13 — daily worker that finds users whose price-alerts
 * window is within 2-4 days of expiring and pushes a renewal nudge.
 * Runs at 09:00 Europe/Warsaw — chosen for typical Polish morning
 * commute hours when drivers are most likely to be near a station and
 * able to act on the prompt with their next fillup.
 *
 * Naming: was `PremiumExpiryWarningWorker` (and BullMQ queue name was
 * `premium-expiry-warning`) until Story 6.13 retired the "premium"
 * framing. The old repeatable cron entry + the old per-user dedup
 * keys are obliterated inline on `onModuleInit` — self-healing across
 * envs without a runbook step. Idempotent: safe in fresh envs where
 * the legacy artifacts never existed.
 */
@Injectable()
export class AlertsExpiryWarningWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AlertsExpiryWarningWorker.name);
  private queue!: Queue;
  private worker!: Worker;
  // Hardening-2: shared non-blocking client + per-worker blocking instance.
  private redisForBlocking!: Redis;

  constructor(
    private readonly warningService: AlertsExpiryWarningService,
    private readonly config: ConfigService,
    @Inject(REDIS_QUEUE_CLIENT) private readonly redisQueueClient: Redis,
  ) {}

  async onModuleInit(): Promise<void> {
    const redisUrl = this.config.getOrThrow<string>('BULL_REDIS_URL');
    this.redisForBlocking = new Redis(redisUrl, { maxRetriesPerRequest: null });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const queueConnection = this.redisQueueClient as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const workerConnection = this.redisForBlocking as any;

    await this.cleanupLegacyArtifacts(queueConnection);

    this.queue = new Queue(ALERTS_EXPIRY_WARNING_QUEUE, {
      connection: queueConnection,
      defaultJobOptions: JOB_OPTIONS,
    });

    // 09:00 Europe/Warsaw — morning commute window. Stable jobId for idempotent restarts.
    await this.queue.add(
      ALERTS_EXPIRY_WARNING_JOB,
      {},
      {
        repeat: { pattern: '0 9 * * *', tz: 'Europe/Warsaw' },
        jobId: 'alerts-expiry-warning-daily',
        ...JOB_OPTIONS,
      },
    );

    this.worker = new Worker(
      ALERTS_EXPIRY_WARNING_QUEUE,
      async (_job: Job) => {
        await this.warningService.sendExpiryWarnings();
      },
      {
        connection: workerConnection,
        settings: {
          backoffStrategy: (_attemptsMade: number): number => RETRY_DELAY_MS,
        },
      },
    );

    this.worker.on('completed', () => {
      this.logger.log('Alerts expiry warning job completed');
    });

    this.worker.on('failed', (job: Job | undefined, err: Error) => {
      const attemptsMade = job?.attemptsMade ?? 0;
      const maxAttempts = job?.opts?.attempts ?? JOB_OPTIONS.attempts;
      const willRetry = attemptsMade < maxAttempts;

      if (!willRetry) {
        this.logger.error(
          `Alerts expiry warning FAILED after ${attemptsMade} attempts`,
          err.stack,
        );
      } else {
        this.logger.warn(
          `Alerts expiry warning attempt ${attemptsMade} failed — retrying in 30 min: ${err.message}`,
        );
      }
    });

    this.logger.log(
      'AlertsExpiryWarningWorker initialised — runs daily at 09:00 Europe/Warsaw',
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    // redisQueueClient lives in RedisModule's lifecycle; don't quit it here.
    await this.redisForBlocking?.quit().catch(() => undefined);
  }

  /** Exposed for integration tests and manual ops trigger */
  getQueue(): Queue {
    return this.queue;
  }

  /**
   * Story 6.13 — obliterate the pre-rename BullMQ repeatable + dedup-key
   * leftovers on first boot of the renamed worker. Without this:
   *   - The old `premium-expiry-warning` queue's repeatable cron keeps
   *     firing daily forever against a queue with no consumer.
   *   - Old `premium_expiring_warning:{userId}` dedup keys sit in Redis
   *     for up to 14d; their namespace flip means a user could receive
   *     a second warning within the overlap window.
   * Both legs swallow failures: this is best-effort cleanup, not a
   * gating step for boot. Idempotent on fresh envs.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async cleanupLegacyArtifacts(queueConnection: any): Promise<void> {
    try {
      const legacyQueue = new Queue('premium-expiry-warning', { connection: queueConnection });
      await legacyQueue.obliterate({ force: true });
      await legacyQueue.close();
      this.logger.log('Story 6.13 — obliterated legacy `premium-expiry-warning` queue');
    } catch (err) {
      this.logger.warn(
        `Story 6.13 — legacy queue cleanup skipped: ${(err as Error).message}`,
      );
    }

    try {
      const stream = this.redisQueueClient.scanStream({
        match: 'premium_expiring_warning:*',
        count: 100,
      });
      let deleted = 0;
      for await (const keys of stream) {
        const batch = keys as string[];
        if (batch.length > 0) {
          await this.redisQueueClient.del(...batch);
          deleted += batch.length;
        }
      }
      if (deleted > 0) {
        this.logger.log(`Story 6.13 — deleted ${deleted} legacy dedup keys`);
      }
    } catch (err) {
      this.logger.warn(
        `Story 6.13 — legacy dedup-key cleanup skipped: ${(err as Error).message}`,
      );
    }
  }
}
