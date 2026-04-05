import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { UserRole, User } from '@prisma/client';
import { AdminUsersService } from './admin-users.service.js';

@Controller('v1/admin/users')
@Roles(UserRole.ADMIN)
export class AdminUsersController {
  constructor(private readonly service: AdminUsersService) {}

  @Get()
  async list(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('search') search?: string,
  ) {
    const safePage = Math.max(1, page);
    const safeLimit = Math.max(1, Math.min(limit, 100));
    return this.service.listUsers(safePage, safeLimit, search);
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    return this.service.getUser(id);
  }

  @Post(':id/shadow-ban')
  @HttpCode(HttpStatus.OK)
  async shadowBan(@Param('id') id: string, @CurrentUser() admin: User) {
    await this.service.shadowBan(id, admin.id);
    return { status: 'shadow_banned' };
  }

  @Post(':id/unban')
  @HttpCode(HttpStatus.OK)
  async unban(@Param('id') id: string, @CurrentUser() admin: User) {
    await this.service.unban(id, admin.id);
    return { status: 'unbanned' };
  }

  @Get(':id/alerts')
  async alerts(@Param('id') id: string) {
    return this.service.listAlerts(id);
  }

  @Post(':id/alerts/:alertId/dismiss')
  @HttpCode(HttpStatus.OK)
  async dismissAlert(@Param('id') id: string, @Param('alertId') alertId: string) {
    await this.service.dismissAlert(alertId, id);
    return { status: 'dismissed' };
  }
}
