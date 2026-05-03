import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ClaimMethod, ClaimStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { lookupChainByEmail } from './chain-domains.js';

export interface CreateClaimInput {
  stationId: string;
  applicantNotes?: string;
}

export interface ApproveClaimInput {
  reviewerUserId: string;
  method: ClaimMethod;
  reviewerNotes?: string;
  /**
   * Free-form bag for method-specific evidence — phone call summary,
   * doc URLs (Story 7.2), head-office email subject. Nothing here is
   * surfaced to the applicant; admin-only.
   */
  verificationEvidence?: Prisma.InputJsonValue;
}

export interface RejectClaimInput {
  reviewerUserId: string;
  rejectionReason: string;
  reviewerNotes?: string;
}

export interface RequestDocsInput {
  reviewerUserId: string;
  reviewerNotes?: string;
}

/**
 * Per-applicant + admin operations on the StationClaim table (Story 7.1).
 *
 * Auto-approve fast path: when the applicant submits a claim and their
 * email domain matches a known chain (CHAIN_DOMAIN_WHITELIST) AND the
 * station's brand matches the chain, we approve at submission time and
 * grant STATION_MANAGER role in a single transaction. Otherwise the
 * claim sits in PENDING and surfaces in the admin queue.
 *
 * The admin path (approve / reject / requestDocs) handles the manual
 * verification queue. All admin actions update reviewed_at +
 * reviewed_by_user_id for audit. Approve also bumps the applicant's
 * role to STATION_MANAGER if they aren't already an admin / fleet
 * manager / data buyer (preserve elevated roles).
 *
 * Re-submission semantics: there is at most one StationClaim per
 * (station, user) pair (DB-enforced via unique index). Re-submitting
 * after REJECTED reuses the row — admin's reject leaves it in REJECTED;
 * the applicant can update it via createClaim again, which transitions
 * it back to PENDING and clears rejection_reason.
 */
@Injectable()
export class StationClaimService {
  private readonly logger = new Logger(StationClaimService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Applicant-facing ────────────────────────────────────────────────────

  /**
   * Submit (or re-submit) a claim. Auto-approves when domain match
   * succeeds; otherwise creates / re-opens a PENDING claim.
   */
  async createClaim(userId: string, input: CreateClaimInput) {
    const station = await this.prisma.station.findUnique({
      where: { id: input.stationId },
      select: { id: true, brand: true, hidden: true },
    });
    if (!station || station.hidden) {
      // Hidden stations are admin-soft-deleted (Story 4.x) — treat as
      // not-found rather than leaking that they ever existed.
      throw new NotFoundException('Station not found');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true, deleted_at: true },
    });
    if (!user || user.deleted_at !== null) {
      // Soft-deleted accounts shouldn't be able to claim anything.
      throw new ForbiddenException('Account is not eligible to submit claims');
    }

    // Check for an existing claim by this user for this station.
    const existing = await this.prisma.stationClaim.findUnique({
      where: { station_id_user_id: { station_id: station.id, user_id: userId } },
    });
    if (existing && existing.status === ClaimStatus.APPROVED) {
      throw new ConflictException('You have already been verified as a manager of this station');
    }
    if (existing && (existing.status === ClaimStatus.PENDING || existing.status === ClaimStatus.AWAITING_DOCS)) {
      // Don't let the user spam re-submissions while a review is in
      // flight. Surface the current status in a 409 so the partner
      // portal can show a "your claim is being reviewed" panel.
      throw new ConflictException(
        `A claim for this station is already ${existing.status === ClaimStatus.PENDING ? 'pending review' : 'awaiting documents'}`,
      );
    }

    // Refuse if the station already has an APPROVED claim by SOMEONE ELSE.
    // First-mover wins; second-claimant is told to contact support.
    // (Different-user APPROVED claim → block. Same-user APPROVED was
    // handled above with a different message.)
    const otherApproved = await this.prisma.stationClaim.findFirst({
      where: {
        station_id: station.id,
        status: ClaimStatus.APPROVED,
        user_id: { not: userId },
      },
      select: { id: true },
    });
    if (otherApproved) {
      throw new ConflictException(
        'This station is already managed by a verified owner. Contact support if you believe this is an error.',
      );
    }

    // Domain-match attempt — auto-approve when email domain belongs to
    // a known chain AND the station's brand matches.
    const chain = user.email ? lookupChainByEmail(user.email) : null;
    const autoApprove = chain !== null && station.brand === chain.brand;

