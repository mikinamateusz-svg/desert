import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { SubmissionStatus, UserRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { PhotoPipelineWorker } from '../photo/photo-pipeline.worker.js';
import { SubmissionDedupService } from '../photo/submission-dedup.service.js';
import { PriceService, type StationPriceRow } from '../price/price.service.js';
import { PriceCacheService } from '../price/price-cache.service.js';

type PriceEntry = { fuel_type: string; price_per_litre: number | null };

type MappedSubmission = {
  id: string;
  station: { id: string; name: string } | null;
  price_data: PriceEntry[];
  status: 'pending' | 'verified' | 'rejected' | 'shadow_rejected';
  flag_reason: string | null;
  created_at: Date;
};

export interface CreateSubmissionFields {
  fuelType: string;
  gpsLat: number | null;
  gpsLng: number | null;
  manualPrice: number | null;
  preselectedStationId: string | null;
}

const FLAG_WRONG_WINDOW_MS = 24 * 3600 * 1000;
const AUDIT_ACTION_USER_FLAGGED = 'USER_FLAGGED_WRONG';
const AUDIT_ACTION_AUTO_RESOLVED = 'AUTO_RESOLVED_BY_RESUBMIT';

@Injectable()
export class SubmissionsService {
  private readonly logger = new Logger(SubmissionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    @Inject(forwardRef(() => PhotoPipelineWorker))
    private readonly photoPipelineWorker: PhotoPipelineWorker,
    private readonly submissionDedupService: SubmissionDedupService,
    private readonly priceService: PriceService,
    private readonly priceCache: PriceCacheService,
  ) {}

  async getMySubmissions(userId: string, page: number, limit: number) {
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.submission.findMany({
        where: { user_id: userId },
        include: { station: { select: { id: true, name: true } } },
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.submission.count({ where: { user_id: userId } }),
    ]);

    const data: MappedSubmission[] = items.map((item) => {
      // Story 4.3: shadow_banned drivers must not learn they're banned, so
      // shadow_rejected with flag_reason='shadow_banned' is laundered to
      // 'pending' on the wire. All OTHER shadow_rejected reasons are passed
      // through (Story 3.14 — drivers need to see their flagged submissions
      // and rule-based shadow_rejects so they understand why prices aren't
      // showing).
      let status: MappedSubmission['status'];
      if (item.status === SubmissionStatus.shadow_rejected && item.flag_reason === 'shadow_banned') {
        status = 'pending';
      } else if (
        item.status === SubmissionStatus.pending ||
        item.status === SubmissionStatus.verified ||
        item.status === SubmissionStatus.rejected ||
        item.status === SubmissionStatus.shadow_rejected
      ) {
        status = item.status;
      } else {
        status = 'pending';
      }

      // Hide the shadow_banned flag_reason on the wire too — same secrecy rule.
      const flag_reason = item.flag_reason === 'shadow_banned' ? null : item.flag_reason;

      return {
        id: item.id,
        station: item.station,
        price_data: Array.isArray(item.price_data) ? (item.price_data as PriceEntry[]) : [],
        status,
        flag_reason,
        created_at: item.created_at,
      };
    });

    return { data, total, page, limit };
  }

  /**
   * AC1: Upload photo to R2 first — if this fails, no Submission record is created (AC3).
   * AC2: Create Submission with status=pending, then enqueue BullMQ job (AC4).
   * Returns void; caller returns 202 Accepted.
   */
  async createSubmission(
    userId: string,
    photoBuffer: Buffer,
    fields: CreateSubmissionFields,
  ): Promise<void> {
    // Story 4.3: Shadow ban short-circuit — silently creates a shadow_rejected record so the user
    // sees a normal 202 response but no data enters the pipeline.
    // Wrapped in a transaction to prevent TOCTOU race between the ban check and the create.
    const shadowBanned = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { shadow_banned: true },
      });
      if (user?.shadow_banned) {
        await tx.submission.create({
          data: {
            user_id: userId,
            station_id: null,
            photo_r2_key: null,
            gps_lat: null,
            gps_lng: null,
            price_data: [],
            status: SubmissionStatus.shadow_rejected,
            flag_reason: 'shadow_banned',
          },
        });
        return true;
      }
      return false;
    });
    if (shadowBanned) return;

    // Story 3.10: L1 station dedup — preselected path only (stationId unknown for GPS path)
    if (fields.preselectedStationId) {
      try {
        const isDuplicate = await this.submissionDedupService.checkStationDedup(fields.preselectedStationId);
        if (isDuplicate) {
          this.logger.log(
            `[DEDUP-L1] station=${fields.preselectedStationId} — fresh result exists, skipping intake`,
          );
          return;
        }
      } catch (e: unknown) {
        this.logger.warn(`[DEDUP-L1] Redis check failed, proceeding normally: ${(e as Error).message}`);
      }
    }

    const submissionId = randomUUID();
    const r2Key = `submissions/${userId}/${submissionId}.jpg`;

    // AC3: R2 upload BEFORE DB insert — failure propagates, no orphan Submission record
    await this.storageService.uploadBuffer(r2Key, photoBuffer, 'image/jpeg');

    try {
      await this.prisma.submission.create({
        data: {
          id: submissionId,
          user_id: userId,
          station_id: fields.preselectedStationId ?? null,
          photo_r2_key: r2Key,
          gps_lat: fields.gpsLat,
          gps_lng: fields.gpsLng,
          price_data: [{ fuel_type: fields.fuelType, price_per_litre: fields.manualPrice }],
          status: SubmissionStatus.pending,
        },
      });
    } catch (dbErr) {
      // DB failed after R2 succeeded — best-effort cleanup to avoid orphan R2 object
      await this.storageService.deleteObject(r2Key).catch(() => {});
      throw dbErr;
    }

    try {
      // AC4: job payload is submissionId only — worker fetches all data from DB
      await this.photoPipelineWorker.enqueue(submissionId);
    } catch (queueErr) {
      // Queue failed after DB create — roll back both DB record and R2 object
      await this.prisma.submission.delete({ where: { id: submissionId } }).catch(() => {});
      await this.storageService.deleteObject(r2Key).catch(() => {});
      throw queueErr;
    }
  }

  /**
   * Story 3.14 — driver-initiated withdrawal of a verified submission.
   *
   * Flow:
   *   1. Auth: caller must own the submission
   *   2. Status: must be `verified` (idempotent: 409 if already moved)
   *   3. Window: created within last 24h (admins bypass)
   *   4. Atomic transition: verified → shadow_rejected, flag_reason='user_flagged_wrong'
   *   5. Restore prices: find previous verified submission for the station and
   *      replay its prices via setVerifiedPrice; if none, invalidate cache so
   *      the read-path falls back through estimates
   *   6. Lift dedup: delete dedup:station:{id} and dedup:hash:{photoHash}
   *      (best-effort, doesn't block on Redis errors)
   *   7. Audit log
   */
  async flagWrong(
    submissionId: string,
    actorUserId: string,
    actorRole: UserRole,
  ): Promise<void> {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      select: {
        id: true,
        user_id: true,
        station_id: true,
        photo_r2_key: true,
        status: true,
        created_at: true,
      },
    });

    if (!submission) {
      throw new NotFoundException(`Submission ${submissionId} not found`);
    }
    if (submission.user_id !== actorUserId) {
      throw new ForbiddenException(`Submission ${submissionId} does not belong to caller`);
    }
    if (submission.status !== SubmissionStatus.verified) {
      throw new ConflictException(
        `Submission ${submissionId} cannot be flagged from status ${submission.status} — only verified is supported`,
      );
    }

    // Window check — admins bypass per Story 3.14 admin-bypass exception.
    if (actorRole !== UserRole.ADMIN) {
      const ageMs = Date.now() - submission.created_at.getTime();
      if (ageMs > FLAG_WRONG_WINDOW_MS) {
        throw new BadRequestException(
          `Submission ${submissionId} is older than 24h — flag-wrong window has closed`,
        );
      }
    }

    // Atomic guard: if a concurrent admin or another flag-wrong already moved
    // the row, updateMany returns count=0 and we 409 without further side
    // effects.
    const updateResult = await this.prisma.submission.updateMany({
      where: { id: submissionId, status: SubmissionStatus.verified },
      data: {
        status: SubmissionStatus.shadow_rejected,
        flag_reason: 'user_flagged_wrong',
      },
    });
    if (updateResult.count === 0) {
      throw new ConflictException(
        `Submission ${submissionId} was modified concurrently — flag-wrong aborted`,
      );
    }

    // Restore previous verified submission's prices for this station.
    const restoredFromId = submission.station_id
      ? await this.restorePreviousPrices(submission.station_id, submissionId)
      : null;

    // Lift dedup keys (best-effort). Hash requires fetching the photo bytes —
    // if R2 fetch fails (cleanup ran between verification and flag), we still
    // attempt the station-key lift so retake at the same station works.
    let photoHash: string | null = null;
    if (submission.photo_r2_key) {
      try {
        const buf = await this.storageService.getObjectBuffer(submission.photo_r2_key);
        photoHash = SubmissionDedupService.computePhotoHash(buf);
      } catch (e) {
        this.logger.warn(
          `Submission ${submissionId}: could not compute photo hash for dedup lift: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }
    await this.submissionDedupService.liftDedup(submission.station_id, photoHash);

    // Audit trail. Reuses AdminAuditLog (action prefixed USER_ for clarity);
    // admin_user_id field stores the actor's user_id regardless of role —
    // it's a text column with no FK constraint.
    await this.prisma.adminAuditLog
      .create({
        data: {
          admin_user_id: actorUserId,
          action: AUDIT_ACTION_USER_FLAGGED,
          submission_id: submissionId,
          notes: JSON.stringify({
            previous_status: 'verified',
            restored_from_submission_id: restoredFromId,
            actor_role: actorRole,
          }),
        },
      })
      .catch((err: unknown) => {
        // Log-only — audit failure mustn't block the flag action.
        this.logger.error(
          `Submission ${submissionId}: audit log write failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });

    this.logger.log(
      `Submission ${submissionId} flagged by user ${actorUserId} — ` +
        `restored from ${restoredFromId ?? 'none (cache invalidated)'}`,
    );
  }

  /**
   * Story 3.14 AC6 — when a driver successfully verifies a new submission at
   * a station where they had previously flagged-wrong an earlier submission,
   * auto-close that earlier flagged submission so admin doesn't have to
   * review it (the driver's resubmission counts as resolution).
   *
   * Best-effort: any failure here is logged but doesn't block the new
   * submission's verification flow. Called from photo-pipeline.worker right
   * after a successful setVerifiedPrice.
   */
  async autoResolveFlaggedAtStation(
    userId: string,
    stationId: string,
    triggeringSubmissionId: string,
  ): Promise<void> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const flagged = await this.prisma.submission.findMany({
      where: {
        user_id: userId,
        station_id: stationId,
        status: SubmissionStatus.shadow_rejected,
        flag_reason: 'user_flagged_wrong',
        created_at: { gte: sevenDaysAgo },
        id: { not: triggeringSubmissionId },
      },
      select: { id: true },
    });

    if (flagged.length === 0) return;

    const flaggedIds = flagged.map((f) => f.id);
    await this.prisma.submission.updateMany({
      where: { id: { in: flaggedIds } },
      data: {
        status: SubmissionStatus.rejected,
        flag_reason: 'auto_resolved_by_resubmit',
      },
    });

    // Audit trail for each auto-resolve so admins can trace the chain.
    await Promise.all(
      flaggedIds.map((id) =>
        this.prisma.adminAuditLog
          .create({
            data: {
              admin_user_id: userId,
              action: AUDIT_ACTION_AUTO_RESOLVED,
              submission_id: id,
              notes: JSON.stringify({ resolved_by_submission_id: triggeringSubmissionId }),
            },
          })
          .catch(() => undefined),
      ),
    );

    this.logger.log(
      `Auto-resolved ${flaggedIds.length} flagged submission(s) at station ${stationId} for user ${userId} — triggered by ${triggeringSubmissionId}`,
    );
  }

  /**
   * Find the most recent verified submission for a station (excluding `excludeId`),
   * convert its price_data to a StationPriceRow, and write it via
   * priceService.setVerifiedPrice. If none exists, invalidate the cache so the
   * read-path falls back through estimates. Returns the source submission id
   * (or null if invalidated).
   */
  private async restorePreviousPrices(
    stationId: string,
    excludeId: string,
  ): Promise<string | null> {
    const previous = await this.prisma.submission.findFirst({
      where: {
        station_id: stationId,
        status: SubmissionStatus.verified,
        id: { not: excludeId },
      },
      orderBy: { created_at: 'desc' },
      select: { id: true, price_data: true, created_at: true },
    });

    if (!previous) {
      try {
        await this.priceCache.invalidate(stationId);
      } catch (e) {
        this.logger.warn(
          `restorePreviousPrices: cache invalidate failed for station ${stationId}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
      return null;
    }

    const priceData = Array.isArray(previous.price_data)
      ? (previous.price_data as Array<{ fuel_type: string; price_per_litre: number | null }>)
      : [];
    const validEntries = priceData.filter(
      (p): p is { fuel_type: string; price_per_litre: number } =>
        typeof p.price_per_litre === 'number' && Number.isFinite(p.price_per_litre),
    );

    const priceRow: StationPriceRow = {
      stationId,
      prices: Object.fromEntries(validEntries.map((p) => [p.fuel_type, p.price_per_litre])),
      sources: Object.fromEntries(validEntries.map((p) => [p.fuel_type, 'community' as const])),
      updatedAt: previous.created_at,
    };

    try {
      await this.priceService.setVerifiedPrice(stationId, priceRow);
    } catch (e) {
      this.logger.warn(
        `restorePreviousPrices: setVerifiedPrice failed for station ${stationId}: ${
          e instanceof Error ? e.message : String(e)
        }. Falling back to cache invalidate.`,
      );
      await this.priceCache.invalidate(stationId).catch(() => undefined);
    }

    return previous.id;
  }
}
