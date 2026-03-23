import { Controller, Get, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { SubmissionsService } from './submissions.service.js';
import { GetSubmissionsDto } from './dto/get-submissions.dto.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';

@Controller('v1/submissions')
export class SubmissionsController {
  constructor(private readonly submissionsService: SubmissionsService) {}

  @Get()
  @Roles(UserRole.DRIVER)
  getMySubmissions(
    @CurrentUser('id') userId: string,
    @Query() dto: GetSubmissionsDto,
  ) {
    return this.submissionsService.getMySubmissions(userId, dto.page, dto.limit);
  }
}
