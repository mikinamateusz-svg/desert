import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { ResearchRetentionService } from '../research/research-retention.service.js';

const QUEUE_NAME = 'photo-cleanup';
const CLEANUP_JOB = 'cleanup-old-photos';
const SHADOW_REJECTED_RETENTION_DAYS = 30;
const BATCH_SIZE = 100;

const JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 60_000 },
};

@Injectable()
export class PhotoCleanupWorker implements OnModuleInit {
  private readonly logger = new Logger(PhotoCleanupWorker.name);
  private queue!: Queue;
  private rejectedRetentionDays!: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
    private readonly researchRetention: ResearchRetentionService,
  ) {}

  async onModuleInit() {
    if (process.env['MINIMAL_WORKERS'] === 'true') {
      this.logger.log('PhotoCleanupWorker skipped (MINIMAL_WORKERS=true)');
      return;
    }

    const raw = this.config.get<string>('REJECTED_PHOTO_RETENTION_DAYS', '2');
    const parsed = parseInt(raw, 10);
    this.rejectedRetentionDays = Number.isFinite(parsed) && parsed > 0 ? parsed : 2;

    const redisUrl = this.config.getOrThrow<string>('BULL_REDIS_URL');
    const queueRedis = new Redis(redisUrl, { maxRetriesPerRequest: null });
    const workerRedis = new Redis(redisUrl, { maxRetriesPerRequest: null });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.queue = new Queue(QUEUE_NAME, { connection: queueRedis as any });

    const worker = new Worker(
      QUEUE_NAME,
      async () => {
        await this.cleanupRejectedPhotos();
        await this.cleanupStalePhotos();
        await this.researchRetention.cleanupExpired();
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { connection: workerRedis as any, concurrency: 1 },
    );
    worker.on('failed', (_job, err) =>
      this.logger.error(`Photo cleanup failed: ${err.message}`),
    );

    // Run daily at 03:00 UTC — low-traffic window
    await this.queue.add(CLEANUP_JOB, {}, {
      repeat: { pattern: '0 3 * * *' },
      jobId: 'daily-photo-cleanup',
      ...JOB_OPTIONS,
    });

    this.logger.log(
      `Photo cleanup worker initialized — runs daily at 03:00 UTC ` +
      `(rejected retention: ${this.rejectedRetentionDays}d, shadow_rejected retention: ${SHADOW_REJECTED_RETENTION_DAYS}d)`,
    );
  }

  /** Delete photos for `rejected` submissions older than REJECTED_PHOTO_RETENTION_DAYS. */
  private async cleanupRejectedPhotos(): Promise<void> {
    const cutoff = new Date(Date.now() - this.rejectedRetentionDays * 86_400_000);

    const stale = await this.prisma.submission.findMany({
      where: {
        status: 'rejected',
        photo_r2_key: { not: null },
        created_at: { lt: cutoff },
      },
      select: { id: true, photo_r2_key: true },
      take: BATCH_SIZE,
    });

    if (stale.length === 0) {
      this.logger.log(`No rejected photos older than ${this.rejectedRetentionDays} days to clean up`);
      return;
    }

    let deleted = 0;
    for (const sub of stale) {
      try {
        await this.storage.deleteObject(sub.photo_r2_key!);
        await this.prisma.submission.update({
          where: { id: sub.id },
          data: { photo_r2_key: null },
        });
        deleted++;
      } catch (e: unknown) {
        this.logger.warn(
          `Failed to delete rejected photo ${sub.photo_r2_key}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    this.logger.log(`Rejected photo cleanup: deleted ${deleted}/${stale.length} photos older than ${this.rejectedRetentionDays} days`);
  }

  /** Delete photos for non-rejected submissions (shadow_rejected etc.) older than 30 days. */
  private async cleanupStalePhotos(): Promise<void> {
    const cutoff = new Date(Date.now() - SHADOW_REJECTED_RETENTION_DAYS * 86_400_000);

    const stale = await this.prisma.submission.findMany({
      where: {
        status: { not: 'rejected' },
        photo_r2_key: { not: null },
        created_at: { lt: cutoff },
      },
      select: { id: true, photo_r2_key: true },
      take: BATCH_SIZE,
    });

    if (stale.length === 0) {
      this.logger.log(`No stale photos older than ${SHADOW_REJECTED_RETENTION_DAYS} days to clean up`);
      return;
    }

    let deleted = 0;
    for (const sub of stale) {
      try {
        await this.storage.deleteObject(sub.photo_r2_key!);
        await this.prisma.submission.update({
          where: { id: sub.id },
          data: { photo_r2_key: null },
        });
        deleted++;
      } catch (e: unknown) {
        this.logger.warn(
          `Failed to delete stale photo ${sub.photo_r2_key}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    this.logger.log(`Stale photo cleanup: deleted ${deleted}/${stale.length} photos older than ${SHADOW_REJECTED_RETENTION_DAYS} days`);
  }
}
