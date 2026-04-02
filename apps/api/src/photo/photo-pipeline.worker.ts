import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import { SubmissionStatus, type Submission, type Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { StationService, type NearbyStationWithDistance } from '../station/station.service.js';
import { OcrService } from '../ocr/ocr.service.js';

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
    private readonly ocrService: OcrService,
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
      const submissionId = job?.data?.submissionId ?? 'unknown';
      this.logger.error(`Photo pipeline job failed for submission ${submissionId}: ${err.message}`);

      // GDPR: if all retries are exhausted, null GPS coords so they don't linger in the DB.
      const attemptsAllowed = job?.opts?.attempts ?? JOB_OPTIONS.attempts;
      if (job && (job.attemptsMade ?? 0) >= attemptsAllowed) {
        this.prisma.submission
          .update({ where: { id: submissionId }, data: { gps_lat: null, gps_lng: null } })
          .catch((e: Error) =>
            this.logger.error(
              `Failed to null GPS on final failure for ${submissionId}: ${e.message}`,
            ),
          );
      }
    });

    this.logger.log('PhotoPipelineWorker initialised (Stories 3.4 GPS + 3.5 OCR active)');
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

    // Story 3.5: OCR price extraction
    const ocrComplete = await this.runOcrExtraction(submission);
    if (!ocrComplete) {
      return; // rejected inside runOcrExtraction — do not proceed
    }

    // Stories 3.6 (logo recognition), 3.7 (validation) — stubs
    this.logger.log(
      `Submission ${submissionId}: OCR complete — logo/validation deferred to Stories 3.6+`,
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

  // ── OCR extraction step ────────────────────────────────────────────────────

  /**
   * Fetches photo from R2, calls Claude Haiku for OCR, validates result.
   * Returns true if OCR succeeded and the submission should proceed.
   * Returns false if the submission was rejected (caller should return).
   * Throws on transient API/infra failure (BullMQ retries).
   *
   * IMPORTANT: does NOT delete the photo on success — that is Story 3.7's responsibility.
   */
  private async runOcrExtraction(
    submission: Pick<Submission, 'id' | 'photo_r2_key'>,
  ): Promise<boolean> {
    // AC7: no photo — reject without calling Claude (saves API cost)
    if (!submission.photo_r2_key) {
      await this.rejectSubmission(submission, 'missing_photo');
      return false;
    }

    // Fetch photo from R2 — throws on S3 error (transient → BullMQ retries)
    const photoBuffer = await this.storageService.getObjectBuffer(submission.photo_r2_key);

    // Call Claude Haiku — throws on API error (transient → BullMQ retries)
    const ocrResult = await this.ocrService.extractPrices(photoBuffer);

    this.logger.log(
      `Submission ${submission.id}: OCR confidence=${ocrResult.confidence_score.toFixed(2)}, ` +
        `prices found=${ocrResult.prices.length}`,
    );

    // AC3: low confidence → reject, delete photo, no retry
    if (ocrResult.confidence_score < 0.4) {
      await this.rejectSubmission(submission, 'low_ocr_confidence');
      return false;
    }

    // No prices extracted — reject to keep data quality high (see Q1 in story spec)
    if (ocrResult.prices.length === 0) {
      await this.rejectSubmission(submission, 'no_prices_extracted');
      return false;
    }

    // AC4: validate price bands
    const invalidFuelType = this.ocrService.validatePriceBands(ocrResult.prices);
    if (invalidFuelType) {
      this.logger.warn(
        `Submission ${submission.id}: price out of range for ${invalidFuelType} — rejecting`,
      );
      await this.rejectSubmission(submission, 'price_out_of_range');
      return false;
    }

    // AC2: store extracted prices and confidence score
    // Note: do NOT change status to 'verified' — Story 3.7 does that after full validation
    await this.prisma.submission.update({
      where: { id: submission.id },
      data: {
        price_data: ocrResult.prices as unknown as Prisma.InputJsonValue,
        ocr_confidence_score: ocrResult.confidence_score,
      },
    });

    return true;
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
