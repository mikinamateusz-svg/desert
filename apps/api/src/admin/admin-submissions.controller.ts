import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { UserRole, User } from '@prisma/client';
import { AdminSubmissionsService } from './admin-submissions.service.js';

class RejectDto {
  notes?: string;
}

class ApproveDto {
  prices?: Array<{ fuel_type: string; price_per_litre: number }>;
  stationId?: string;
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
}
