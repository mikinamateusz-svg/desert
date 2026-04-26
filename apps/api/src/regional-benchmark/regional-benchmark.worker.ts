import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import { RegionalBenchmarkService } from './regional-benchmark.service.js';

export const REGIONAL_BENCHMARK_QUEUE = 'regional-benchmark';
export const REGIONAL_BENCHMARK_JOB = 'calculate-regional-benchmarks';

// Retry delays: 1h → 6h → 24h (in ms). Mirrors station-sync — these are slow,
// idempotent jobs where a stuck retry every 5 min would just spam the logs.
const RETRY_DELAYS = [
  1 * 60 * 60 * 1000,
  6 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000,
] as const;

export const JOB_OPTIONS = {
  attempts: 4, // 1 initial + 3 retries
  backoff: { type: 'custom' },
} as const;

/**
 * Daily 03:00 UTC scheduler for `RegionalBenchmarkService.calculateAndStore`.
 *
 * Pattern matches `StationSyncWorker`: raw bullmq Queue + Worker (not the
 * @nestjs/bullmq decorators), separate Redis connections per BullMQ guidance,
 * MINIMAL_WORKERS env flag for local dev opt-out.
 */
@Injectable()
export class RegionalBenchmarkWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RegionalBenchmarkWorker.name);
  private queue!: Queue;
  private worker!: Worker;
  // BullMQ requires separate Redis connections for Queue and Worker (per BullMQ docs).
  private redisForQueue!: Redis;
  private redisForWorker!: Redis;

  constructor(
    private readonly benchmarkService: RegionalBenchmarkService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env['MINIMAL_WORKERS'] === 'true') {
      this.logger.log('RegionalBenchmarkWorker skipped (MINIMAL_WORKERS=true)');
      return;
    }

    const redisUrl = this.config.getOrThrow<string>('BULL_REDIS_URL');
    this.redisForQueue = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.redisForWorker = new Redis(redisUrl, { maxRetriesPerRequest: null });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const queueConnection = this.redisForQueue as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const workerConnection = this.redisForWorker as any;

    this.queue = new Queue(REGIONAL_BENCHMARK_QUEUE, {
      connection: queueConnection,
      defaultJobOptions: JOB_OPTIONS,
    });

    // Daily at 03:00 UTC (well after midnight UTC settles, before any Western Europe morning ops).
    // jobId fixes the repeat entry so restarts don't pile up duplicate schedules.
    await this.queue.add(
      REGIONAL_BENCHMARK_JOB,
      {},
      {
        repeat: { pattern: '0 3 * * *' },
        jobId: 'daily-benchmark-calc',
        ...JOB_OPTIONS,
      },
    );

    this.worker = new Worker(
      REGIONAL_BENCHMARK_QUEUE,
      async (job: Job) => {
        const start = Date.now();
        this.logger.log(`[BenchmarkWorker] starting job ${job.id}`);
        const result = await this.benchmarkService.calculateAndStore();
        const duration = Date.now() - start;
        this.logger.log(
          `[BenchmarkWorker] complete — ${result.inserted} (voivodeship × fuel_type) combinations written in ${duration}ms`,
        );
      },
      {
        connection: workerConnection,
        settings: {
          backoffStrategy: (attemptsMade: number): number =>
            RETRY_DELAYS[attemptsMade - 1] ?? RETRY_DELAYS[RETRY_DELAYS.length - 1],
        },
      },
    );

    this.worker.on('failed', (job: Job | undefined, err: Error) => {
      const attemptsMade = job?.attemptsMade ?? 0;
      const maxAttempts = job?.opts?.attempts ?? 1;
      const willRetry = attemptsMade < maxAttempts;

      if (!willRetry) {
        // All retries exhausted — ops alert per AC4 [OPS-ALERT] convention
        this.logger.error(
          `[OPS-ALERT] Regional benchmark calculation FAILED after ${attemptsMade} attempts — manual intervention required`,
          err.stack,
        );
      } else {
        this.logger.warn(
          `[BenchmarkWorker] attempt ${attemptsMade} failed — retrying (${maxAttempts - attemptsMade} left): ${err.message}`,
        );
      }
    });

    this.logger.log('RegionalBenchmarkWorker initialised — daily benchmark scheduled (03:00 UTC)');
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    await Promise.allSettled([this.redisForQueue?.quit(), this.redisForWorker?.quit()]);
  }

  /** Exposed for integration tests + manual ops trigger if needed. */
  getQueue(): Queue {
    return this.queue;
  }
}
