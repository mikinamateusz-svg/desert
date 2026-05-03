import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ClaimStatus, Prisma, UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { StationClaimService } from './station-claim.service.js';
import { ApproveClaimDto, RejectClaimDto, RequestDocsDto } from './dto/admin-action.dto.js';

/**
 * Admin queue endpoints for the manual review path (Story 7.1).
 * Backs the `/admin/station-claims` page in `apps/admin` (Chunk B).
 *
 * Mounted under `v1/admin/...` matching the existing admin convention
 * (admin-users, admin-price-rules, etc.). All routes require ADMIN role.
 */
@Controller('v1/admin/station-claims')
@Roles(UserRole.ADMIN)
export class StationClaimAdminController {
  constructor(private readonly claims: StationClaimService) {}

  /**
   * Queue listing. ?status= filters to one bucket (PENDING /
   * AWAITING_DOCS / APPROVED / REJECTED); omitted = all.
   * Default page 1, limit 50 — admin queue rarely has >50 entries
   * realistically; pagination is defensive.
   */
  @Get()
  list(
    @Query('status', new DefaultValuePipe(undefined), new ParseEnumPipe(ClaimStatus, { optional: true })) status: ClaimStatus | undefined,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.claims.listForAdmin({ status, page, limit });
  }

  /** Per-claim detail — feeds the admin review screen. */
  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.claims.getForAdmin(id);
  }

  /** Approve. Bumps DRIVER → STATION_MANAGER atomically with the status flip. */
  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  approve(
    @CurrentUser('id') reviewerUserId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ApproveClaimDto,
  ) {
    return this.claims.approveClaim(id, {
      reviewerUserId,
      method: dto.method,
      reviewerNotes: dto.reviewerNotes,
      // class-validator's @IsObject types this as Record<string, unknown>
      // — Prisma's InputJsonValue is structurally narrower (rejects
      // top-level arrays etc.). Safe coercion at the boundary; the DTO
      // contract via @IsObject already excludes the disallowed shapes.
      verificationEvidence: dto.verificationEvidence as Prisma.InputJsonValue | undefined,
    });
  }

  /** Reject with required reason — surfaces verbatim to the applicant. */
  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @CurrentUser('id') reviewerUserId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RejectClaimDto,
  ) {
    return this.claims.rejectClaim(id, {
      reviewerUserId,
      rejectionReason: dto.rejectionReason,
      reviewerNotes: dto.reviewerNotes,
    });
  }

  /**
   * Move to AWAITING_DOCS — sent when ops needs Story 7.2-style document
   * upload before deciding. Reviewer notes typically explain what's
   * needed.
   */
  @Post(':id/request-docs')
  @HttpCode(HttpStatus.OK)
  requestDocs(
    @CurrentUser('id') reviewerUserId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RequestDocsDto,
  ) {
    return this.claims.requestDocs(id, {
      reviewerUserId,
      reviewerNotes: dto.reviewerNotes,
    });
  }
}
