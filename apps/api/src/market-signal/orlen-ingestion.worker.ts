import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import { OrlenIngestionService } from './orlen-ingestion.service.js';

export const ORLEN_INGESTION_QUEUE = 'orlen-ingestion';
export const ORLEN_INGESTION_JOB = 'run-ingestion';

// AC2: retry once after 30 minutes
const RETRY_DELAY_MS = 30 * 60 * 1000;

const JOB_OPTIONS = {
  attempts: 2, // 1 initial + 1 retry
  backoff: { type: 'custom' },
} as const;

@Injectable()
export class OrlenIngestionWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrlenIngestionWorker.name);
  private queue!: Queue;
  private worker!: Worker;
  // BullMQ requires separate Redis connections for Queue and Worker
  private redisForQueue!: Redis;
  private redisForWorker!: Redis;

  constructor(
    private readonly ingestionService: OrlenIngestionService,
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

    this.queue = new Queue(ORLEN_INGESTION_QUEUE, {
      connection: queueConnection,
      defaultJobOptions: JOB_OPTIONS,
    });

    // AC1: runs at 06:00 and 14:00 Europe/Warsaw
    // jobIds are stable so only one repeat entry exists in Redis (idempotent on restart)
    await this.queue.add(
      ORLEN_INGESTION_JOB,
      {},
      {
        repeat: { pattern: '0 6 * * *', tz: 'Europe/Warsaw' },
        jobId: 'orlen-morning',
        ...JOB_OPTIONS,
      },
    );
    await this.queue.add(
      ORLEN_INGESTION_JOB,
      {},
      {
        repeat: { pattern: '0 14 * * *', tz: 'Europe/Warsaw' },
        jobId: 'orlen-afternoon',
        ...JOB_OPTIONS,
      },
    );

    this.worker = new Worker(
      ORLEN_INGESTION_QUEUE,
      async (_job: Job) => {
        await this.ingestionService.ingest();
      },
      {
        connection: workerConnection,
        settings: {
          // AC2: fixed 30-minute retry delay regardless of attempt number
          backoffStrategy: (_attemptsMade: number): number => RETRY_DELAY_MS,
        },
      },
    );

    this.worker.on('completed', () => {
      this.logger.log('ORLEN rack price ingestion completed successfully');
    });

    this.worker.on('failed', (job: Job | undefined, err: Error) => {
      const attemptsMade = job?.attemptsMade ?? 0;
      const maxAttempts = job?.opts?.attempts ?? JOB_OPTIONS.attempts;
      const willRetry = attemptsMade < maxAttempts;

      if (!willRetry) {
        // AC2: all retries exhausted — ops alert
        this.logger.error(
          `ORLEN ingestion FAILED after ${attemptsMade} attempts — ops alert required`,
          err.stack,
        );
      } else {
        this.logger.warn(
          `ORLEN ingestion attempt ${attemptsMade} failed — retrying in 30 min: ${err.message}`,
        );
      }
    });

    this.logger.log(
      'OrlenIngestionWorker initialised — runs at 06:00 and 14:00 Europe/Warsaw',
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