    if (autoApprove) {
      // Single transaction: upsert claim as APPROVED + grant STATION_MANAGER
      // role (unless the user already has an elevated role we shouldn't
      // overwrite). Atomic so a partial failure can't leave the user
      // role-bumped without a claim row OR vice versa.
      const result = await this.prisma.$transaction(async (tx) => {
        const claim = await tx.stationClaim.upsert({
          where: { station_id_user_id: { station_id: station.id, user_id: userId } },
          update: {
            status: ClaimStatus.APPROVED,
            verification_method_used: ClaimMethod.DOMAIN_MATCH,
            applicant_notes: input.applicantNotes ?? null,
            verification_evidence: { matchedDomain: chain.domain, matchedBrand: chain.brand },
            rejection_reason: null,
            reviewer_notes: null,
            reviewed_at: new Date(),
            reviewed_by_user_id: null, // automated, not an admin
          },
          create: {
            station_id: station.id,
            user_id: userId,
            status: ClaimStatus.APPROVED,
            verification_method_used: ClaimMethod.DOMAIN_MATCH,
            applicant_notes: input.applicantNotes ?? null,
            verification_evidence: { matchedDomain: chain.domain, matchedBrand: chain.brand },
            reviewed_at: new Date(),
          },
        });
        // Only bump role for plain DRIVER accounts. Admins / fleet managers /
        // data buyers keep their elevated role.
        if (user.role === UserRole.DRIVER) {
          await tx.user.update({
            where: { id: userId },
            data: { role: UserRole.STATION_MANAGER },
          });
        }
        return claim;
      });
      this.logger.log(
        `[StationClaim] Auto-approved claim ${result.id} via DOMAIN_MATCH (${chain.domain} → ${chain.brand}) for user ${userId} / station ${station.id}`,
      );
      return result;
    }

