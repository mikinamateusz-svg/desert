import {
  Controller,
  Get,
  Post,
  Param,
  ParseUUIDPipe,
  Query,
  Body,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { IsOptional, IsString, IsArray, IsUUID, ValidateNested, IsNumber, IsPositive } from 'class-validator';
import { Type } from 'class-transformer';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { UserRole, User } from '@prisma/client';
import { AdminSubmissionsService } from './admin-submissions.service.js';

class PriceEntryDto {
  @IsString()
  fuel_type!: string;

  @IsNumber()
  @IsPositive()
  price_per_litre!: number;
}

class RejectDto {
  @IsOptional()
  @IsString()
  notes?: string;
}

class ApproveDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PriceEntryDto)
  prices?: Array<{ fuel_type: string; price_per_litre: number }>;

  @IsOptional()
  @IsString()
  stationId?: string;
}

class ConflictNewerDto {
  // Story 3.16 — admin confirms which submission they consider "newer".
  // Defensive: if the UI ever sends a stale id, the service rejects it.
  // Story 3.17 — also reused by approve-older (DTO is shape-compatible:
  // either endpoint receives the id of the row admin wants to approve).
  @IsUUID()
  submission_id!: string;
}

@Controller('v1/admin/submissions')
@Roles(UserRole.ADMIN)
export class AdminSubmissionsController {
  constructor(private readonly service: AdminSubmissionsService) {}

  @Get()
  async list(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('flagReason') flagReason?: string,
  ) {
    const safePage = Math.max(1, page);
    const safeLimit = Math.max(1, Math.min(limit, 100));
    return this.service.listFlagged(safePage, safeLimit, flagReason || undefined);
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    return this.service.getDetail(id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  async approve(@Param('id') id: string, @Body() body: ApproveDto, @CurrentUser() admin: User) {
    await this.service.approve(id, admin.id, body.prices, body.stationId);
    return { status: 'approved' };
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  async reject(
    @Param('id') id: string,
    @Body() body: RejectDto,
    @CurrentUser() admin: User,
  ) {
    await this.service.reject(id, admin.id, body.notes ?? null);
    return { status: 'rejected' };
  }

  /**
   * Reset a shadow_rejected submission to pending and re-enqueue it through
   * the photo pipeline. Intended for recovering submissions that were
   * shadow-rejected for a reason that no longer applies (e.g. low_trust after
   * trust score is restored). Returns 202 Accepted to signal async processing.
   */
  @Post(':id/requeue')
  @HttpCode(HttpStatus.ACCEPTED)
  async requeue(@Param('id') id: string, @CurrentUser() admin: User) {
    await this.service.requeue(id, admin.id);
    return { status: 'requeued' };
  }

  // ── Story 3.16: paired-review actions on a price_conflict pair ─────────────

  /**
   * Approve the newer half of a conflict pair: newer → verified, older →
   * rejected with `auto_resolved_by_newer`. Body specifies which submission
   * the admin considers "newer" so a stale UI can't accidentally approve
   * the wrong row.
   */
  @Post('conflict/:conflictGroupId/approve-newer')
  @HttpCode(HttpStatus.OK)
  async approveNewer(
    @Param('conflictGroupId', ParseUUIDPipe) conflictGroupId: string,
    @Body() body: ConflictNewerDto,
    @CurrentUser() admin: User,
  ) {
    await this.service.approveNewer(admin.id, conflictGroupId, body.submission_id);
    return { status: 'resolved' };
  }

  /**
   * Story 3.17 — approve the older half of a conflict pair: older →
   * verified (with cache write + consensus seed), newer → rejected with
   * `auto_resolved_by_older`. Mirror of `approve-newer`. Body specifies
   * the older submission's id so a stale UI can't accidentally approve
   * the wrong row.
   */
  @Post('conflict/:conflictGroupId/approve-older')
  @HttpCode(HttpStatus.OK)
  async approveOlder(
    @Param('conflictGroupId', ParseUUIDPipe) conflictGroupId: string,
    @Body() body: ConflictNewerDto,
    @CurrentUser() admin: User,
  ) {
    await this.service.approveOlder(admin.id, conflictGroupId, body.submission_id);
    return { status: 'resolved' };
  }

  /**
   * Mark the newer half unusable: newer → rejected, older released back into
   * single-row review (flag_reason + conflict_group_id cleared on older only).
   */
  @Post('conflict/:conflictGroupId/newer-unusable')
  @HttpCode(HttpStatus.OK)
  async markNewerUnusable(
    @Param('conflictGroupId', ParseUUIDPipe) conflictGroupId: string,
    @Body() body: ConflictNewerDto,
    @CurrentUser() admin: User,
  ) {
    await this.service.markNewerUnusable(admin.id, conflictGroupId, body.submission_id);
    return { status: 'resolved' };
  }

  /**
   * Mark both halves unusable: both → rejected with `admin_marked_unusable`.
   * Cache stays where it is (read-path resolves from prior verified or estimates).
   */
  @Post('conflict/:conflictGroupId/both-unusable')
  @HttpCode(HttpStatus.OK)
  async markBothUnusable(
    @Param('conflictGroupId', ParseUUIDPipe) conflictGroupId: string,
    @CurrentUser() admin: User,
  ) {
    await this.service.markBothUnusable(admin.id, conflictGroupId);
    return { status: 'resolved' };
  }
}
