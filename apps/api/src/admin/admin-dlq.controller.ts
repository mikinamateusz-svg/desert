import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { UserRole, User } from '@prisma/client';
import { AdminDlqService } from './admin-dlq.service.js';

@Controller('v1/admin/dlq')
@Roles(UserRole.ADMIN)
export class AdminDlqController {
  constructor(private readonly service: AdminDlqService) {}

  @Get()
  async list() {
    return this.service.listDlq();
  }

  @Post(':jobId/retry')
  @HttpCode(HttpStatus.OK)
  async retry(@Param('jobId') jobId: string, @CurrentUser() admin: User) {
    if (!/^\d+$/.test(jobId)) {
      throw new BadRequestException(`Invalid job ID format: ${jobId}`);
    }
    await this.service.retryJob(jobId, admin.id);
    return { status: 'retried' };
  }

  @Post(':jobId/discard')
  @HttpCode(HttpStatus.OK)
  async discard(
    @Param('jobId') jobId: string,
    @CurrentUser() admin: User,
    @Body('notes') notes?: string,
  ) {
    if (!/^\d+$/.test(jobId)) {
      throw new BadRequestException(`Invalid job ID format: ${jobId}`);
    }
    await this.service.discardJob(jobId, admin.id, notes);
    return { status: 'discarded' };
  }
}
