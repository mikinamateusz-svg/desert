import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma, SubmissionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { PriceService, type StationPriceRow } from '../price/price.service.js';
import { StorageService } from '../storage/storage.service.js';
import { TrustScoreService } from '../user/trust-score.service.js';
import { PhotoPipelineWorker } from '../photo/photo-pipeline.worker.js';
import { SubmissionDedupService } from '../photo/submission-dedup.service.js';

export interface FlaggedSubmissionRow {
  id: string;
  station_id: string | null;
  station_name: string | null;
  // P-14 (3.16 review) — JSONB column allows `null` price_per_litre at
  // runtime when OCR extracts a fuel-type label without a parseable price.
  // UI formatters guard with '—'; cache writers filter non-finite.
  price_data: Array<{ fuel_type: string; price_per_litre: number | null }>;
  ocr_confidence_score: number | null;
  created_at: Date;
  user_id: string;
  flag_reason: string;
  /** Story 3.16 — non-null only when this row is part of a price_conflict pair. */
  conflict_group_id: string | null;
}

export interface FlaggedSubmissionDetail extends FlaggedSubmissionRow {
  station_brand: string | null;
  photo_url: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
}

/**
 * Story 3.16 — list items can be either a single shadow_rejected row or a
 * paired card collapsing two rows that share a `conflict_group_id` (when
 * both are still in `shadow_rejected`). The UI renders pairs as a single
 * card with both photos side-by-side and the AC9 actions.
 */
export type FlaggedListItem =
  | { kind: 'single'; submission: FlaggedSubmissionRow }
  | {
      kind: 'pair';
      conflict_group_id: string;
      newer: FlaggedSubmissionRow;
      older: FlaggedSubmissionRow;
    };

export interface SubmissionListResult {
  data: FlaggedListItem[];
  total: number;
  page: number;
  limit: number;
}

const AUDIT_ACTION_APPROVE = 'APPROVE';
const AUDIT_ACTION_REJECT = 'REJECT';
const AUDIT_ACTION_REQUEUE = 'REQUEUE';
// Story 3.16 — paired-review admin actions on a price_conflict pair.
// P-12 (3.16 review) — distinct action strings per row so audit-log
// queries for a single submission see what actually happened to that row,
// not what happened to its partner. The `*_NEWER` / `*_OLDER` suffixes
// match the wire-level vocabulary admins use ("approve newer", "newer
// unusable") so dashboards can group by action type cleanly.
const AUDIT_ACTION_APPROVE_NEWER = 'APPROVE_NEWER';
const AUDIT_ACTION_AUTO_RESOLVED_BY_NEWER = 'AUTO_RESOLVED_BY_NEWER';
const AUDIT_ACTION_MARK_NEWER_UNUSABLE = 'MARK_NEWER_UNUSABLE';
const AUDIT_ACTION_RELEASE_OLDER_TO_SINGLE_REVIEW = 'RELEASE_OLDER_TO_SINGLE_REVIEW';
const AUDIT_ACTION_MARK_BOTH_UNUSABLE = 'MARK_BOTH_UNUSABLE';

@Injectable()
export class AdminSubmissionsService {
  private readonly logger = new Logger(AdminSubmissionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly priceService: PriceService,
    private readonly storage: StorageService,
    private readonly trustScoreService: TrustScoreService,
    private readonly photoPipelineWorker: PhotoPipelineWorker,
    private readonly submissionDedupService: SubmissionDedupService,
  ) {}

  async listFlagged(page: number, limit: number, flagReason?: string): Promise<SubmissionListResult> {
    const skip = (page - 1) * limit;
    const where: Prisma.SubmissionWhereInput = {
      status: SubmissionStatus.shadow_rejected,
      ...(flagReason ? { flag_reason: flagReason } : {}),
    };

    const [submissions, total] = await this.prisma.$transaction([
      this.prisma.submission.findMany({
        where,
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
          conflict_group_id: true,
          station: { select: { name: true } },
        },
      }),
      this.prisma.submission.count({ where }),
    ]);

