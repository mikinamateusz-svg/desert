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

    // Story 6.3 — Phase 1 scheduled cron jobs DELIBERATELY NOT registered
    // anymore. PriceRiseAlertService.sendRiseAlerts() polled MarketSignal
    // for "anything significant in the last 2h"; that role is now played
    // by the price-rise-signals queue published from Story 6.0's
    // PriceRiseSignalPublisher and consumed by Story 6.3's
    // PredictiveRiseAlertWorker. The service class + queue are kept so
    // the Worker still binds (consuming the queue this worker exposes via
    // getQueue() for ops tooling), and so manual ops triggers can still
    // call sendRiseAlerts() if needed during incident response.
    //
    // Cleanup of leftover repeat jobs from prior deploys: BullMQ persists
    // repeatable schedules in Redis even after we stop re-adding them,
    // so without this cleanup the morning/afternoon Phase 1 alerts would
    // fire alongside the new predictive worker until a manual ops sweep.
    // Idempotent — running on a fresh queue is a no-op.
    try {
      const repeatables = await this.queue.getRepeatableJobs();
      const phaseOneJobIds = new Set([
        'price-rise-alert-morning',
        'price-rise-alert-afternoon',
      ]);
      for (const r of repeatables) {
        if (r.id && phaseOneJobIds.has(r.id)) {
          await this.queue.removeRepeatableByKey(r.key);
          this.logger.log(`Removed leftover Phase 1 repeat job: ${r.id} (key=${r.key})`);
        }
      }
    } catch (e) {
      this.logger.warn(
        `Failed to clean up Phase 1 repeat jobs (non-fatal): ${e instanceof Error ? e.message : String(e)}`,
      );
    }

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
