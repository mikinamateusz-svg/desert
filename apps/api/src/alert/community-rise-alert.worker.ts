import { Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import { CommunityRiseAlertService } from './community-rise-alert.service.js';
import { REDIS_QUEUE_CLIENT } from '../redis/redis.module.js';
import {
  COMMUNITY_RISE_CHECKS_QUEUE,
  COMMUNITY_RISE_CHECK_JOB,
  type CommunityRiseCheckJobData,
} from './price-drop-alert.constants.js';

// Best-effort job options. Threshold evaluation is idempotent (reads
// PriceHistory; never mutates) so a single retry is enough — if it still
// fails the next verified submission for the same voivodeship+fuel will
// re-enqueue and the next attempt evaluates fresh data.
const JOB_OPTIONS = {
  attempts: 2, // 1 initial + 1 retry
  backoff: { type: 'fixed' as const, delay: 30_000 }, // 30s
  removeOnComplete: { count: 200 },
  // Keep failed jobs around long enough for ops to inspect during the
  // 48h dedup window. 50 was ~10-20 min of failure history at peak —
  // long-gone before anyone investigated why no community alert fired.
  removeOnFail: { count: 500, age: 48 * 3600 },
} as const;

@Injectable()
export class CommunityRiseAlertWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CommunityRiseAlertWorker.name);
  private queue!: Queue;
  private worker!: Worker;
  // Hardening-2: shared non-blocking client + per-worker blocking instance.
  private redisForBlocking!: Redis;

  constructor(
    private readonly alertService: CommunityRiseAlertService,
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

    this.queue = new Queue(COMMUNITY_RISE_CHECKS_QUEUE, {
      connection: queueConnection,
      defaultJobOptions: JOB_OPTIONS,
    });

    this.worker = new Worker<CommunityRiseCheckJobData>(
      COMMUNITY_RISE_CHECKS_QUEUE,
      async (job: Job<CommunityRiseCheckJobData>) => {
        try {
          await this.alertService.evaluateAndNotify(job.data);
        } catch (err) {
          // Best-effort delivery: log [OPS-ALERT] and swallow so BullMQ
          // does not retry indefinitely. We want one retry from the job
          // options for transient infra issues, not a runaway loop on a
          // logic bug. Mirrors the pattern in price-drop-alert.worker.ts.
          this.logger.error(
            `[OPS-ALERT] community-rise-check failed for ${job.data.voivodeship}/${job.data.fuelType}: ${err instanceof Error ? err.message : String(err)}`,
            err instanceof Error ? err.stack : undefined,
          );
        }
      },
      { connection: workerConnection },
    );

    this.worker.on('failed', (job: Job | undefined, err: Error) => {
      // BullMQ emits 'failed' per-attempt; only OPS-ALERT on the terminal
      // attempt so transient retries don't pollute alert dashboards.
      const attemptsMade = job?.attemptsMade ?? 0;
      const maxAttempts = job?.opts?.attempts ?? JOB_OPTIONS.attempts;
      const isTerminal = attemptsMade >= maxAttempts;
      if (isTerminal) {
        this.logger.error(
          `[OPS-ALERT] community-rise-check job ${job?.id ?? '?'} failed terminally after ${attemptsMade} attempts: ${err.message}`,
          err.stack,
        );
      } else {
        this.logger.warn(
          `community-rise-check job ${job?.id ?? '?'} attempt ${attemptsMade}/${maxAttempts} failed — retrying: ${err.message}`,
        );
      }
    });

    this.logger.log(
      'CommunityRiseAlertWorker initialised — consuming community-rise-checks queue',
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    // redisQueueClient lives in RedisModule's lifecycle; don't quit it here.
    await this.redisForBlocking?.quit().catch(() => undefined);
  }

  /**
   * Cross-module enqueue. PhotoPipelineWorker calls this after a verified
   * price write so the threshold check runs out-of-band.
   *
   * The jobId includes a 30-minute time bucket so the BullMQ jobId-dedup
   * collapses bursts of submissions WITHIN a 30-min window into a single
   * threshold evaluation, while still allowing the NEXT bucket to enqueue
   * a fresh check. Without the bucket, the bare voivodeship+fuel jobId
   * would be permanently deduplicated as long as the previous job sat
   * inside `removeOnComplete: { count: 200 }` retention — locking out
   * re-evaluation for fresh price data after the very first completion.
   *
   * The 30-min bucket is conservative against the 48h send-dedup at the
   * service layer: we re-check the threshold up to ~96 times across a
   * single dedup window, but the service won't actually send until the
   * old dedup expires.
   */
  async enqueueCheck(data: CommunityRiseCheckJobData): Promise<void> {
    if (!this.queue) {
      // Boot-race guard. A verification arriving before onModuleInit wired
      // the queue would otherwise crash with `undefined.add`. Log + skip —
      // the cold-boot window is small and the next submission for this
      // voivodeship+fuel will get its own enqueue.
      this.logger.warn(
        `Queue not yet initialised — dropping community-rise-check for ${data.voivodeship}/${data.fuelType}`,
      );
      return;
    }
    const bucket = Math.floor(Date.now() / (30 * 60 * 1000));
    try {
      await this.queue.add(COMMUNITY_RISE_CHECK_JOB, data, {
        jobId: `community-rise:${data.voivodeship}:${data.fuelType}:${bucket}`,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to enqueue community-rise-check for ${data.voivodeship}/${data.fuelType}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Exposed for ops + integration tests. */
  getQueue(): Queue {
    return this.queue;
  }
}