    const rows: FlaggedSubmissionRow[] = submissions.map((s) => ({
      id: s.id,
      station_id: s.station_id,
      station_name: s.station?.name ?? null,
      price_data: s.price_data as Array<{ fuel_type: string; price_per_litre: number | null }>,
      ocr_confidence_score: s.ocr_confidence_score,
      created_at: s.created_at,
      user_id: s.user_id,
      flag_reason: s.flag_reason ?? 'logo_mismatch',
      conflict_group_id: s.conflict_group_id,
    }));

    // P-21 (3.16 review) — pair members may be 12h apart in `created_at`,
    // so with PAGE_SIZE=20 the older half of a conflict pair often lands
    // on a previous page while the newer is on the current one (or vice
    // versa). Without this pre-fetch the queue would render both halves
    // as orphan singles on different pages — admin can't act on either
    // because the AC9 actions need the pair. Pull the cross-page partner
    // by group id so `collapseConflictPairs` can stitch them together.
    const groupIdsInPage = Array.from(
      new Set(rows.flatMap((r) => (r.conflict_group_id ? [r.conflict_group_id] : []))),
    );
    let crossPagePartners: FlaggedSubmissionRow[] = [];
    if (groupIdsInPage.length > 0) {
      const pageIds = new Set(rows.map((r) => r.id));
      const partners = await this.prisma.submission.findMany({
        where: {
          conflict_group_id: { in: groupIdsInPage },
          status: SubmissionStatus.shadow_rejected,
          flag_reason: 'price_conflict',
          id: { notIn: rows.map((r) => r.id) },
        },
        select: {
          id: true,
          station_id: true,
          price_data: true,
          ocr_confidence_score: true,
          created_at: true,
          user_id: true,
          flag_reason: true,
          conflict_group_id: true,
          station: { select: { name: true } },
        },
      });
      crossPagePartners = partners
        .filter((p) => !pageIds.has(p.id))
        .map((s) => ({
          id: s.id,
          station_id: s.station_id,
          station_name: s.station?.name ?? null,
          price_data: s.price_data as Array<{ fuel_type: string; price_per_litre: number | null }>,
          ocr_confidence_score: s.ocr_confidence_score,
          created_at: s.created_at,
          user_id: s.user_id,
          flag_reason: s.flag_reason ?? 'price_conflict',
          conflict_group_id: s.conflict_group_id,
        }));
    }

    const data = AdminSubmissionsService.collapseConflictPairs(rows, crossPagePartners);

