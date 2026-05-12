import { Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import { MonthlySummaryNotificationService } from './monthly-summary-notification.service.js';
import { REDIS_QUEUE_CLIENT } from '../redis/redis.module.js';

export const MONTHLY_SUMMARY_QUEUE = 'monthly-summary';
export const MONTHLY_SUMMARY_JOB = 'send-monthly-summary';

// Retry once after 30 minutes — a calendar-month bucket is forgiving and
// the source data (FillUp rows) is immutable for the prior month, so a
// single retry against transient infra failures is plenty.
const RETRY_DELAY_MS = 30 * 60 * 1000;

const JOB_OPTIONS = {
  attempts: 2,
  backoff: { type: 'custom' },
} as const;

/**
 * Returns the year + 1-indexed month of the calendar month BEFORE `now`.
 * Rolls year correctly (Jan → previous Dec via Date's negative-month
 * normalisation).
 */
export function previousMonth(now: Date = new Date()): { year: number; month: number } {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

@Injectable()
export class MonthlySummaryNotificationWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MonthlySummaryNotificationWorker.name);
  private queue!: Queue;
  private worker!: Worker;
  // Hardening-2: shared non-blocking client + per-worker blocking instance.
  private redisForBlocking!: Redis;

  constructor(
    private readonly summaryService: MonthlySummaryNotificationService,
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

    this.queue = new Queue(MONTHLY_SUMMARY_QUEUE, {
      connection: queueConnection,
      defaultJobOptions: JOB_OPTIONS,
    });

    // Cron: 09:00 Warsaw time on the 1st of every month. Stable jobId
    // means BullMQ creates only one repeat entry regardless of how many
    // times the process restarts.
    await this.queue.add(
      MONTHLY_SUMMARY_JOB,
      {},
      {
        repeat: { pattern: '0 9 1 * *', tz: 'Europe/Warsaw' },
        jobId: 'monthly-summary-notification',
        ...JOB_OPTIONS,
      },
    );

    this.worker = new Worker(
      MONTHLY_SUMMARY_QUEUE,
      async (_job: Job) => {
        const { year, month } = previousMonth();
        this.logger.log(`Running monthly summary for ${year}-${String(month).padStart(2, '0')}`);
        const result = await this.summaryService.runForMonth(year, month);
        this.logger.log(
          `Monthly summary ${year}-${String(month).padStart(2, '0')} completed: ` +
            `sent=${result.sent}, skipped=${result.skipped}, noToken=${result.noToken}`,
        );
      },
      {
        connection: workerConnection,
        settings: {
          backoffStrategy: (_attemptsMade: number): number => RETRY_DELAY_MS,
        },
      },
    );

    this.worker.on('failed', (job: Job | undefined, err: Error) => {
      // Only OPS-ALERT on the terminal attempt; transient retries log as warn
      // so the dashboard isn't flooded by mid-flight retries.
      const attemptsMade = job?.attemptsMade ?? 0;
      const maxAttempts = job?.opts?.attempts ?? JOB_OPTIONS.attempts;
      const isTerminal = attemptsMade >= maxAttempts;
      if (isTerminal) {
        this.logger.error(
          `[OPS-ALERT] monthly-summary job FAILED after ${attemptsMade} attempts`,
          err.stack,
        );
      } else {
        this.logger.warn(
          `monthly-summary attempt ${attemptsMade}/${maxAttempts} failed — retrying in 30 min: ${err.message}`,
        );
      }
    });

    this.logger.log(
      'MonthlySummaryNotificationWorker initialised — runs at 09:00 Warsaw on the 1st of each month',
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    // redisQueueClient lives in RedisModule's lifecycle; don't quit it here.
    await this.redisForBlocking?.quit().catch(() => undefined);
  }

  /** Exposed for ops + integration tests. */
  getQueue(): Queue {
    return this.queue;
  }
}
