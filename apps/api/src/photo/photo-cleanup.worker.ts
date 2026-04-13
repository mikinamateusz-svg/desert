import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';

const QUEUE_NAME = 'photo-cleanup';
const CLEANUP_JOB = 'cleanup-old-photos';
const RETENTION_DAYS = 30;
const BATCH_SIZE = 100;

const JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 60_000 },
};

@Injectable()
export class PhotoCleanupWorker implements OnModuleInit {
  private readonly logger = new Logger(PhotoCleanupWorker.name);
  private queue!: Queue;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    const redisUrl = this.config.getOrThrow<string>('BULL_REDIS_URL');
    const queueRedis = new Redis(redisUrl, { maxRetriesPerRequest: null });
    const workerRedis = new Redis(redisUrl, { maxRetriesPerRequest: null });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.queue = new Queue(QUEUE_NAME, { connection: queueRedis as any });

    const worker = new Worker(
      QUEUE_NAME,
      async () => this.cleanupOldPhotos(),
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

    this.logger.log('Photo cleanup worker initialized — runs daily at 03:00 UTC');
  }

  private async cleanupOldPhotos(): Promise<void> {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000);

    // Find submissions with photos older than 30 days
    const stale = await this.prisma.submission.findMany({
      where: {
        photo_r2_key: { not: null },
        created_at: { lt: cutoff },
      },
      select: { id: true, photo_r2_key: true },
      take: BATCH_SIZE,
    });

    if (stale.length === 0) {
      this.logger.log('No photos older than 30 days to clean up');
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
          `Failed to delete photo ${sub.photo_r2_key}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    this.logger.log(`Photo cleanup: deleted ${deleted}/${stale.length} photos older than ${RETENTION_DAYS} days`);
  }
}