    return { data, total, page, limit };
  }

  /**
   * Group rows by `conflict_group_id`, emit one `pair` per group with
   * ≥ 2 members, and emit one `single` per non-conflict row.
   *
   * P-27 (3.16 review) — the in-page row list arrives `created_at ASC`
   * (oldest first). For each conflict group we pick the most recent
   * member as `newer` and emit the pair the FIRST time we encounter ANY
   * of its members in the loop — so the card is anchored at whichever
   * end of the pair sits earliest in the page. The previous comment
   * claimed "anchored at the newer row's position" but the implementation
   * skipped non-newer encounters and only emitted on the newer row,
   * which (combined with ASC ordering) actually anchored at the OLDER
   * row's position. Both are arguably valid; we make the anchor
   * deterministic by always emitting on first-encounter and document it
   * here.
   *
   * P-21 — `crossPagePartners` carries pair members who live on a
   * different page than the current one but share a `conflict_group_id`
   * with an in-page row. They are NOT emitted as single rows; they are
   * only used to complete pairs whose other half is in the page. Pure
   * cross-page singletons (group on another page entirely) never reach
   * this function — they're filtered out of `crossPagePartners` in the
   * caller via `id: { notIn: pageIds }` + the in-page row predicate.
   */
  static collapseConflictPairs(
    rows: FlaggedSubmissionRow[],
    crossPagePartners: FlaggedSubmissionRow[] = [],
  ): FlaggedListItem[] {
    const groupMembers = new Map<string, FlaggedSubmissionRow[]>();
    for (const row of [...rows, ...crossPagePartners]) {
      if (row.conflict_group_id !== null) {
        const arr = groupMembers.get(row.conflict_group_id) ?? [];
        arr.push(row);
        groupMembers.set(row.conflict_group_id, arr);
      }
    }

    const out: FlaggedListItem[] = [];
    const consumed = new Set<string>();

    for (const row of rows) {
      if (consumed.has(row.id)) continue;

      if (row.conflict_group_id !== null) {
        const partners = groupMembers.get(row.conflict_group_id) ?? [];
        if (partners.length >= 2) {
          // Newer-first: pick the row with the most recent created_at as `newer`.
          const sorted = [...partners].sort(
            (a, b) => b.created_at.getTime() - a.created_at.getTime(),
          );
          const newer = sorted[0]!;
          const older = sorted[1]!;
          out.push({
            kind: 'pair',
            conflict_group_id: row.conflict_group_id,
            newer,
            older,
          });
          // Mark BOTH halves as consumed regardless of which page they're
          // on — prevents duplicate emission on the partner's page when
          // the loop runs there too.
          consumed.add(newer.id);
          consumed.add(older.id);
          continue;
        }
        // Only one row in this page — fall through to single-row rendering.
        // The orphan partner stays in the queue as a normal review.
      }

      out.push({ kind: 'single', submission: row });
      consumed.add(row.id);
    }

    return out;
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
        conflict_group_id: true,
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
      price_data: submission.price_data as Array<{ fuel_type: string; price_per_litre: number | null }>,
      ocr_confidence_score: submission.ocr_confidence_score,
      created_at: submission.created_at,
      user_id: submission.user_id,
      flag_reason: submission.flag_reason ?? 'logo_mismatch',
      conflict_group_id: submission.conflict_group_id,
      photo_url,
      // Round to 4 decimal places ≈ 10m precision — sufficient to confirm station proximity
      // without revealing exact position. Nulled on approve/reject.
      gps_lat: submission.gps_lat != null ? Math.round(submission.gps_lat * 10000) / 10000 : null,
      gps_lng: submission.gps_lng != null ? Math.round(submission.gps_lng * 10000) / 10000 : null,
    };
  }

  async approve(
    submissionId: string,
    adminUserId: string,
    overridePrices?: Array<{ fuel_type: string; price_per_litre: number }>,
    overrideStationId?: string,
  ): Promise<void> {
    // 1. Atomically claim the submission — prevents concurrent double-approvals
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      select: { id: true, user_id: true, station_id: true, price_data: true, photo_r2_key: true, status: true },
    });

    if (!submission) throw new NotFoundException(`Submission ${submissionId} not found`);
    if (submission.status !== SubmissionStatus.shadow_rejected) {
      throw new ConflictException(`Submission ${submissionId} is no longer awaiting review`);
    }

    const effectiveStationId = overrideStationId ?? submission.station_id;
    if (!effectiveStationId) {
      throw new BadRequestException(
        `Submission ${submissionId} has no matched station — provide stationId in request body`,
      );
    }

    // Use override prices if provided, otherwise fall back to stored OCR prices
    let priceData: Array<{ fuel_type: string; price_per_litre: number }>;
    if (overridePrices && overridePrices.length > 0) {
      priceData = overridePrices;
    } else {
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
      priceData = rawPriceData as Array<{ fuel_type: string; price_per_litre: number }>;
    }

    if (!priceData.length) {
      throw new BadRequestException(`Submission ${submissionId} has no price data`);
    }

    // 2. Mark verified + clear photo key (atomic status check); update station if reassigned
    const updated = await this.prisma.submission.updateMany({
      where: { id: submissionId, status: SubmissionStatus.shadow_rejected },
      data: {
        status: SubmissionStatus.verified,
        photo_r2_key: null,
        gps_lat: null,
        gps_lng: null,
        ...(overrideStationId ? { station_id: overrideStationId } : {}),
      },
    });

    if (updated.count === 0) {
      // Another admin acted first
      throw new ConflictException(`Submission ${submissionId} was already reviewed`);
    }

    // 3. Publish price to cache + history
    const priceRow: StationPriceRow = {
      stationId: effectiveStationId,
      prices: Object.fromEntries(priceData.map((p) => [p.fuel_type, p.price_per_litre])),
      sources: Object.fromEntries(priceData.map((p) => [p.fuel_type, 'community' as const])),
      updatedAt: new Date(),
    };

    try {
      await this.priceService.setVerifiedPrice(effectiveStationId, priceRow);
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
      .deleteMany({ where: { station_id: effectiveStationId, fuel_type: { in: fuelTypes } } })
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

    // photo_r2_key intentionally kept — cleanup worker removes it after
    // REJECTED_PHOTO_RETENTION_DAYS so ops can recover photos if needed.
  }

  /**
   * Reset a shadow_rejected submission back to pending and push it through the
   * pipeline again. Use case: a submission was routed to shadow_rejected for a
   * reason that no longer applies (e.g. `low_trust` after the user's trust
   * score has been restored). Photo must still exist in R2.
   */
  async requeue(submissionId: string, adminUserId: string): Promise<void> {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      select: { id: true, status: true, photo_r2_key: true },
    });

    if (!submission) throw new NotFoundException(`Submission ${submissionId} not found`);
    if (submission.status !== SubmissionStatus.shadow_rejected) {
      throw new ConflictException(
        `Submission ${submissionId} cannot be requeued from status ${submission.status} — only shadow_rejected is supported`,
      );
    }
    if (!submission.photo_r2_key) {
      throw new BadRequestException(
        `Submission ${submissionId} has no photo_r2_key — photo may have been cleaned up and cannot be reprocessed`,
      );
    }

    // Atomic reset — guard against concurrent approve/reject changing status between
    // the read above and the write here.
    const updated = await this.prisma.submission.updateMany({
      where: { id: submissionId, status: SubmissionStatus.shadow_rejected },
      data: {
        status: SubmissionStatus.pending,
        ocr_confidence_score: null,
        flag_reason: null,
      },
    });

    if (updated.count === 0) {
      throw new ConflictException(`Submission ${submissionId} was modified concurrently — aborting requeue`);
    }

    await this.photoPipelineWorker.requeue(submissionId);
    await this.writeAuditLog(adminUserId, AUDIT_ACTION_REQUEUE, submissionId, null);

    this.logger.log(
      `Submission ${submissionId} requeued by admin ${adminUserId} — status reset to pending, new pipeline job enqueued`,
    );
  }

  // ── Story 3.16: paired-review actions on a price_conflict pair ─────────────

  /**
   * Approve the newer submission in a price_conflict pair. Newer becomes
   * `verified` and writes its prices to the cache; older is rejected as
   * `auto_resolved_by_newer`. Both retain the shared `conflict_group_id`
   * for audit traceability.
   *
   * P-9 (3.16 review) — both flips run inside a single `$transaction`
   * with status guards on each. If the older flip's row was moved by
   * another actor between the load and the write, the whole transaction
   * rolls back and we throw `ConflictException` rather than leaving the
   * pair half-resolved (newer verified, older still shadow_rejected with
   * `flag_reason: 'price_conflict'`).
   *
   * P-12 — distinct audit actions per row: `APPROVE_NEWER` for newer,
   * `AUTO_RESOLVED_BY_NEWER` for older.
   *
   * P-24 — after the cache write succeeds, seed a fresh consensus record
   * `{ count: 2, confirmed: true, prices_hash: <newer's hash> }` so the
   * next driver at this station within 12h skips OCR. Without this, the
   * record was deleted by `detectAndRoutePriceConflict`'s `liftDedup` and
   * the next submission re-pays OCR cost despite admin-confirmed prices.
   */
  async approveNewer(
    adminUserId: string,
    conflictGroupId: string,
    newerSubmissionId: string,
  ): Promise<void> {
    const pair = await this.loadConflictPair(conflictGroupId, newerSubmissionId);

    // P-9 — atomic both-or-nothing flip. Status + group + flag_reason
    // guards mean a concurrent admin or worker action returns count: 0
    // and aborts the transaction.
    await this.prisma.$transaction(async (tx) => {
      const newerUpdated = await tx.submission.updateMany({
        where: {
          id: pair.newer.id,
          status: SubmissionStatus.shadow_rejected,
          conflict_group_id: conflictGroupId,
          flag_reason: 'price_conflict',
        },
        data: { status: SubmissionStatus.verified, flag_reason: null },
      });
      if (newerUpdated.count === 0) {
        throw new ConflictException(
          `Newer submission ${pair.newer.id} no longer in price_conflict — aborting`,
        );
      }

      const olderUpdated = await tx.submission.updateMany({
        where: {
          id: pair.older.id,
          status: SubmissionStatus.shadow_rejected,
          conflict_group_id: conflictGroupId,
          flag_reason: 'price_conflict',
        },
        data: {
          status: SubmissionStatus.rejected,
          flag_reason: 'auto_resolved_by_newer',
        },
      });
      if (olderUpdated.count === 0) {
        throw new ConflictException(
          `Older submission ${pair.older.id} no longer in price_conflict — aborting`,
        );
      }
    });

    // Write the newer submission's prices to the cache + history (best-effort).
    if (pair.newer.station_id) {
      // P-14 (3.16 review) — filter null/non-finite prices before writing
      // to the cache. The widened price_data type permits null at the
      // OCR level; the cache schema requires concrete numbers.
      const validNewerPrices = pair.newer.price_data.filter(
        (p): p is { fuel_type: string; price_per_litre: number } =>
          typeof p.price_per_litre === 'number' && Number.isFinite(p.price_per_litre),
      );
      const priceRow: StationPriceRow = {
        stationId: pair.newer.station_id,
        prices: Object.fromEntries(
          validNewerPrices.map((p) => [p.fuel_type, p.price_per_litre]),
        ),
        sources: Object.fromEntries(
          validNewerPrices.map((p) => [p.fuel_type, 'community' as const]),
        ),
        updatedAt: new Date(),
      };
      await this.priceService.setVerifiedPrice(pair.newer.station_id, priceRow).catch((err: Error) =>
        this.logger.error(
          `approveNewer: setVerifiedPrice failed for station ${pair.newer.station_id}: ${err.message}`,
        ),
      );

      // P-24 — seed a confirmed consensus record so the next driver
      // within 12h skips OCR. Best-effort; admin already approved, so
      // we don't block the response on Redis. Hash uses the same
      // null-filtering as the cache write above (hashPriceData itself
      // filters non-finite, but pass the validated list for symmetry).
      const newerHash = SubmissionDedupService.hashPriceData(validNewerPrices);
      await this.submissionDedupService
        .recordStationConsensus(pair.newer.station_id, {
          count: 2,
          confirmed: true,
          prices_hash: newerHash,
          last_at: Date.now(),
        })
        .catch((err: Error) =>
          this.logger.warn(
            `approveNewer: recordStationConsensus failed for ${pair.newer.station_id}: ${err.message}`,
          ),
        );
    }

    // P-11 / P-12 — best-effort audit; distinct action per row.
    const auditNotes = JSON.stringify({
      conflict_group_id: conflictGroupId,
      partner_submission_id: pair.older.id,
    });
    await this.writeAuditLog(adminUserId, AUDIT_ACTION_APPROVE_NEWER, pair.newer.id, auditNotes).catch(() => {});
    await this.writeAuditLog(
      adminUserId,
      AUDIT_ACTION_AUTO_RESOLVED_BY_NEWER,
      pair.older.id,
      JSON.stringify({ conflict_group_id: conflictGroupId, partner_submission_id: pair.newer.id }),
    ).catch(() => {});

    this.logger.log(
      `Conflict ${conflictGroupId} resolved by ${adminUserId}: approved newer ${pair.newer.id}, rejected older ${pair.older.id}`,
    );
  }

  /**
   * Mark the newer submission unusable. Newer is rejected as
   * `admin_marked_unusable`. The older row is released back into single-row
   * review: its `flag_reason` and `conflict_group_id` are cleared so the
   * admin queue treats it as an unpaired shadow_rejected row from now on.
   * The newer keeps its `conflict_group_id` for audit linkage.
   *
   * P-9 — both flips inside a single `$transaction` with status guards.
   * P-12 — distinct audit actions per row.
   */
  async markNewerUnusable(
    adminUserId: string,
    conflictGroupId: string,
    newerSubmissionId: string,
  ): Promise<void> {
    const pair = await this.loadConflictPair(conflictGroupId, newerSubmissionId);

    await this.prisma.$transaction(async (tx) => {
      const newerUpdated = await tx.submission.updateMany({
        where: {
          id: pair.newer.id,
          status: SubmissionStatus.shadow_rejected,
          conflict_group_id: conflictGroupId,
          flag_reason: 'price_conflict',
        },
        data: {
          status: SubmissionStatus.rejected,
          flag_reason: 'admin_marked_unusable',
        },
      });
      if (newerUpdated.count === 0) {
        throw new ConflictException(
          `Newer submission ${pair.newer.id} no longer in price_conflict — aborting`,
        );
      }

      const olderUpdated = await tx.submission.updateMany({
        where: {
          id: pair.older.id,
          status: SubmissionStatus.shadow_rejected,
          conflict_group_id: conflictGroupId,
          flag_reason: 'price_conflict',
        },
        data: {
          flag_reason: null,
          conflict_group_id: null,
        },
      });
      if (olderUpdated.count === 0) {
        throw new ConflictException(
          `Older submission ${pair.older.id} no longer in price_conflict — aborting`,
        );
      }
    });

    const auditNotes = JSON.stringify({
      conflict_group_id: conflictGroupId,
      partner_submission_id: pair.older.id,
    });
    await this.writeAuditLog(adminUserId, AUDIT_ACTION_MARK_NEWER_UNUSABLE, pair.newer.id, auditNotes).catch(() => {});
    await this.writeAuditLog(
      adminUserId,
      AUDIT_ACTION_RELEASE_OLDER_TO_SINGLE_REVIEW,
      pair.older.id,
      JSON.stringify({ conflict_group_id: conflictGroupId, partner_submission_id: pair.newer.id }),
    ).catch(() => {});

    this.logger.log(
      `Conflict ${conflictGroupId} resolved by ${adminUserId}: newer ${pair.newer.id} unusable, older ${pair.older.id} released to single-row review`,
    );
  }

  /**
   * Mark both submissions in the pair unusable. Both → `rejected` with
   * `admin_marked_unusable`. `conflict_group_id` preserved on both for
   * audit. Cache stays where it is (read-path resolves from prior verified
   * or estimates — same as the conflict-detection rollback already left it).
   *
   * P-10 (3.16 review) — capture the IDs of rows that ACTUALLY changed
   * (those matching the where filter pre-update) and audit only those.
   * The previous implementation issued `findMany({ where: { conflict_group_id } })`
   * AFTER the updateMany, which could include unrelated rejected rows
   * (from prior `markNewerUnusable` + `markBothUnusable` partial actions
   * leaving stale group ids on rejected rows) and emit misleading audit
   * entries.
   *
   * P-11 — wrap each audit-log write in `.catch()` so a partial audit
   * failure on iteration N doesn't 500 the admin after the state-change
   * updateMany already committed.
   */
  async markBothUnusable(adminUserId: string, conflictGroupId: string): Promise<void> {
    // P-10 — capture targets BEFORE the updateMany so we audit only the
    // rows we intend to flip. Same WHERE clause as the update.
    const targets = await this.prisma.submission.findMany({
      where: {
        conflict_group_id: conflictGroupId,
        status: SubmissionStatus.shadow_rejected,
        flag_reason: 'price_conflict',
      },
      select: { id: true },
    });
    if (targets.length === 0) {
      throw new ConflictException(
        `Conflict ${conflictGroupId} has no rows in price_conflict — already resolved?`,
      );
    }

    const targetIds = targets.map((t) => t.id);
    const updated = await this.prisma.submission.updateMany({
      where: {
        id: { in: targetIds },
        status: SubmissionStatus.shadow_rejected,
        flag_reason: 'price_conflict',
      },
      data: {
        status: SubmissionStatus.rejected,
        flag_reason: 'admin_marked_unusable',
      },
    });
    if (updated.count === 0) {
      throw new ConflictException(
        `Conflict ${conflictGroupId} rows moved by another actor — aborting`,
      );
    }

    // P-11 — sequential awaits with per-row .catch so a single audit
    // failure doesn't drop the rest or 500 the admin.
    const auditNotes = JSON.stringify({ conflict_group_id: conflictGroupId });
    for (const id of targetIds) {
      await this.writeAuditLog(adminUserId, AUDIT_ACTION_MARK_BOTH_UNUSABLE, id, auditNotes).catch(() => {});
    }

    this.logger.log(
      `Conflict ${conflictGroupId} resolved by ${adminUserId}: both unusable (${updated.count} rows)`,
    );
  }

  /**
   * Load both rows of a price_conflict pair. Throws if the pair is no
   * longer intact (already resolved by another admin, or `newerSubmissionId`
   * doesn't belong to this group).
   */
  private async loadConflictPair(
    conflictGroupId: string,
    newerSubmissionId: string,
  ): Promise<{ newer: FlaggedSubmissionRow; older: FlaggedSubmissionRow }> {
    const rows = await this.prisma.submission.findMany({
      where: {
        conflict_group_id: conflictGroupId,
        status: SubmissionStatus.shadow_rejected,
        flag_reason: 'price_conflict',
      },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        station_id: true,
        price_data: true,
        ocr_confidence_score: true,
        created_at: true,
        user_id: true,
        flag_reason: true,
        conflict_group_id: true,
        station: { select: { name: true } },
      },
    });

    if (rows.length < 2) {
      throw new ConflictException(
        `Conflict ${conflictGroupId} pair is no longer intact (found ${rows.length} active rows)`,
      );
    }
    // P-22 (3.16 review) — `conflict_group_id` is currently 1:1 with a
    // pair (one UUID generated per detectAndRoutePriceConflict call), but
    // the schema permits N>2 future-proofing. Surfacing the unexpected
    // case loudly is safer than silently picking rows[0] / rows[1] —
    // an admin acting on a 3-row group would otherwise leave one
    // submission orphaned without realizing it.
    if (rows.length > 2) {
      throw new ConflictException(
        `Conflict ${conflictGroupId} has ${rows.length} active members — paired-review actions only support pairs (N=2)`,
      );
    }
    const newer = rows[0]!;
    const older = rows[1]!;
    if (newer.id !== newerSubmissionId) {
      throw new BadRequestException(
        `Submission ${newerSubmissionId} is not the newer half of conflict ${conflictGroupId}`,
      );
    }

    // P-14 (3.16 review) — cast widens to `number | null` to match the
    // runtime shape (OCR can produce a fuel-type label without a parseable
    // price). approveNewer's cache write filters non-finite below; the
    // admin UI's formatPrice helper handles null with a '—' fallback.
    const toRow = (s: typeof newer): FlaggedSubmissionRow => ({
      id: s.id,
      station_id: s.station_id,
      station_name: s.station?.name ?? null,
      price_data: s.price_data as Array<{ fuel_type: string; price_per_litre: number | null }>,
      ocr_confidence_score: s.ocr_confidence_score,
      created_at: s.created_at,
      user_id: s.user_id,
      flag_reason: s.flag_reason ?? 'price_conflict',
      conflict_group_id: s.conflict_group_id,
    });

    return { newer: toRow(newer), older: toRow(older) };
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
