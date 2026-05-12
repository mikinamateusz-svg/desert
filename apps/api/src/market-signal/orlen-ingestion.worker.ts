import { Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import { OrlenIngestionService } from './orlen-ingestion.service.js';
import { BrentIngestionService } from './brent-ingestion.service.js';
import { PriceRiseSignalPublisher } from './price-rise-signal.publisher.js';
import type { MovementRecord } from './types.js';
import { REDIS_CLIENT } from '../redis/redis.module.js';

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
  // Hardening-2: shared non-blocking client + per-worker blocking instance.
  private redisForBlocking!: Redis;

  constructor(
    private readonly ingestionService: OrlenIngestionService,
    private readonly config: ConfigService,
    // Story 6.0 — Brent crude is non-blocking: if it throws, ORLEN
    // ingestion is unaffected (AC3). The publisher fans out the
    // resulting movements to the price-rise-signals queue.
    private readonly brentIngestionService: BrentIngestionService,
    private readonly riseSignalPublisher: PriceRiseSignalPublisher,
    @Inject(REDIS_CLIENT) private readonly redisShared: Redis,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env['MINIMAL_WORKERS'] === 'true') {
      this.logger.log('OrlenIngestionWorker skipped (MINIMAL_WORKERS=true)');
      return;
    }

    const redisUrl = this.config.getOrThrow<string>('BULL_REDIS_URL');
    this.redisForBlocking = new Redis(redisUrl, { maxRetriesPerRequest: null });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const queueConnection = this.redisShared as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const workerConnection = this.redisForBlocking as any;

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
        // 1. ORLEN rack — required, throws on any failure (BullMQ retries).
        const orlenMovements = await this.ingestionService.ingest();

        // 2. Brent crude — non-blocking per Story 6.0 AC3. Wrap in
        //    try/catch so an Alpha Vantage / NBP outage never fails the
        //    job. Service already logs [OPS-ALERT] internally for hard
        //    failures; the catch here defends against unexpected throws.
        let brentMovement: MovementRecord | null = null;
        try {
          brentMovement = await this.brentIngestionService.ingest();
        } catch (err) {
          this.logger.warn(
            `[OPS-ALERT] Brent ingestion threw: ${err instanceof Error ? err.message : String(err)}`,
          );
        }

        // 3. Publish rise signals from the combined movement set.
        const allMovements = [
          ...orlenMovements,
          ...(brentMovement ? [brentMovement] : []),
        ];
        const published = await this.riseSignalPublisher.maybePublish(allMovements);
        if (published > 0) {
          this.logger.log(`Published ${published} price-rise-signal event(s)`);
        }
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
    // redisShared lives in RedisModule's lifecycle; don't quit it here.
    await this.redisForBlocking?.quit().catch(() => undefined);
  }

  /** Exposed for integration tests and manual ops trigger */
  getQueue(): Queue {
    return this.queue;
  }
}
