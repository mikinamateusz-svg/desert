import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import { SubmissionStatus, type Submission } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { StationService, type NearbyStationWithDistance } from '../station/station.service.js';

export const PHOTO_PIPELINE_QUEUE = 'photo-pipeline';
export const PHOTO_PIPELINE_JOB = 'process-submission';

export interface PhotoPipelineJobData {
  submissionId: string;
}

// Retry delays for transient infra failures (DB down, Redis unavailable).
// GPS match failures do NOT retry — they complete the job gracefully.
const BACKOFF_DELAYS_MS = [30_000, 120_000, 600_000] as const; // 30s → 2m → 10m

const JOB_OPTIONS = {
  attempts: 4, // 1 initial + 3 retries
  backoff: { type: 'custom' as const },
} as const;

@Injectable()
export class PhotoPipelineWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PhotoPipelineWorker.name);
  private queue!: Queue;
  private worker!: Worker;
  // Dedicated Redis connection — BullMQ requires maxRetriesPerRequest: null
  private redisForBullMQ!: Redis;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly stationService: StationService,
    private readonly storageService: StorageService,
  ) {}

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
        await this.processJob(job);
      },
      {
        connection,
        settings: {
          backoffStrategy: (attemptsMade: number) =>
            BACKOFF_DELAYS_MS[attemptsMade - 1] ?? BACKOFF_DELAYS_MS[BACKOFF_DELAYS_MS.length - 1],
        },
      },
    );

    this.worker.on('failed', (job: Job | undefined, err: Error) => {
      this.logger.error(
        `Photo pipeline job failed for submission ${job?.data?.submissionId ?? 'unknown'}: ${err.message}`,
      );
    });

    this.logger.log('PhotoPipelineWorker initialised (Story 3.4 GPS matching active)');
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

  // ── Job processor ──────────────────────────────────────────────────────────

  private async processJob(job: Job<PhotoPipelineJobData>): Promise<void> {
    const { submissionId } = job.data;

    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
    });

    if (!submission) {
      this.logger.warn(`Submission ${submissionId} not found — skipping (may have been deleted)`);
      return;
    }

    if (submission.status !== SubmissionStatus.pending) {
      this.logger.log(
        `Submission ${submissionId} already processed (status: ${submission.status}) — skipping`,
      );
      return;
    }

    // Story 3.4: GPS-to-station matching
    const candidates = await this.runGpsMatching(submission);
    if (candidates === null) {
      return; // rejected inside runGpsMatching — do not proceed
    }

    // Stories 3.5 (OCR), 3.6 (logo recognition), 3.7 (validation) — stubs
    this.logger.log(
      `Submission ${submissionId}: GPS matched to ${candidates[0]?.name ?? 'preselected'} — OCR/logo/validation deferred to Stories 3.5+`,
    );
  }

  // ── GPS matching step ──────────────────────────────────────────────────────

  /**
   * Returns candidate stations on match, or null if the submission was rejected.
   * Preselected station path (station_id already set): nulls GPS coords and returns [].
   */
  private async runGpsMatching(
    submission: Submission,
  ): Promise<NearbyStationWithDistance[] | null> {
    // Preselected station: user already chose a station — just null GPS per GDPR
    if (submission.station_id !== null) {
      await this.prisma.submission.update({
        where: { id: submission.id },
        data: { gps_lat: null, gps_lng: null },
      });
      this.logger.log(
        `Submission ${submission.id}: preselected station ${submission.station_id} — GPS cleared`,
      );
      return [];
    }

    // No GPS available — reject immediately
    if (submission.gps_lat === null || submission.gps_lng === null) {
      await this.rejectSubmission(submission, 'no_gps_coordinates');
      return null;
    }

    // PostGIS match — throws on DB/PostGIS error so BullMQ retries
    const candidates = await this.stationService.findNearbyWithDistance(
      submission.gps_lat,
      submission.gps_lng,
    );

    if (candidates.length === 0) {
      await this.rejectSubmission(submission, 'no_station_match');
      return null;
    }

    // Match found — set station_id, null GPS coords
    await this.prisma.submission.update({
      where: { id: submission.id },
      data: {
        station_id: candidates[0].id,
        gps_lat: null,
        gps_lng: null,
      },
    });

    this.logger.log(
      `Submission ${submission.id}: matched to ${candidates[0].name} (${candidates[0].distance_m.toFixed(0)}m away)`,
    );

    return candidates;
  }

  private async rejectSubmission(
    submission: Pick<Submission, 'id' | 'photo_r2_key'>,
    reason: string,
  ): Promise<void> {
    this.logger.warn(`Submission ${submission.id}: rejected — ${reason}`);

    await this.prisma.submission.update({
      where: { id: submission.id },
      data: {
        status: SubmissionStatus.rejected,
        gps_lat: null,
        gps_lng: null,
      },
    });

    if (submission.photo_r2_key) {
      await this.storageService
        .deleteObject(submission.photo_r2_key)
        .catch((err: Error) =>
          this.logger.error(
            `Failed to delete R2 object ${submission.photo_r2_key} for submission ${submission.id}: ${err.message}`,
          ),
        );
    }
  }
}
