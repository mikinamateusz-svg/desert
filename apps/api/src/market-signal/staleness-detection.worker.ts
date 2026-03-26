import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import { StalenessDetectionService } from './staleness-detection.service.js';

export const STALENESS_DETECTION_QUEUE = 'staleness-detection';
export const STALENESS_DETECTION_JOB = 'run-detection';

// AC6: retry once after 5 minutes (short — completes before next ORLEN run)
const RETRY_DELAY_MS = 5 * 60 * 1000;

const JOB_OPTIONS = {
  attempts: 2, // 1 initial + 1 retry
  backoff: { type: 'custom' },
} as const;

@Injectable()
export class StalenessDetectionWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StalenessDetectionWorker.name);
  private queue!: Queue;
  private worker!: Worker;
  // Dedicated Redis connection — BullMQ requires maxRetriesPerRequest: null
  private redisForBullMQ!: Redis;

  constructor(
    private readonly detectionService: StalenessDetectionService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const redisUrl = this.config.getOrThrow<string>('REDIS_URL');
    this.redisForBullMQ = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const connection = this.redisForBullMQ as any;

    this.queue = new Queue(STALENESS_DETECTION_QUEUE, {
      connection,
      defaultJobOptions: JOB_OPTIONS,
    });

    // Runs at 06:15 and 14:15 Europe/Warsaw — 15 min after ORLEN ingestion (06:00 / 14:00)
    // jobIds are stable so only one repeat entry exists in Redis (idempotent on restart)
    await this.queue.add(
      STALENESS_DETECTION_JOB,
      {},
      {
        repeat: { pattern: '15 6 * * *', tz: 'Europe/Warsaw' },
        jobId: 'staleness-morning',
        ...JOB_OPTIONS,
      },
    );
    await this.queue.add(
      STALENESS_DETECTION_JOB,
      {},
      {
        repeat: { pattern: '15 14 * * *', tz: 'Europe/Warsaw' },
        jobId: 'staleness-afternoon',
        ...JOB_OPTIONS,
      },
    );

    this.worker = new Worker(
      STALENESS_DETECTION_QUEUE,
      async (_job: Job) => {
        await this.detectionService.detectStaleness();
      },
      {
        connection,
        settings: {
          // AC6: fixed 5-minute retry delay regardless of attempt number
          backoffStrategy: (_attemptsMade: number): number => RETRY_DELAY_MS,
        },
      },
    );

    this.worker.on('completed', () => {
      this.logger.log('Staleness detection completed successfully');
    });

    this.worker.on('failed', (job: Job | undefined, err: Error) => {
      const attemptsMade = job?.attemptsMade ?? 0;
      const maxAttempts = job?.opts?.attempts ?? JOB_OPTIONS.attempts;
      const willRetry = attemptsMade < maxAttempts;

      if (!willRetry) {
        // AC6: all retries exhausted — ops alert
        this.logger.error(
          `Staleness detection FAILED after ${attemptsMade} attempts — ops alert required`,
          err.stack,
        );
      } else {
        this.logger.warn(
          `Staleness detection attempt ${attemptsMade} failed — retrying in 5 min: ${err.message}`,
        );
      }
    });

    this.logger.log(
      'StalenessDetectionWorker initialised — runs at 06:15 and 14:15 Europe/Warsaw',
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    await this.redisForBullMQ?.quit();
  }

  /** Exposed for integration tests and manual ops trigger */
  getQueue(): Queue {
    return this.queue;
  }
}
