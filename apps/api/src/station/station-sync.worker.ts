import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import { StationSyncService } from './station-sync.service.js';
import {
  StationClassificationWorker,
  STATION_CLASSIFICATION_JOB,
} from './station-classification.worker.js';

export const STATION_SYNC_QUEUE = 'station-sync';
export const STATION_SYNC_JOB = 'run-sync';

// Retry delays: 1h → 6h → 24h (in ms)
const RETRY_DELAYS = [
  1 * 60 * 60 * 1000,
  6 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000,
] as const;

export const JOB_OPTIONS = {
  attempts: 4, // 1 initial + 3 retries
  backoff: { type: 'custom' },
} as const;

@Injectable()
export class StationSyncWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StationSyncWorker.name);
  private queue!: Queue;
  private worker!: Worker;
  // BullMQ requires separate Redis connections for Queue and Worker
  private redisForQueue!: Redis;
  private redisForWorker!: Redis;

  constructor(
    private readonly syncService: StationSyncService,
    private readonly config: ConfigService,
    private readonly classificationWorker: StationClassificationWorker,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env['MINIMAL_WORKERS'] === 'true') {
      this.logger.log('StationSyncWorker skipped (MINIMAL_WORKERS=true)');
      return;
    }

    const redisUrl = this.config.getOrThrow<string>('BULL_REDIS_URL');
    this.redisForQueue = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.redisForWorker = new Redis(redisUrl, { maxRetriesPerRequest: null });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const queueConnection = this.redisForQueue as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const workerConnection = this.redisForWorker as any;

    this.queue = new Queue(STATION_SYNC_QUEUE, {
      connection: queueConnection,
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
        connection: workerConnection,
        settings: {
          backoffStrategy: (attemptsMade: number): number =>
            RETRY_DELAYS[attemptsMade - 1] ?? RETRY_DELAYS[RETRY_DELAYS.length - 1],
        },
      },
    );

    this.worker.on('completed', () => {
      this.logger.log('Station sync completed — enqueuing classification job');
      void this.classificationWorker
        .getQueue()
        .add(STATION_CLASSIFICATION_JOB, {}, { jobId: `classify-after-sync-${Date.now()}` })
        .catch((err: Error) =>
          this.logger.warn(`Failed to enqueue classification job: ${err.message}`),
        );
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
    await Promise.allSettled([this.redisForQueue?.quit(), this.redisForWorker?.quit()]);
  }

  /** Exposed for integration tests and manual trigger from ops */
  getQueue(): Queue {
    return this.queue;
  }
}
