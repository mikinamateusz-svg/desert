import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import { PriceRiseAlertService } from './alert.service.js';

export const PRICE_RISE_ALERT_QUEUE = 'price-rise-alert';
export const PRICE_RISE_ALERT_JOB = 'send-rise-alerts';

// Retry once after 5 minutes — alert value is time-sensitive, short window appropriate
const RETRY_DELAY_MS = 5 * 60 * 1000;

const JOB_OPTIONS = {
  attempts: 2, // 1 initial + 1 retry
  backoff: { type: 'custom' },
} as const;

@Injectable()
export class PriceRiseAlertWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PriceRiseAlertWorker.name);
  private queue!: Queue;
  private worker!: Worker;
  // BullMQ requires separate Redis connections for Queue and Worker
  private redisForQueue!: Redis;
  private redisForWorker!: Redis;

  constructor(
    private readonly alertService: PriceRiseAlertService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const redisUrl = this.config.getOrThrow<string>('BULL_REDIS_URL');
    this.redisForQueue = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.redisForWorker = new Redis(redisUrl, { maxRetriesPerRequest: null });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const queueConnection = this.redisForQueue as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const workerConnection = this.redisForWorker as any;

    this.queue = new Queue(PRICE_RISE_ALERT_QUEUE, {
      connection: queueConnection,
      defaultJobOptions: JOB_OPTIONS,
    });

    // Runs at 06:05 and 14:05 Europe/Warsaw — 5 min after ORLEN ingestion (06:00 / 14:00)
    // Stable jobIds are idempotent on restart
    await this.queue.add(
      PRICE_RISE_ALERT_JOB,
      {},
      {
        repeat: { pattern: '5 6 * * *', tz: 'Europe/Warsaw' },
        jobId: 'price-rise-alert-morning',
        ...JOB_OPTIONS,
      },
    );
    await this.queue.add(
      PRICE_RISE_ALERT_JOB,
      {},
      {
        repeat: { pattern: '5 14 * * *', tz: 'Europe/Warsaw' },
        jobId: 'price-rise-alert-afternoon',
        ...JOB_OPTIONS,
      },
    );

    this.worker = new Worker(
      PRICE_RISE_ALERT_QUEUE,
      async (_job: Job) => {
        await this.alertService.sendRiseAlerts();
      },
      {
        connection: workerConnection,
        settings: {
          backoffStrategy: (_attemptsMade: number): number => RETRY_DELAY_MS,
        },
      },
    );

    this.worker.on('completed', () => {
      this.logger.log('Price rise alert job completed');
    });

    this.worker.on('failed', (job: Job | undefined, err: Error) => {
      const attemptsMade = job?.attemptsMade ?? 0;
      const maxAttempts = job?.opts?.attempts ?? JOB_OPTIONS.attempts;
      const willRetry = attemptsMade < maxAttempts;

      if (!willRetry) {
        this.logger.error(
          `Price rise alert FAILED after ${attemptsMade} attempts — ops alert required`,
          err.stack,
        );
      } else {
        this.logger.warn(
          `Price rise alert attempt ${attemptsMade} failed — retrying in 5 min: ${err.message}`,
        );
      }
    });

    this.logger.log(
      'PriceRiseAlertWorker initialised — runs at 06:05 and 14:05 Europe/Warsaw',
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    await Promise.allSettled([this.redisForQueue?.quit(), this.redisForWorker?.quit()]);
  }

  /** Exposed for integration tests and manual ops trigger */
  getQueue(): Queue {
    return this.queue;
  }
}
