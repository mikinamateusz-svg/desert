import { Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import { PriceDropAlertService } from './price-drop-alert.service.js';
import { REDIS_QUEUE_CLIENT } from '../redis/redis.module.js';
import {
  PRICE_DROP_CHECKS_QUEUE,
  PRICE_DROP_CHECK_JOB,
  type PriceDropCheckJobData,
} from './price-drop-alert.constants.js';

// Best-effort job options. Drop alerts lose value fast — a 5-min stale alert
// is fine, a 30-min stale alert is noise. One retry is enough; if it still
// fails the original verified price is already in the cache and the next
// drop will get its own enqueue.
const JOB_OPTIONS = {
  attempts: 2, // 1 initial + 1 retry
  backoff: { type: 'fixed' as const, delay: 30_000 }, // 30s
  removeOnComplete: { count: 500 },
  removeOnFail: { count: 100 },
} as const;

@Injectable()
export class PriceDropAlertWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PriceDropAlertWorker.name);
  private queue!: Queue;
  private worker!: Worker;
  // Hardening-2: shared non-blocking client + per-worker blocking instance.
  private redisForBlocking!: Redis;

  constructor(
    private readonly alertService: PriceDropAlertService,
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

    this.queue = new Queue(PRICE_DROP_CHECKS_QUEUE, {
      connection: queueConnection,
      defaultJobOptions: JOB_OPTIONS,
    });

    this.worker = new Worker<PriceDropCheckJobData>(
      PRICE_DROP_CHECKS_QUEUE,
      async (job: Job<PriceDropCheckJobData>) => {
        try {
          await this.alertService.checkAndNotify(job.data);
        } catch (err) {
          // Best-effort delivery: log [OPS-ALERT] and swallow so BullMQ does
          // not retry indefinitely. We want one retry from the job options
          // for transient infra issues, not a runaway loop on a logic bug.
          this.logger.error(
            `[OPS-ALERT] price-drop-check failed for station=${job.data.stationId} ` +
              `fuel=${job.data.fuelType}: ${err instanceof Error ? err.message : String(err)}`,
            err instanceof Error ? err.stack : undefined,
          );
        }
      },
      { connection: workerConnection },
    );

    this.worker.on('failed', (job: Job | undefined, err: Error) => {
      // BullMQ emits 'failed' per-attempt; only OPS-ALERT on the terminal
      // attempt so transient retries don't pollute alert dashboards. The
      // processor already swallows checkAndNotify errors, so reaching this
      // handler at all means the processor itself threw before its
      // try/catch (e.g. DI failure) — worth a warn on every attempt.
      const attemptsMade = job?.attemptsMade ?? 0;
      const maxAttempts = job?.opts?.attempts ?? JOB_OPTIONS.attempts;
      const isTerminal = attemptsMade >= maxAttempts;
      if (isTerminal) {
        this.logger.error(
          `[OPS-ALERT] price-drop-check job ${job?.id ?? '?'} failed terminally after ${attemptsMade} attempts: ${err.message}`,
          err.stack,
        );
      } else {
        this.logger.warn(
          `price-drop-check job ${job?.id ?? '?'} attempt ${attemptsMade}/${maxAttempts} failed — retrying: ${err.message}`,
        );
      }
    });

    this.logger.log('PriceDropAlertWorker initialised — consuming price-drop-checks queue');
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    // redisQueueClient lives in RedisModule's lifecycle; don't quit it here.
    await this.redisForBlocking?.quit().catch(() => undefined);
  }

  /**
   * Cross-module enqueue. PhotoPipelineWorker calls this after a verified
   * price write so the drop check runs out-of-band on the worker thread.
   * Failures here are logged + swallowed: a missed enqueue means a missed
   * alert for one verification, but never blocks the photo pipeline.
   *
   * Deterministic jobId leverages BullMQ's automatic dedup so a photo
   * pipeline retry that re-enqueues the same (station, fuel, verifiedAt)
   * doesn't produce two checkAndNotify runs racing the same dedup key.
   */
  async enqueueCheck(data: PriceDropCheckJobData): Promise<void> {
    if (!this.queue) {
      // Boot-race guard: a verification arriving before onModuleInit
      // wired the queue would otherwise crash with `undefined.add`. Log
      // and skip — the cold-boot window is small and the next drop will
      // get its own enqueue.
      this.logger.warn(
        `Queue not yet initialised — dropping price-drop-check for ${data.stationId}/${data.fuelType}`,
      );
      return;
    }
    try {
      await this.queue.add(PRICE_DROP_CHECK_JOB, data, {
        jobId: `${data.stationId}:${data.fuelType}:${data.verifiedAt}`,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to enqueue price-drop-check for station ${data.stationId} fuel=${data.fuelType}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Exposed for ops + integration tests. */
  getQueue(): Queue {
    return this.queue;
  }
}
