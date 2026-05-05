import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, SubmissionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';

export interface RetentionInput {
  submissionId: string;
  stationId: string | null;
  photoR2Key: string;
  /**
   * Original submission GPS — captured BEFORE the pipeline nulls these for
   * GDPR. Service rounds to 4 decimal places (~10m) before writing, so the
   * stored value is debug-useful (closest-station lookups) but not precise
   * enough to identify a user's exact position. Null when caller doesn't
   * have coords (pre-OCR rejections, preselect path).
   */
  gpsLat: number | null;
  gpsLng: number | null;
  ocrPrices: unknown; // JSON array: what OCR extracted (pre-validation)
  finalPrices: unknown | null; // JSON array: post-validation for verified; null for rejected/shadow_rejected
  finalStatus: SubmissionStatus;
  flagReason: string | null;
  capturedAt: Date;
}

/** ~10m precision at Polish latitudes. Matches admin-submissions.service.ts. */
function roundCoord(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 10000) / 10000;
}

/**
 * Research retention: when PHOTO_RESEARCH_RETENTION_DAYS > 0, copy each
 * processed photo to a flat `research/<submission_id>.jpg` path (user_id
 * stripped from path) and record a ResearchPhoto row. Used to build a labeled
 * corpus for A/B-testing OCR models. See migration
 * 20260423000000_add_research_photo.
 *
 * Fail-soft: every failure is logged and swallowed. This path MUST NOT block
 * the pipeline — a flaky research path should never reject a real submission
 * or retry a BullMQ job.
 */
@Injectable()
export class ResearchRetentionService {
  private readonly logger = new Logger(ResearchRetentionService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Days to retain research photos. 0 or unset disables retention. */
  private getRetentionDays(): number {
    const raw = this.config.get<string>('PHOTO_RESEARCH_RETENTION_DAYS', '0');
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  /** True when retention is turned on via env var. */
  isEnabled(): boolean {
    return this.getRetentionDays() > 0;
  }

  /**
   * Capture a retention record and server-side copy of the photo. No-op when
   * retention is disabled or the submission has no photo (e.g. no_gps path).
   * Safe to call in every terminal state handler — guards are internal.
   */
  async captureIfEnabled(input: RetentionInput): Promise<void> {
    const days = this.getRetentionDays();
    if (days === 0) return;
    if (!input.photoR2Key) return;

    // Skip if a ResearchPhoto row already exists for this submission. The
    // r2_key + DB row are written together by an earlier capture (typically
    // the original processing); doing it again on requeue would copy R2,
    // hit a unique-constraint failure on submission_id, then "rollback" by
    // deleting the R2 object that the existing row points to — corrupting
    // the original capture.
    const existing = await this.prisma.researchPhoto.findUnique({
      where: { submission_id: input.submissionId },
      select: { id: true },
    });
    if (existing) return;

    const destKey = `research/${input.submissionId}.jpg`;

    try {
      await this.storage.copyObject(input.photoR2Key, destKey);
    } catch (err) {
      this.logger.error(
        `Research retention: R2 copy failed for submission ${input.submissionId} — ${
          err instanceof Error ? err.message : String(err)
        }. Skipping DB record.`,
      );
      return;
    }

    const retainedUntil = new Date(Date.now() + days * 86_400_000);

    try {
      await this.prisma.researchPhoto.create({
        data: {
          submission_id: input.submissionId,
          r2_key: destKey,
          station_id: input.stationId,
          gps_lat: roundCoord(input.gpsLat),
          gps_lng: roundCoord(input.gpsLng),
          ocr_prices: input.ocrPrices as Prisma.InputJsonValue,
          final_prices: (input.finalPrices ?? null) as Prisma.InputJsonValue | typeof Prisma.JsonNull,
          final_status: input.finalStatus,
          flag_reason: input.flagReason,
          captured_at: input.capturedAt,
          retained_until: retainedUntil,
        },
      });
    } catch (err) {
      // DB insert failed after we already copied the object. Try to clean up
      // the orphaned R2 copy so we don't accumulate cost — but don't retry
      // the DB write, this is opportunistic.
      this.logger.error(
        `Research retention: DB insert failed for submission ${input.submissionId} — ${
          err instanceof Error ? err.message : String(err)
        }. Attempting R2 rollback.`,
      );
      await this.storage.deleteObject(destKey).catch((cleanupErr: Error) =>
        this.logger.warn(
          `Research retention: R2 rollback failed for ${destKey}: ${cleanupErr.message}`,
        ),
      );
    }
  }

  /**
   * Delete expired research photos (R2 object + DB row). Called by the daily
   * PhotoCleanupWorker.
   */
  async cleanupExpired(): Promise<{ deleted: number; failed: number }> {
    const expired = await this.prisma.researchPhoto.findMany({
      where: { retained_until: { lt: new Date() } },
      select: { id: true, r2_key: true },
      take: 100,
    });

    if (expired.length === 0) return { deleted: 0, failed: 0 };

    let deleted = 0;
    let failed = 0;
    for (const row of expired) {
      try {
        await this.storage.deleteObject(row.r2_key);
        await this.prisma.researchPhoto.delete({ where: { id: row.id } });
        deleted += 1;
      } catch (err) {
        failed += 1;
        this.logger.warn(
          `Research retention cleanup: failed to delete ${row.r2_key}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    this.logger.log(`Research retention cleanup: deleted ${deleted}/${expired.length} expired photos`);
    return { deleted, failed };
  }
}
