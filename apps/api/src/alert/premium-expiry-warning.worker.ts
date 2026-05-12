import { Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import { PremiumExpiryWarningService } from './premium-expiry-warning.service.js';
import { REDIS_CLIENT } from '../redis/redis.module.js';

export const PREMIUM_EXPIRY_WARNING_QUEUE = 'premium-expiry-warning';
export const PREMIUM_EXPIRY_WARNING_JOB = 'send-expiry-warnings';

const RETRY_DELAY_MS = 30 * 60 * 1000; // 30 min — the warning is much less time-sensitive than rise alerts

const JOB_OPTIONS = {
  attempts: 2,
  backoff: { type: 'custom' },
} as const;

/**
 * Story 6.10 — daily worker that finds users whose premium-alerts window
 * is within 2-4 days of expiring and pushes a renewal nudge. Runs at
 * 09:00 Europe/Warsaw — chosen for typical Polish morning commute hours
 * when drivers are most likely to be near a station and able to act on
 * the prompt with their next fillup.
 */
@Injectable()
export class PremiumExpiryWarningWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PremiumExpiryWarningWorker.name);
  private queue!: Queue;
  private worker!: Worker;
  // Hardening-2: shared non-blocking client + per-worker blocking instance.
  private redisForBlocking!: Redis;

  constructor(
    private readonly warningService: PremiumExpiryWarningService,
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redisShared: Redis,
  ) {}

  async onModuleInit(): Promise<void> {
    const redisUrl = this.config.getOrThrow<string>('BULL_REDIS_URL');
    this.redisForBlocking = new Redis(redisUrl, { maxRetriesPerRequest: null });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const queueConnection = this.redisShared as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const workerConnection = this.redisForBlocking as any;

    this.queue = new Queue(PREMIUM_EXPIRY_WARNING_QUEUE, {
      connection: queueConnection,
      defaultJobOptions: JOB_OPTIONS,
    });

    // 09:00 Europe/Warsaw — morning commute window. Stable jobId for idempotent restarts.
    await this.queue.add(
      PREMIUM_EXPIRY_WARNING_JOB,
      {},
      {
        repeat: { pattern: '0 9 * * *', tz: 'Europe/Warsaw' },
        jobId: 'premium-expiry-warning-daily',
        ...JOB_OPTIONS,
      },
    );

    this.worker = new Worker(
      PREMIUM_EXPIRY_WARNING_QUEUE,
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
      this.logger.log('Premium expiry warning job completed');
    });

    this.worker.on('failed', (job: Job | undefined, err: Error) => {
      const attemptsMade = job?.attemptsMade ?? 0;
      const maxAttempts = job?.opts?.attempts ?? JOB_OPTIONS.attempts;
      const willRetry = attemptsMade < maxAttempts;

      if (!willRetry) {
        this.logger.error(
          `Premium expiry warning FAILED after ${attemptsMade} attempts`,
          err.stack,
        );
      } else {
        this.logger.warn(
          `Premium expiry warning attempt ${attemptsMade} failed — retrying in 30 min: ${err.message}`,
        );
      }
    });

    this.logger.log(
      'PremiumExpiryWarningWorker initialised — runs daily at 09:00 Europe/Warsaw',
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    // redisShared lives in RedisModule's lifecycle; don't quit it here.
    await this.redisForBlocking?.quit().catch(() => undefined);
  }

  /** Exposed for integration tests and manual ops trigger */
  getQueue(): Queue {
    return this.queue;
  }
}
