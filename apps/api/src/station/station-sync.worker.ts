import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import { StationSyncService } from './station-sync.service.js';

export const STATION_SYNC_QUEUE = 'station-sync';
export const STATION_SYNC_JOB = 'run-sync';

// Retry delays: 1h → 6h → 24h (in ms)
const RETRY_DELAYS = [
  1 * 60 * 60 * 1000,
  6 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000,
] as const;

const JOB_OPTIONS = {
  attempts: 4, // 1 initial + 3 retries
  backoff: { type: 'custom' },
} as const;

@Injectable()
export class StationSyncWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StationSyncWorker.name);
  private queue!: Queue;
  private worker!: Worker;
  // P5: dedicated Redis connection — BullMQ requires maxRetriesPerRequest: null
  private redisForBullMQ!: Redis;

  constructor(
    private readonly syncService: StationSyncService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    // P5: create a dedicated ioredis connection with maxRetriesPerRequest: null
    // (the shared REDIS_CLIENT uses maxRetriesPerRequest: 3 which breaks BullMQ)
    const redisUrl = this.config.getOrThrow<string>('REDIS_URL');
    this.redisForBullMQ = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const connection = this.redisForBullMQ as any;

    // P6: defaultJobOptions as belt-and-suspenders alongside job-level options
    this.queue = new Queue(STATION_SYNC_QUEUE, {
      connection,
      defaultJobOptions: JOB_OPTIONS,
    });

    // Schedule weekly sync: every Sunday at 02:00 UTC
    // jobId ensures only one repeat entry exists in Redis (idempotent on restart)
    await this.queue.add(
      STATION_SYNC_JOB,
      {},
      {
        repeat: { pattern: '0 2 * * 0' },
        jobId: 'weekly-station-sync',
        ...JOB_OPTIONS,
      },
    );

    this.worker = new Worker(
      STATION_SYNC_QUEUE,
      async (_job: Job) => {
        await this.syncService.runSync();
      },
      {
        connection,
        settings: {
          backoffStrategy: (attemptsMade: number): number =>
            RETRY_DELAYS[attemptsMade - 1] ?? RETRY_DELAYS[RETRY_DELAYS.length - 1],
        },
      },
    );

    this.worker.on('completed', () => {
      this.logger.log('Station sync job completed successfully');
    });

    this.worker.on('failed', (job: Job | undefined, err: Error) => {
      const attemptsMade = job?.attemptsMade ?? 0;
      const maxAttempts = job?.opts?.attempts ?? 1;
      const willRetry = attemptsMade < maxAttempts;

      if (!willRetry) {
        // All retries exhausted — ops alert required
        this.logger.error(
          `Station sync FAILED after ${attemptsMade} attempts — manual intervention required`,
          err.stack,
        );
      } else {
        this.logger.warn(
          `Station sync attempt ${attemptsMade} failed — retrying (${maxAttempts - attemptsMade} left)`,
          err.message,
        );
      }
    });

    this.logger.log('StationSyncWorker initialised — weekly sync scheduled (Sundays 02:00 UTC)');
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    await this.redisForBullMQ?.quit();
  }

  /** Exposed for integration tests and manual trigger from ops */
  getQueue(): Queue {
    return this.queue;
  }
}
