import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type Job } from 'bullmq';
import Redis from 'ioredis';

export const PHOTO_PIPELINE_QUEUE = 'photo-pipeline';
export const PHOTO_PIPELINE_JOB = 'process-submission';

export interface PhotoPipelineJobData {
  submissionId: string;
}

const JOB_OPTIONS = {
  attempts: 4, // 1 initial + 3 retries; Stories 3.4–3.7 will implement actual processing
  backoff: { type: 'custom' as const },
} as const;

@Injectable()
export class PhotoPipelineWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PhotoPipelineWorker.name);
  private queue!: Queue;
  private worker!: Worker;
  // Dedicated Redis connection — BullMQ requires maxRetriesPerRequest: null
  private redisForBullMQ!: Redis;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const redisUrl = this.config.getOrThrow<string>('BULL_REDIS_URL');
    this.redisForBullMQ = new Redis(redisUrl, { maxRetriesPerRequest: null });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const connection = this.redisForBullMQ as any;

    this.queue = new Queue(PHOTO_PIPELINE_QUEUE, {
      connection,
      defaultJobOptions: JOB_OPTIONS,
    });

    this.worker = new Worker<PhotoPipelineJobData>(
      PHOTO_PIPELINE_QUEUE,
      async (job: Job<PhotoPipelineJobData>) => {
        // Story 3.4: GPS-to-station matching
        // Story 3.5: OCR price extraction
        // Story 3.7: price validation + photo deletion from R2
        this.logger.log(
          `[stub] Photo pipeline job received for submission ${job.data.submissionId} — processing deferred to Story 3.4+`,
        );
      },
      {
        connection,
        settings: {
          backoffStrategy: () => 30_000, // uniform 30s for stub; Stories 3.4+ will tune
        },
      },
    );

    this.worker.on('failed', (job: Job | undefined, err: Error) => {
      this.logger.error(
        `Photo pipeline job failed for submission ${job?.data?.submissionId ?? 'unknown'}: ${err.message}`,
      );
    });

    this.logger.log('PhotoPipelineWorker initialised (stub — processing deferred to Story 3.4+)');
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    await this.redisForBullMQ?.quit();
  }

  async enqueue(submissionId: string): Promise<void> {
    await this.queue.add(
      PHOTO_PIPELINE_JOB,
      { submissionId },
      {
        jobId: `photo-${submissionId}`, // dedup — safe to call multiple times for same submission
        ...JOB_OPTIONS,
      },
    );
  }

  /** Exposed for tests and ops tooling */
  getQueue(): Queue {
    return this.queue;
  }
}