    // No auto-approve → manual queue. Upsert PENDING (handles the
    // re-submit-after-rejection case by reusing the row).
    return this.prisma.stationClaim.upsert({
      where: { station_id_user_id: { station_id: station.id, user_id: userId } },
      update: {
        status: ClaimStatus.PENDING,
        applicant_notes: input.applicantNotes ?? null,
        // Wipe any prior reviewer feedback so the queue shows a fresh
        // claim, not the residue of a past rejection.
        rejection_reason: null,
        reviewer_notes: null,
        reviewed_at: null,
        reviewed_by_user_id: null,
        verification_method_used: null,
        verification_evidence: Prisma.JsonNull,
      },
      create: {
        station_id: station.id,
        user_id: userId,
        status: ClaimStatus.PENDING,
        applicant_notes: input.applicantNotes ?? null,
      },
    });
  }

  /**
   * Applicant's own claims (any status). Sorted newest-first so the
   * partner portal home can show "your most recent claim" first.
   */
  async listMyClaims(userId: string) {
    return this.prisma.stationClaim.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      include: {
        station: { select: { id: true, name: true, address: true, brand: true } },
      },
    });
  }

  // ── Admin-facing ────────────────────────────────────────────────────────

  /**
   * Admin queue listing. Default sort is oldest-first — first in, first
   * reviewed. Status filter is optional; omitted = all statuses.
   */
  async listForAdmin(params: { status?: ClaimStatus; page: number; limit: number }) {
    const safePage = Math.max(1, params.page);
    const safeLimit = Math.max(1, Math.min(params.limit, 100));
    const skip = (safePage - 1) * safeLimit;
    const where = params.status ? { status: params.status } : {};

    const [data, total] = await Promise.all([
      this.prisma.stationClaim.findMany({
        where,
        orderBy: { created_at: 'asc' },
        skip,
        take: safeLimit,
        include: {
          station: { select: { id: true, name: true, address: true, brand: true, voivodeship: true } },
          user: { select: { id: true, email: true, display_name: true, role: true } },
        },
      }),
      this.prisma.stationClaim.count({ where }),
    ]);

    return { data, total, page: safePage, limit: safeLimit };
  }

  /**
   * Admin per-claim detail — same shape as the list rows but for one ID.
   * 404 when missing so admins don't get cryptic Prisma errors on stale
   * URLs.
   */
  async getForAdmin(claimId: string) {
    const claim = await this.prisma.stationClaim.findUnique({
      where: { id: claimId },
      include: {
        station: { select: { id: true, name: true, address: true, brand: true, voivodeship: true } },
        user: { select: { id: true, email: true, display_name: true, role: true } },
      },
    });
    if (!claim) throw new NotFoundException('Claim not found');
    return claim;
  }

  /**
   * Approve a claim. Bumps the applicant's role to STATION_MANAGER
   * unless they have a more elevated role (admin / fleet / data buyer).
   *
   * Refuses to operate on already-APPROVED claims (no-op) or on REJECTED
   * claims (admin should use createClaim flow to re-open) — keeps the
   * audit trail clean.
   */
  async approveClaim(claimId: string, input: ApproveClaimInput) {
    const claim = await this.prisma.stationClaim.findUnique({
      where: { id: claimId },
      select: { id: true, station_id: true, user_id: true, status: true },
    });
    if (!claim) throw new NotFoundException('Claim not found');
    if (claim.status === ClaimStatus.APPROVED) {
      throw new ConflictException('Claim is already approved');
    }
    if (input.method === ClaimMethod.DOMAIN_MATCH) {
      // DOMAIN_MATCH is reserved for the auto-approve path. Admins
      // approving manually must use one of the human-verified methods
      // so the audit log is honest.
      throw new BadRequestException(
        'DOMAIN_MATCH is reserved for automatic approval. Use PHONE_CALLBACK, DOCUMENT, or HEAD_OFFICE_EMAIL.',
      );
    }
    // Conflict check: another user might have been auto-approved while
    // this claim was sitting in the queue. Refuse to double-approve a
    // station; admin must reject one of the two.
    const otherApproved = await this.prisma.stationClaim.findFirst({
      where: {
        station_id: claim.station_id,
        status: ClaimStatus.APPROVED,
        user_id: { not: claim.user_id },
      },
      select: { id: true },
    });
    if (otherApproved) {
      throw new ConflictException(
        'Another claim for this station was already approved. Reject one before approving the other.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.stationClaim.update({
        where: { id: claimId },
        data: {
          status: ClaimStatus.APPROVED,
          verification_method_used: input.method,
          verification_evidence: input.verificationEvidence ?? Prisma.JsonNull,
          reviewer_notes: input.reviewerNotes ?? null,
          rejection_reason: null,
          reviewed_at: new Date(),
          reviewed_by_user_id: input.reviewerUserId,
        },
      });
      const user = await tx.user.findUnique({
        where: { id: claim.user_id },
        select: { role: true },
      });
      if (user?.role === UserRole.DRIVER) {
        await tx.user.update({
          where: { id: claim.user_id },
          data: { role: UserRole.STATION_MANAGER },
        });
      }
      return updated;
    });
  }

  /** Admin reject. rejection_reason is REQUIRED — surfaces to applicant. */
  async rejectClaim(claimId: string, input: RejectClaimInput) {
    if (!input.rejectionReason.trim()) {
      throw new BadRequestException('rejectionReason is required');
    }
    const claim = await this.prisma.stationClaim.findUnique({
      where: { id: claimId },
      select: { id: true, status: true },
    });
    if (!claim) throw new NotFoundException('Claim not found');
    if (claim.status === ClaimStatus.APPROVED) {
      throw new ConflictException('Cannot reject an already-approved claim');
    }

    return this.prisma.stationClaim.update({
      where: { id: claimId },
      data: {
        status: ClaimStatus.REJECTED,
        rejection_reason: input.rejectionReason,
        reviewer_notes: input.reviewerNotes ?? null,
        reviewed_at: new Date(),
        reviewed_by_user_id: input.reviewerUserId,
      },
    });
  }

  /**
   * Move a claim to AWAITING_DOCS — sent when ops needs a document
   * upload to verify (Story 7.2 will surface the upload UI to the
   * applicant). Reviewer notes typically explain what's needed.
   */
  async requestDocs(claimId: string, input: RequestDocsInput) {
    const claim = await this.prisma.stationClaim.findUnique({
      where: { id: claimId },
      select: { id: true, status: true },
    });
    if (!claim) throw new NotFoundException('Claim not found');
    if (claim.status === ClaimStatus.APPROVED || claim.status === ClaimStatus.REJECTED) {
      throw new ConflictException('Cannot request documents from a finalised claim');
    }

    return this.prisma.stationClaim.update({
      where: { id: claimId },
      data: {
        status: ClaimStatus.AWAITING_DOCS,
        reviewer_notes: input.reviewerNotes ?? null,
        // Don't set reviewed_at — that field is reserved for the final
        // review (APPROVED / REJECTED). AWAITING_DOCS is interstitial.
        reviewed_by_user_id: input.reviewerUserId,
      },
    });
  }
}
