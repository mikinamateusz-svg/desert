import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import { SubmissionStatus, UserRole, type Submission, type Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { StationService, type NearbyStationWithDistance } from '../station/station.service.js';
import { OcrService, type ExtractedPrice } from '../ocr/ocr.service.js';
import { LogoService } from '../logo/logo.service.js';
import { PriceService } from '../price/price.service.js';
import { PriceValidationService } from '../price/price-validation.service.js';
import { OcrSpendService } from './ocr-spend.service.js';
import { SubmissionDedupService } from './submission-dedup.service.js';
import { TrustScoreService } from '../user/trust-score.service.js';
import { ResearchRetentionService } from '../research/research-retention.service.js';

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

// Alert when this many submissions are sitting in the dead-letter queue (failed state).
const DLQ_DEPTH_ALERT_THRESHOLD = 10;

@Injectable()
export class PhotoPipelineWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PhotoPipelineWorker.name);
  private queue!: Queue;
  private worker!: Worker;
  // BullMQ requires separate Redis connections for Queue and Worker
  private redisForQueue!: Redis;
  private redisForWorker!: Redis;
  // Story 3.9: true when worker has been paused due to daily spend cap
  private pausedForSpendCap = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly stationService: StationService,
    private readonly storageService: StorageService,
    private readonly ocrService: OcrService,
    private readonly logoService: LogoService,
    private readonly priceService: PriceService,
    private readonly priceValidationService: PriceValidationService,
    private readonly ocrSpendService: OcrSpendService,
    private readonly submissionDedupService: SubmissionDedupService,
    private readonly trustScoreService: TrustScoreService,
    private readonly researchRetention: ResearchRetentionService,
  ) {}

  async onModuleInit(): Promise<void> {
    const redisUrl = this.config.getOrThrow<string>('BULL_REDIS_URL');
    this.redisForQueue = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.redisForWorker = new Redis(redisUrl, { maxRetriesPerRequest: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const queueConnection = this.redisForQueue as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const workerConnection = this.redisForWorker as any;

    this.queue = new Queue(PHOTO_PIPELINE_QUEUE, {
      connection: queueConnection,
      defaultJobOptions: JOB_OPTIONS,
    });

    const rateLimitRaw = parseInt(
      this.config.get<string>('OCR_WORKER_RATE_LIMIT_PER_MINUTE', '60'),
      10,
    );
    const rateLimit = Number.isFinite(rateLimitRaw) && rateLimitRaw > 0 ? rateLimitRaw : 60;

    this.worker = new Worker<PhotoPipelineJobData>(
      PHOTO_PIPELINE_QUEUE,
      async (job: Job<PhotoPipelineJobData>) => {
        await this.processJob(job);
      },
      {
        connection: workerConnection,
        limiter: { max: rateLimit, duration: 60_000 },
        settings: {
          backoffStrategy: (attemptsMade: number) =>
            BACKOFF_DELAYS_MS[attemptsMade - 1] ?? BACKOFF_DELAYS_MS[BACKOFF_DELAYS_MS.length - 1],
        },
      },
    );

    this.worker.on('failed', (job: Job | undefined, err: Error) => {
      const submissionId = job?.data?.submissionId ?? 'unknown';
      this.logger.error(`Photo pipeline job failed for submission ${submissionId}: ${err.message}`);

      const attemptsAllowed = job?.opts?.attempts ?? JOB_OPTIONS.attempts;
      if (job && (job.attemptsMade ?? 0) >= attemptsAllowed) {
        // P-3: guard against missing submissionId — alert ops but skip DB/R2 cleanup
        if (!submissionId || submissionId === 'unknown') {
          this.logger.error(
            `[OPS-ALERT] Pipeline job moved to dead-letter queue with unknown submissionId. Failure: ${err.message}`,
          );
          return;
        }
        // Final failure — all retries exhausted. Clean up and alert ops.
        this.handleFinalFailure(submissionId, err).catch((e: Error) =>
          this.logger.error(
            `Unhandled error in handleFinalFailure for ${submissionId}: ${e.message}`,
          ),
        );
      }
    });

    this.scheduleMidnightReset();
    this.logger.log('PhotoPipelineWorker initialised (Stories 3.4 GPS + 3.5 OCR + 3.6 Logo + 3.7 Price Validation + 3.9 Cost Controls active)');
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    await Promise.allSettled([this.redisForQueue?.quit(), this.redisForWorker?.quit()]);
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

  /**
   * Manual re-enqueue — used by the admin requeue endpoint when a submission
   * was shadow_rejected (e.g. for `low_trust`) and needs to flow through the
   * pipeline again after the underlying block has been cleared. Uses a unique
   * jobId (timestamp suffix) so BullMQ's jobId dedup doesn't silently drop
   * the request against the original completed job still in Redis history.
   */
  async requeue(submissionId: string): Promise<void> {
    await this.queue.add(
      PHOTO_PIPELINE_JOB,
      { submissionId },
      {
        jobId: `photo-${submissionId}-requeue-${Date.now()}`,
        ...JOB_OPTIONS,
      },
    );
  }

  /** Exposed for tests and ops tooling */
  getQueue(): Queue {
    return this.queue;
  }

  /** Resume the worker after a spend-cap pause. Called by Story 4.4 admin endpoint. */
  resumeWorker(): void {
    if (this.pausedForSpendCap) {
      try {
        this.worker.resume();
      } catch (e: unknown) {
        this.logger.error(`Failed to manually resume worker: ${(e as Error).message}`);
        return;
      }
      this.pausedForSpendCap = false;
      this.logger.log('OCR worker manually resumed by admin');
    }
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

    // Resolve stationId: GPS path uses candidates[0], preselect path uses submission.station_id
    const stationId = candidates.length > 0 ? candidates[0].id : submission.station_id;

    // Story 3.10: L2 station dedup — skip OCR if a verified result exists for this station
    // Skip on retry: ocr_confidence_score already set means OCR ran in a prior BullMQ attempt
    if (stationId && submission.ocr_confidence_score === null) {
      try {
        const isDuplicate = await this.submissionDedupService.checkStationDedup(stationId);
        if (isDuplicate) {
          this.logger.log(
            `[DEDUP-L2] station=${stationId} submission=${submissionId} — recent verified result exists, skipping OCR`,
          );
          await this.rejectSubmission(submission, 'duplicate_submission');
          return;
        }
      } catch (e: unknown) {
        this.logger.warn(`[DEDUP-L2] Redis check failed, proceeding normally: ${(e as Error).message}`);
      }
    }

    // Story 3.5: OCR price extraction
    const ocrResult = await this.runOcrExtraction(submission, stationId);
    if (!ocrResult) {
      return; // rejected inside runOcrExtraction — do not proceed
    }
    const { trustScore, ocrPrices } = ocrResult;

    // Story 3.6: logo recognition (secondary signal — never blocks pipeline)
    const logoFlagged = await this.runLogoRecognition(submission, candidates, trustScore, ocrPrices);
    if (logoFlagged) {
      return; // submission flagged for ops review — do not proceed to Story 3.7
    }

    // Story 3.7: price validation + database update
    // stationId already resolved above
    if (!stationId) {
      this.logger.error(
        `Submission ${submissionId}: no stationId after GPS matching — cannot validate prices`,
      );
      await this.rejectSubmission(submission, 'no_station_id');
      return;
    }
    await this.runPriceValidationAndUpdate(submissionId, stationId);
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

    // Match found — set station_id. GPS coords are retained until the submission is
    // either verified (nulled in runPriceValidationAndUpdate) or flagged for admin review
    // (nulled when admin approves/rejects). This lets ops see where the photo was taken
    // if the submission is flagged for a logo mismatch.
    await this.prisma.submission.update({
      where: { id: submission.id },
      data: { station_id: candidates[0].id },
    });

    this.logger.log(
      `Submission ${submission.id}: matched to ${candidates[0].name} (${candidates[0].distance_m.toFixed(0)}m away)`,
    );

    return candidates;
  }

  // ── OCR extraction step ────────────────────────────────────────────────────

  /**
   * Fetches photo from R2, calls Claude Haiku for OCR, validates result.
   * Returns { trustScore } if OCR succeeded and the submission should proceed.
   * Returns null if the submission was rejected (caller should return).
   * Throws on transient API/infra failure (BullMQ retries).
   *
   * IMPORTANT: does NOT delete the photo on success — that is Story 3.7's responsibility.
   */
  private async runOcrExtraction(
    submission: Pick<Submission, 'id' | 'user_id' | 'photo_r2_key' | 'ocr_confidence_score' | 'station_id' | 'created_at'>,
    stationId: string | null,
  ): Promise<{ trustScore: number; ocrPrices: ExtractedPrice[] } | null> {
    // AC7: no photo — reject without calling Claude (saves API cost)
    if (!submission.photo_r2_key) {
      await this.rejectSubmission(submission, 'missing_photo');
      return null;
    }

    // Fetch photo from R2 — throws on S3 error (transient → BullMQ retries)
    const photoBuffer = await this.storageService.getObjectBuffer(submission.photo_r2_key);

    // Story 3.10: hash dedup — skip Claude if this exact photo was submitted recently
    // Skip on retry: ocr_confidence_score already set means OCR ran in a prior BullMQ attempt
    const photoHash = SubmissionDedupService.computePhotoHash(photoBuffer);
    if (submission.ocr_confidence_score === null) {
      try {
        const isHashDuplicate = await this.submissionDedupService.checkHashDedup(photoHash);
        if (isHashDuplicate) {
          this.logger.log(
            `[DEDUP-HASH] hash=${photoHash.slice(0, 8)} submission=${submission.id} — duplicate photo, skipping OCR`,
          );
          await this.rejectSubmission(submission, 'duplicate_submission');
          return null;
        }
      } catch (e: unknown) {
        this.logger.warn(`[DEDUP-HASH] Redis check failed, proceeding normally: ${(e as Error).message}`);
      }
    }

    // Call Claude Haiku — throws on API error (transient → BullMQ retries)
    const ocrResult = await this.ocrService.extractPrices(photoBuffer);

    // Record spend and check daily cap (Story 3.9)
    const costUsd = this.ocrSpendService.computeCostUsd(
      ocrResult.input_tokens,
      ocrResult.output_tokens,
    );
    // Hard limit: if Redis is down and spend can't be tracked, let the error
    // propagate so BullMQ retries the job later. Prevents uncapped OCR spend.
    // To switch to soft limit, replace the throw with `return 0`.
    const dailySpend = await this.ocrSpendService.recordSpend(costUsd).catch((e: Error) => {
      this.logger.error(`Failed to record OCR spend (hard limit): ${e.message} — job will retry`);
      throw e;
    });
    await this.checkSpendCap(dailySpend);

    this.logger.log(
      `Submission ${submission.id}: OCR confidence=${ocrResult.confidence_score.toFixed(2)}, ` +
        `prices found=${ocrResult.prices.length}`,
    );

    // Story 4.3: Trust score gating — fetch user trust score + role
    const userRecord = await this.prisma.user.findUnique({
      where: { id: submission.user_id },
      select: { trust_score: true, role: true },
    });
    const trustScore = userRecord?.trust_score ?? 100;
    const userRole = userRecord?.role ?? UserRole.DRIVER;

    // Low-trust users → review queue regardless of confidence.
    // ADMIN role bypasses trust-gating: admins are internal operators whose
    // submissions should flow through the normal pipeline so they can smoke-test
    // end-to-end. Otherwise every admin-taken photo lands in a shadow_rejected
    // queue that only the admin UI can drain — bootstrap problem if that UI is
    // itself broken. Log the bypass so it's visible in ops review.
    if (trustScore < 50) {
      if (userRole === UserRole.ADMIN) {
        this.logger.log(
          `Submission ${submission.id}: trust score ${trustScore} below threshold but user is ADMIN — bypassing trust-gate`,
        );
      } else {
        this.logger.log(
          `Submission ${submission.id}: trust score ${trustScore} below threshold 50 — routing to shadow_rejected (low_trust)`,
        );
        await this.prisma.submission.update({
          where: { id: submission.id },
          data: { status: SubmissionStatus.shadow_rejected, flag_reason: 'low_trust' },
        });
        // Research retention: shadow_rejected path keeps the photo in R2 (the
        // admin review queue needs it), but we still copy to `research/` so the
        // corpus includes low-trust-shadowed samples alongside verified ones.
        if (submission.photo_r2_key) {
          await this.researchRetention.captureIfEnabled({
            submissionId: submission.id,
            stationId,
            photoR2Key: submission.photo_r2_key,
            ocrPrices: ocrResult.prices,
            finalPrices: null,
            finalStatus: SubmissionStatus.shadow_rejected,
            flagReason: 'low_trust',
            capturedAt: submission.created_at,
          });
        }
        return null;
      }
    }

    // AC3: low confidence → reject, delete photo, no retry
    if (ocrResult.confidence_score < 0.4) {
      await this.rejectSubmission(submission, 'low_ocr_confidence', ocrResult.prices, ocrResult.confidence_score);
      return null;
    }

    // No prices extracted — reject to keep data quality high (see Q1 in story spec)
    if (ocrResult.prices.length === 0) {
      await this.rejectSubmission(submission, 'no_prices_extracted', ocrResult.prices, ocrResult.confidence_score);
      return null;
    }

    // AC4: validate price bands
    const invalidFuelType = this.ocrService.validatePriceBands(ocrResult.prices);
    if (invalidFuelType) {
      this.logger.warn(
        `Submission ${submission.id}: price out of range for ${invalidFuelType} — rejecting`,
      );
      await this.rejectSubmission(submission, 'price_out_of_range', ocrResult.prices, ocrResult.confidence_score);
      return null;
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

    // Story 3.10: record dedup keys — best-effort, non-blocking
    if (stationId) {
      this.submissionDedupService.recordStationDedup(stationId).catch((e: Error) =>
        this.logger.warn(`Failed to record station dedup key: ${e.message}`),
      );
    }
    this.submissionDedupService.recordHashDedup(photoHash).catch((e: Error) =>
      this.logger.warn(`Failed to record hash dedup key: ${e.message}`),
    );

    return { trustScore, ocrPrices: ocrResult.prices };
  }

  // ── Logo recognition step ──────────────────────────────────────────────────

  /**
   * Logo recognition — secondary signal for station disambiguation.
   * Runs ONLY when GPS match is ambiguous (two candidates at similar distances).
   * Never throws — all failures fall through to "proceed on GPS match".
   *
   * Returns true if the submission was flagged for ops review (caller should return).
   * Returns false in all other cases (pipeline continues to Story 3.7).
   *
   * NOTE: Photo is NOT deleted here — Story 3.7 handles deletion.
   */
  private async runLogoRecognition(
    submission: Pick<Submission, 'id' | 'user_id' | 'photo_r2_key' | 'station_id' | 'created_at'>,
    candidates: NearbyStationWithDistance[],
    trustScore: number,
    ocrPrices: ExtractedPrice[],
  ): Promise<boolean> {
    // AC1 + AC2: evaluate ambiguity threshold
    if (!this.isAmbiguousMatch(candidates)) {
      this.logger.log(
        `Submission ${submission.id}: logo recognition skipped — GPS match is unambiguous`,
      );
      return false;
    }

    this.logger.log(
      `Submission ${submission.id}: logo recognition running — ` +
        `${candidates.length} candidates, nearest=${candidates[0]?.distance_m.toFixed(0)}m, ` +
        `second=${candidates[1]?.distance_m.toFixed(0)}m`,
    );

    // Story 4.3: High-trust bypass — skip logo check for trusted users with borderline confidence
    if (trustScore >= 200) {
      this.logger.log(
        `Submission ${submission.id}: logo recognition skipped — high trust score (${trustScore})`,
      );
      return false;
    }

    // Guard: no photo — skip silently (missing_photo already handled by OCR step,
    // but guard defensively in case photo_r2_key was nulled between steps)
    if (!submission.photo_r2_key) {
      this.logger.warn(
        `Submission ${submission.id}: logo recognition skipped — photo_r2_key is null`,
      );
      return false;
    }

    // Fetch photo from R2 — catch all errors (logo recognition is optional)
    let photoBuffer: Buffer;
    try {
      photoBuffer = await this.storageService.getObjectBuffer(submission.photo_r2_key);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Submission ${submission.id}: logo recognition — R2 fetch failed: ${message}. Proceeding on GPS match.`,
      );
      return false;
    }

    // Call Claude Haiku for brand recognition (errors caught inside recogniseBrand — returns null brand)
    const logoResult = await this.logoService.recogniseBrand(photoBuffer);

    this.logger.log(
      `Submission ${submission.id}: logo recognition result — ` +
        `brand=${logoResult.brand ?? 'null'}, confidence=${logoResult.confidence.toFixed(2)}`,
    );

    // GPS-matched station's brand (from candidates list — brand added to findNearbyWithDistance in Story 3.6)
    const matchedStationBrand = candidates[0]?.brand ?? null;

    const evaluation = this.logoService.evaluateMatch(logoResult, matchedStationBrand);

    if (evaluation === 'mismatch') {
      // AC5: contradicting signal — flag for ops review
      this.logger.warn(
        `Submission ${submission.id}: logo mismatch — ` +
          `detected "${logoResult.brand}", GPS-matched station brand "${matchedStationBrand}". ` +
          `Flagging for ops review.`,
      );
      try {
        await this.prisma.submission.update({
          where: { id: submission.id },
          data: { status: SubmissionStatus.shadow_rejected, flag_reason: 'logo_mismatch' },
        });
        await this.trustScoreService
          .updateScore(submission.user_id, TrustScoreService.DELTA_SHADOW_REJECTED)
          .catch((e: Error) => this.logger.warn(`Failed to update trust score: ${e.message}`));
        // Research retention: logo_mismatch shadow leaves photo in R2 for ops
        // review; the research copy gives us a parallel, stable path for the
        // benchmark corpus.
        if (submission.photo_r2_key) {
          await this.researchRetention.captureIfEnabled({
            submissionId: submission.id,
            stationId: submission.station_id,
            photoR2Key: submission.photo_r2_key,
            ocrPrices,
            finalPrices: null,
            finalStatus: SubmissionStatus.shadow_rejected,
            flagReason: 'logo_mismatch',
            capturedAt: submission.created_at,
          });
        }
        return true; // flagged — caller returns early
      } catch (err) {
        // DB failure writing shadow_rejected — log and proceed rather than triggering BullMQ
        // retry (which would re-run OCR unnecessarily for a logo-step DB issue)
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Submission ${submission.id}: failed to write shadow_rejected status — ${message}. Proceeding on GPS match.`,
        );
        return false;
      }
    }

    // AC4: match confirmed, or AC6: inconclusive — both proceed on GPS match
    if (evaluation === 'match') {
      this.logger.log(`Submission ${submission.id}: logo recognition confirmed GPS match`);
    } else {
      this.logger.log(
        `Submission ${submission.id}: logo recognition inconclusive — proceeding on GPS match`,
      );
    }
    return false;
  }

  /**
   * Returns true if the GPS match is ambiguous (logo recognition should run).
   * Ambiguous = 2+ candidates AND nearest is NOT >50% closer than second nearest.
   */
  private isAmbiguousMatch(candidates: NearbyStationWithDistance[]): boolean {
    if (candidates.length < 2) return false;

    const nearest = candidates[0].distance_m;
    const secondNearest = candidates[1].distance_m;

    // Unambiguous: nearest is >50% closer than second nearest (nearest < 0.5 * second)
    const isUnambiguous = nearest < 0.5 * secondNearest;
    return !isUnambiguous;
  }

  // ── Price validation & database update step ───────────────────────────────

  /**
   * Validates extracted prices against the 3-tier hierarchy (Story 3.7).
   * - Re-fetches submission to get the price_data written by the OCR step.
   * - Validates prices via PriceValidationService (Tier 1 / Tier 3).
   * - If all fail: rejects the submission (rejectSubmission handles photo deletion).
   * - If any pass: marks verified, deletes photo, publishes to cache + history,
   *   and clears staleness flags for each verified fuel type.
   */
  private async runPriceValidationAndUpdate(
    submissionId: string,
    stationId: string,
  ): Promise<void> {
    // Re-fetch to get price_data written by runOcrExtraction.
    // station_id + created_at are needed so rejectSubmission can hand off to
    // research retention when validation fails. ocr_confidence_score is
    // preserved on rejected rows for stats / debugging.
    const updated = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      select: {
        id: true,
        user_id: true,
        price_data: true,
        photo_r2_key: true,
        station_id: true,
        created_at: true,
        ocr_confidence_score: true,
      },
    });

    if (!updated) {
      this.logger.warn(`Submission ${submissionId}: not found during price validation — skipping`);
      return;
    }

    const rawPrices = updated.price_data as unknown as ExtractedPrice[];
    if (!Array.isArray(rawPrices) || rawPrices.length === 0) {
      await this.rejectSubmission(updated, 'price_validation_failed', rawPrices ?? []);
      return;
    }

    const { valid, invalid, rule_overall, rule_reason_code } =
      await this.priceValidationService.validatePrices(stationId, rawPrices);

    this.logger.log(
      `Submission ${submissionId}: price validation — ${valid.length} valid, ${invalid.length} invalid` +
        (rule_overall && rule_overall !== 'passed' ? ` (rule_overall=${rule_overall})` : ''),
    );

    // Log each out-of-band price for ops review (IG-1: structured log, 48h retention window)
    for (const inv of invalid) {
      this.logger.warn(
        `Submission ${submissionId}: out-of-band price — ` +
          `station=${stationId}, fuel_type=${inv.fuel_type}, ` +
          `price=${inv.price_per_litre}, reason=${inv.reason}`,
      );
    }

    if (valid.length === 0) {
      // If the rule evaluator flagged shadow_reject (data-driven sanity
      // layer) rather than raw Tier 1/3 failure, route to shadow_rejected so
      // the admin can review the photo + OCR output rather than deleting it.
      // See planning-artifacts/price-validation-framework.md §Decisions 3.
      if (rule_overall === 'shadow_reject') {
        const reason = rule_reason_code ?? 'price_validation_rule';
        await this.prisma.submission.update({
          where: { id: submissionId },
          data: { status: SubmissionStatus.shadow_rejected, flag_reason: reason },
        });
        if (updated.photo_r2_key) {
          await this.researchRetention.captureIfEnabled({
            submissionId,
            stationId: updated.station_id,
            photoR2Key: updated.photo_r2_key,
            ocrPrices: rawPrices,
            finalPrices: null,
            finalStatus: SubmissionStatus.shadow_rejected,
            flagReason: reason,
            capturedAt: updated.created_at,
          });
        }
        this.logger.log(
          `Submission ${submissionId}: all prices failed evaluator rules → shadow_rejected (${reason})`,
        );
        return;
      }
      await this.rejectSubmission(updated, 'price_validation_failed', rawPrices);
      return;
    }

    // Build price row for cache / history (validated prices only)
    const validatedPrices = valid.map(p => ({
      fuel_type: p.fuel_type,
      price_per_litre: p.price_per_litre,
    }));

    const priceRow = {
      stationId,
      prices: Object.fromEntries(valid.map(p => [p.fuel_type, p.price_per_litre])),
      sources: Object.fromEntries(
        valid.map(p => [p.fuel_type, 'community' as const]),
      ),
      updatedAt: new Date(),
    };

    // Update submission: mark verified, store validated prices only, null photo key + GPS atomically
    await this.prisma.submission.update({
      where: { id: submissionId },
      data: {
        status: SubmissionStatus.verified,
        price_data: validatedPrices as unknown as Prisma.InputJsonValue,
        photo_r2_key: null,
        gps_lat: null,
        gps_lng: null,
      },
    });

    // Research retention: verified submissions are the high-signal samples for
    // the benchmark corpus — we want rawPrices (what OCR saw) AND validatedPrices
    // (what shipped to the cache) so post-hoc we can tell which fuels got
    // dropped by validation. Run BEFORE the R2 delete below so the photo still
    // exists to copy.
    if (updated.photo_r2_key) {
      await this.researchRetention.captureIfEnabled({
        submissionId,
        stationId: updated.station_id,
        photoR2Key: updated.photo_r2_key,
        ocrPrices: rawPrices,
        finalPrices: validatedPrices,
        finalStatus: SubmissionStatus.verified,
        flagReason: null,
        capturedAt: updated.created_at,
      });
    }

    // Delete photo from R2 (best-effort — log on failure, do not throw)
    if (updated.photo_r2_key) {
      await this.storageService
        .deleteObject(updated.photo_r2_key)
        .catch((err: Error) =>
          this.logger.error(
            `Failed to delete R2 object ${updated.photo_r2_key} for submission ${submissionId}: ${err.message}`,
          ),
        );
    }

    // Write price history + invalidate / rewrite Redis cache (best-effort — DB fallback serves price on miss)
    await this.priceService.setVerifiedPrice(stationId, priceRow).catch((err: Error) =>
      this.logger.error(
        `Failed to write price cache/history for station ${stationId}, submission ${submissionId}: ${err.message}`,
      ),
    );

    // Clear staleness flags for all verified fuel types in a single batch query (best-effort)
    const validFuelTypes = valid.map(p => p.fuel_type);
    await this.prisma.stationFuelStaleness
      .deleteMany({ where: { station_id: stationId, fuel_type: { in: validFuelTypes } } })
      .catch((err: Error) =>
        this.logger.warn(
          `Failed to clear staleness for station ${stationId}: ${err.message}`,
        ),
      );

    // Story 4.3: increment trust score for auto-verified submission (fail-open)
    await this.trustScoreService
      .updateScore(updated.user_id, TrustScoreService.DELTA_AUTO_VERIFIED)
      .catch((e: Error) =>
        this.logger.warn(`Failed to update trust score for submission ${submissionId}: ${e.message}`),
      );

    this.logger.log(
      `Submission ${submissionId}: verified — ${valid.length} price(s) accepted for station ${stationId}`,
    );
  }

  // ── Dead-letter queue cleanup ─────────────────────────────────────────────

  /**
   * Called when a job exhausts all BullMQ retries (final failure).
   * - Updates submission to rejected + nulls GPS + nulls photo key
   * - Deletes photo from R2 (best-effort)
   * - Emits a structured ops alert log
   * - Checks DLQ depth and alerts if threshold exceeded
   */
  private async handleFinalFailure(submissionId: string, err: Error): Promise<void> {
    // Fetch current photo key before nulling it. Also pull station_id +
    // created_at + price_data so research retention can snapshot the DLQ case.
    const submission = await this.prisma.submission
      .findUnique({
        where: { id: submissionId },
        select: {
          id: true,
          photo_r2_key: true,
          station_id: true,
          created_at: true,
          price_data: true,
        },
      })
      .catch((e: Error) => {
        this.logger.error(
          `Failed to fetch submission ${submissionId} during DLQ cleanup: ${e.message}`,
        );
        return null;
      });

    // P-2: emit ops alert even when submission not found — job is in DLQ regardless
    if (!submission) {
      this.logger.error(
        `[OPS-ALERT] Submission ${submissionId} moved to dead-letter queue after all retries exhausted — ` +
          `cleanup skipped (submission not found in DB). Failure: ${err.message}`,
      );
      return;
    }

    // Mark rejected + null GPS (GDPR) + null photo key atomically.
    // flag_reason='dlq_final_failure' so admin / stats can distinguish DLQ
    // exhaustion from regular rejection causes.
    let updateOk = false;
    await this.prisma.submission
      .update({
        where: { id: submissionId },
        data: {
          status: SubmissionStatus.rejected,
          flag_reason: 'dlq_final_failure',
          gps_lat: null,
          gps_lng: null,
          photo_r2_key: null,
        },
      })
      .then(() => {
        updateOk = true;
      })
      .catch((e: Error) =>
        this.logger.error(
          `Failed to mark submission ${submissionId} rejected after DLQ entry: ${e.message}`,
        ),
      );

    // Research retention: DLQ case is interesting for debugging pipeline
    // crashes — keep the photo + whatever was in price_data (could be empty
    // if OCR hadn't run yet, or partial if it crashed mid-way).
    if (updateOk && submission.photo_r2_key) {
      await this.researchRetention.captureIfEnabled({
        submissionId,
        stationId: submission.station_id,
        photoR2Key: submission.photo_r2_key,
        ocrPrices: submission.price_data ?? [],
        finalPrices: null,
        finalStatus: SubmissionStatus.rejected,
        flagReason: 'dlq_final_failure',
        capturedAt: submission.created_at,
      });
    }

    // P-1: only delete from R2 if DB update succeeded — avoids orphaned DB record with deleted photo
    if (updateOk && submission.photo_r2_key) {
      await this.storageService
        .deleteObject(submission.photo_r2_key)
        .catch((e: Error) =>
          this.logger.error(
            `Failed to delete R2 photo ${submission.photo_r2_key} for DLQ submission ${submissionId}: ${e.message}`,
          ),
        );
    }

    // Ops alert — structured log for monitoring / log-sink pickup
    this.logger.error(
      `[OPS-ALERT] Submission ${submissionId} moved to dead-letter queue after all retries exhausted. ` +
        `Failure: ${err.message}`,
    );

    // DLQ depth check — alert if systemic issue (many concurrent failures)
    const failedCount = await this.queue.getFailedCount().catch(() => -1);
    if (failedCount > DLQ_DEPTH_ALERT_THRESHOLD) {
      this.logger.error(
        `[OPS-ALERT] DLQ depth ${failedCount} exceeds threshold ${DLQ_DEPTH_ALERT_THRESHOLD} — ` +
          `possible systemic pipeline failure`,
      );
    }
  }

  // ── Spend cap & rate controls (Story 3.9) ────────────────────────────────

  /**
   * Pauses the worker if daily OCR spend has reached the configured cap.
   * Idempotent — only pauses once per cap breach.
   */
  private async checkSpendCap(dailySpend: number): Promise<void> {
    const cap = await this.ocrSpendService.getSpendCap();
    if (dailySpend >= cap && !this.pausedForSpendCap) {
      this.pausedForSpendCap = true;
      await this.worker.pause().catch((e: Error) =>
        this.logger.error(`Failed to pause worker on spend cap: ${e.message}`),
      );
      const jobCounts = await this.queue.getJobCounts('waiting', 'active', 'delayed').catch(() => ({}));
      this.logger.error(
        `[OPS-ALERT] OCR pipeline paused — daily spend $${dailySpend.toFixed(4)} reached cap $${cap.toFixed(2)}. ` +
          `Queue depth: ${JSON.stringify(jobCounts)}. ` +
          `Resume via admin dashboard or wait for UTC midnight auto-reset.`,
      );
    }
  }

  /**
   * Schedules an automatic worker resume at the next UTC midnight.
   * Chains itself so it runs every day without drift.
   */
  private scheduleMidnightReset(): void {
    const now = new Date();
    const midnight = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
    );
    const msUntilMidnight = midnight.getTime() - now.getTime();

    // .unref() prevents the timer from keeping the Node process alive if nothing else is running.
    setTimeout(() => {
      void (async () => {
        if (this.pausedForSpendCap) {
          try {
            this.worker.resume();
          } catch (e: unknown) {
            this.logger.error(`Failed to auto-resume worker at midnight: ${(e as Error).message}`);
          }
          this.pausedForSpendCap = false;
          this.logger.log('OCR worker auto-resumed after UTC midnight spend cap reset');
        }
        this.scheduleMidnightReset(); // chain for next day
      })();
    }, msUntilMidnight).unref();
  }

  private async rejectSubmission(
    submission: Pick<Submission, 'id' | 'photo_r2_key' | 'station_id' | 'created_at'>,
    reason: string,
    ocrPrices: unknown = [],
    /** OCR confidence — pass when the rejection happens after OCR ran so we
     *  can still gather quality stats on rejected submissions. Pre-OCR
     *  rejections (no_gps_coordinates, no_station_match, missing_photo, ...)
     *  leave this undefined and the column stays null. */
    ocrConfidence?: number,
  ): Promise<void> {
    this.logger.warn(`Submission ${submission.id}: rejected — ${reason}`);

    await this.prisma.submission.update({
      where: { id: submission.id },
      data: {
        status: SubmissionStatus.rejected,
        flag_reason: reason,
        gps_lat: null,
        gps_lng: null,
        photo_r2_key: null,
        // Only set if caller passed a value — otherwise leave null/existing.
        ...(ocrConfidence !== undefined ? { ocr_confidence_score: ocrConfidence } : {}),
      },
    });

    // Research retention: copy photo to `research/<id>.jpg` BEFORE the R2
    // delete below, so the benchmark corpus includes failure cases (no_gps,
    // no_station_match, low_ocr_confidence, etc.). No-op when
    // PHOTO_RESEARCH_RETENTION_DAYS is unset. Fail-soft: exceptions are
    // logged but never propagate — retention must not block the pipeline.
    if (submission.photo_r2_key) {
      await this.researchRetention.captureIfEnabled({
        submissionId: submission.id,
        stationId: submission.station_id ?? null,
        photoR2Key: submission.photo_r2_key,
        ocrPrices,
        finalPrices: null,
        finalStatus: SubmissionStatus.rejected,
        flagReason: reason,
        capturedAt: submission.created_at,
      });
    }

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
