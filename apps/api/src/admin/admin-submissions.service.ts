import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { SubmissionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { PriceService, type StationPriceRow } from '../price/price.service.js';
import { StorageService } from '../storage/storage.service.js';
import { TrustScoreService } from '../user/trust-score.service.js';

export interface FlaggedSubmissionRow {
  id: string;
  station_id: string | null;
  station_name: string | null;
  price_data: Array<{ fuel_type: string; price_per_litre: number }>;
  ocr_confidence_score: number | null;
  created_at: Date;
  user_id: string;
  flag_reason: string;
}

export interface FlaggedSubmissionDetail extends FlaggedSubmissionRow {
  station_brand: string | null;
  photo_url: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
}

export interface SubmissionListResult {
  data: FlaggedSubmissionRow[];
  total: number;
  page: number;
  limit: number;
}

const AUDIT_ACTION_APPROVE = 'APPROVE';
const AUDIT_ACTION_REJECT = 'REJECT';

@Injectable()
export class AdminSubmissionsService {
  private readonly logger = new Logger(AdminSubmissionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly priceService: PriceService,
    private readonly storage: StorageService,
    private readonly trustScoreService: TrustScoreService,
  ) {}

  async listFlagged(page: number, limit: number): Promise<SubmissionListResult> {
    const skip = (page - 1) * limit;

    const [submissions, total] = await this.prisma.$transaction([
      this.prisma.submission.findMany({
        where: { status: SubmissionStatus.shadow_rejected },
        orderBy: { created_at: 'asc' },
        skip,
        take: limit,
        select: {
          id: true,
          station_id: true,
          price_data: true,
          ocr_confidence_score: true,
          created_at: true,
          user_id: true,
          flag_reason: true,
          station: { select: { name: true } },
        },
      }),
      this.prisma.submission.count({
        where: { status: SubmissionStatus.shadow_rejected },
      }),
    ]);

    return {
      data: submissions.map((s) => ({
        id: s.id,
        station_id: s.station_id,
        station_name: s.station?.name ?? null,
        price_data: s.price_data as Array<{ fuel_type: string; price_per_litre: number }>,
        ocr_confidence_score: s.ocr_confidence_score,
        created_at: s.created_at,
        user_id: s.user_id,
        flag_reason: s.flag_reason ?? 'logo_mismatch',
      })),
      total,
      page,
      limit,
    };
  }

  private static readonly PHOTO_URL_TTL_SECONDS = 60 * 60; // 1 hour

  async getDetail(id: string): Promise<FlaggedSubmissionDetail> {
    const submission = await this.prisma.submission.findUnique({
      where: { id },
      select: {
        id: true,
        station_id: true,
        price_data: true,
        ocr_confidence_score: true,
        created_at: true,
        user_id: true,
        status: true,
        flag_reason: true,
        photo_r2_key: true,
        gps_lat: true,
        gps_lng: true,
        station: { select: { name: true, brand: true } },
      },
    });

    if (!submission) throw new NotFoundException(`Submission ${id} not found`);
    if (submission.status !== SubmissionStatus.shadow_rejected) {
      throw new ConflictException(`Submission ${id} is no longer awaiting review`);
    }

    let photo_url: string | null = null;
    if (submission.photo_r2_key) {
      photo_url = await this.storage
        .getPresignedUrl(submission.photo_r2_key, AdminSubmissionsService.PHOTO_URL_TTL_SECONDS)
        .catch((e: unknown) => {
          this.logger.warn(
            `getDetail ${id}: failed to generate presigned URL — ${e instanceof Error ? e.message : String(e)}`,
          );
          return null;
        });
    }

    return {
      id: submission.id,
      station_id: submission.station_id,
      station_name: submission.station?.name ?? null,
      station_brand: submission.station?.brand ?? null,
      price_data: submission.price_data as Array<{ fuel_type: string; price_per_litre: number }>,
      ocr_confidence_score: submission.ocr_confidence_score,
      created_at: submission.created_at,
      user_id: submission.user_id,
      flag_reason: submission.flag_reason ?? 'logo_mismatch',
      photo_url,
      // Round to 4 decimal places ≈ 10m precision — sufficient to confirm station proximity
      // without revealing exact position. Nulled on approve/reject.
      gps_lat: submission.gps_lat != null ? Math.round(submission.gps_lat * 10000) / 10000 : null,
      gps_lng: submission.gps_lng != null ? Math.round(submission.gps_lng * 10000) / 10000 : null,
    };
  }

  async approve(submissionId: string, adminUserId: string): Promise<void> {
    // 1. Atomically claim the submission — prevents concurrent double-approvals
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      select: { id: true, user_id: true, station_id: true, price_data: true, photo_r2_key: true, status: true },
    });

    if (!submission) throw new NotFoundException(`Submission ${submissionId} not found`);
    if (submission.status !== SubmissionStatus.shadow_rejected) {
      throw new ConflictException(`Submission ${submissionId} is no longer awaiting review`);
    }
    if (!submission.station_id) {
      throw new BadRequestException(
        `Submission ${submissionId} has no matched station — cannot approve`,
      );
    }

    const rawPriceData = submission.price_data;
    if (
      !Array.isArray(rawPriceData) ||
      !rawPriceData.every(
        (p) =>
          p !== null &&
          typeof p === 'object' &&
          typeof (p as Record<string, unknown>).fuel_type === 'string' &&
          typeof (p as Record<string, unknown>).price_per_litre === 'number',
      )
    ) {
      throw new BadRequestException(
        `Submission ${submissionId} has malformed price_data — cannot approve`,
      );
    }
    const priceData = rawPriceData as Array<{ fuel_type: string; price_per_litre: number }>;

    if (!priceData.length) {
      throw new BadRequestException(`Submission ${submissionId} has no price data`);
    }

    // 2. Mark verified + clear photo key (atomic status check)
    const updated = await this.prisma.submission.updateMany({
      where: { id: submissionId, status: SubmissionStatus.shadow_rejected },
      data: { status: SubmissionStatus.verified, photo_r2_key: null, gps_lat: null, gps_lng: null },
    });

    if (updated.count === 0) {
      // Another admin acted first
      throw new ConflictException(`Submission ${submissionId} was already reviewed`);
    }

    // 3. Publish price to cache + history
    const priceRow: StationPriceRow = {
      stationId: submission.station_id,
      prices: Object.fromEntries(priceData.map((p) => [p.fuel_type, p.price_per_litre])),
      sources: Object.fromEntries(priceData.map((p) => [p.fuel_type, 'community' as const])),
      updatedAt: new Date(),
    };

    try {
      await this.priceService.setVerifiedPrice(submission.station_id, priceRow);
    } catch (e: unknown) {
      this.logger.warn(
        `Approve ${submissionId}: price cache/history update failed — ` +
          `DB is already verified, map will self-heal on next cache miss. ` +
          `Error: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    // 4. Clear staleness flags for this station's fuel types (best-effort)
    const fuelTypes = priceData.map((p) => p.fuel_type);
    await this.prisma.stationFuelStaleness
      .deleteMany({ where: { station_id: submission.station_id, fuel_type: { in: fuelTypes } } })
      .catch((e: unknown) =>
        this.logger.warn(
          `Approve ${submissionId}: staleness clear failed: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );

    // 5. Write audit log
    await this.writeAuditLog(adminUserId, AUDIT_ACTION_APPROVE, submissionId, null);

    // 5b. Update trust score (fail-open)
    await this.trustScoreService
      .updateScore(submission.user_id, TrustScoreService.DELTA_ADMIN_APPROVED)
      .catch((e: unknown) =>
        this.logger.warn(
          `Approve ${submissionId}: trust score update failed: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );

    // 6. Delete photo from R2 (best-effort — storage cost, not a correctness concern)
    if (submission.photo_r2_key) {
      await this.storage.deleteObject(submission.photo_r2_key).catch((e: unknown) =>
        this.logger.warn(
          `Approve ${submissionId}: R2 photo delete failed: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
    }
  }

  async reject(submissionId: string, adminUserId: string, notes: string | null): Promise<void> {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      select: { id: true, user_id: true, photo_r2_key: true, status: true },
    });

    if (!submission) throw new NotFoundException(`Submission ${submissionId} not found`);
    if (submission.status !== SubmissionStatus.shadow_rejected) {
      throw new ConflictException(`Submission ${submissionId} is no longer awaiting review`);
    }

    // Atomic status check + update
    const updated = await this.prisma.submission.updateMany({
      where: { id: submissionId, status: SubmissionStatus.shadow_rejected },
      data: { status: SubmissionStatus.rejected, gps_lat: null, gps_lng: null },
    });

    if (updated.count === 0) {
      throw new ConflictException(`Submission ${submissionId} was already reviewed`);
    }

    await this.writeAuditLog(adminUserId, AUDIT_ACTION_REJECT, submissionId, notes);

    // Update trust score (fail-open)
    await this.trustScoreService
      .updateScore(submission.user_id, TrustScoreService.DELTA_ADMIN_REJECTED)
      .catch((e: unknown) =>
        this.logger.warn(
          `Reject ${submissionId}: trust score update failed: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );

    if (submission.photo_r2_key) {
      await this.storage.deleteObject(submission.photo_r2_key).catch((e: unknown) =>
        this.logger.warn(
          `Reject ${submissionId}: R2 photo delete failed: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
    }
  }

  private async writeAuditLog(
    adminUserId: string,
    action: string,
    submissionId: string,
    notes: string | null,
  ): Promise<void> {
    try {
      await this.prisma.adminAuditLog.create({
        data: { admin_user_id: adminUserId, action, submission_id: submissionId, notes },
      });
    } catch (e: unknown) {
      // Audit log failure must not roll back the review action — log and alert ops
      this.logger.error(
        `[OPS-ALERT] Failed to write audit log for ${action} on submission ${submissionId} ` +
          `by admin ${adminUserId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
