import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import { ConsumptionBenchmarkService } from './consumption-benchmark.service.js';

export const CONSUMPTION_BENCHMARK_QUEUE = 'consumption-benchmark';
export const CONSUMPTION_BENCHMARK_JOB = 'calculate-consumption-benchmarks';

// Retry delays mirror RegionalBenchmarkWorker — these are slow, idempotent
// jobs where short retry intervals would just fill the logs without giving
// the underlying issue (e.g. database pressure) time to resolve.
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
 * Daily 04:00 UTC scheduler for ConsumptionBenchmarkService.calculateAndStore.
 *
 * Pattern matches RegionalBenchmarkWorker (Story 5.0): raw bullmq Queue +
 * Worker, separate Redis connections per BullMQ guidance, MINIMAL_WORKERS
 * env flag for local dev opt-out. Time slot 04:00 UTC was picked to land
 * an hour AFTER the regional benchmark run (03:00 UTC) — both are
 * read-heavy aggregates over the same FillUp table, staggering avoids
 * piling them onto the same connection pool.
 */
@Injectable()
export class ConsumptionBenchmarkWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConsumptionBenchmarkWorker.name);
  private queue!: Queue;
  private worker!: Worker;
  // BullMQ requires separate Redis connections for Queue and Worker.
  private redisForQueue!: Redis;
  private redisForWorker!: Redis;

  constructor(
    private readonly benchmarkService: ConsumptionBenchmarkService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env['MINIMAL_WORKERS'] === 'true') {
      this.logger.log('ConsumptionBenchmarkWorker skipped (MINIMAL_WORKERS=true)');
      return;
    }

    const redisUrl = this.config.getOrThrow<string>('BULL_REDIS_URL');
    this.redisForQueue = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.redisForWorker = new Redis(redisUrl, { maxRetriesPerRequest: null });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const queueConnection = this.redisForQueue as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const workerConnection = this.redisForWorker as any;

    this.queue = new Queue(CONSUMPTION_BENCHMARK_QUEUE, {
      connection: queueConnection,
      defaultJobOptions: JOB_OPTIONS,
    });

    // Daily at 04:00 UTC — staggered after the 03:00 RegionalBenchmark
    // run. jobId fixes the repeat entry so process restarts don't pile
    // up duplicate schedules.
    await this.queue.add(
      CONSUMPTION_BENCHMARK_JOB,
      {},
      {
        repeat: { pattern: '0 4 * * *' },
        jobId: 'daily-consumption-benchmark',
        ...JOB_OPTIONS,
      },
    );

    this.worker = new Worker(
      CONSUMPTION_BENCHMARK_QUEUE,
      async (job: Job) => {
        const start = Date.now();
        this.logger.log(`[ConsumptionBenchmarkWorker] starting job ${job.id}`);
        const result = await this.benchmarkService.calculateAndStore();
        const duration = Date.now() - start;
        this.logger.log(
          `[ConsumptionBenchmarkWorker] complete — ${result.inserted} (make × model × engine) groups written in ${duration}ms`,
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
        // All retries exhausted — ops alert per the [OPS-ALERT] convention
        // used by RegionalBenchmarkWorker + StationSyncWorker.
        this.logger.error(
          `[OPS-ALERT] Consumption benchmark calculation FAILED after ${attemptsMade} attempts — manual intervention required`,
          err.stack,
        );
      } else {
        this.logger.warn(
          `[ConsumptionBenchmarkWorker] attempt ${attemptsMade} failed — retrying (${maxAttempts - attemptsMade} left): ${err.message}`,
        );
      }
    });

    this.logger.log('ConsumptionBenchmarkWorker initialised — daily benchmark scheduled (04:00 UTC)');
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    // P11: log Redis quit failures instead of swallowing them — if a
    // graceful shutdown is hanging because Redis won't ack the QUIT,
    // we need that visibility.
    const results = await Promise.allSettled([
      this.redisForQueue?.quit(),
      this.redisForWorker?.quit(),
    ]);
    for (const [i, r] of results.entries()) {
      if (r.status === 'rejected') {
        const which = i === 0 ? 'redisForQueue' : 'redisForWorker';
        this.logger.warn(`[ConsumptionBenchmarkWorker] ${which}.quit() failed: ${r.reason}`);
      }
    }
  }

  /**
   * Exposed for integration tests + manual ops trigger if needed.
   * Returns undefined when MINIMAL_WORKERS is set (worker never wired up).
   */
  getQueue(): Queue | undefined {
    return this.queue;
  }
}
