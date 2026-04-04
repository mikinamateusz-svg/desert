import { BadRequestException, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ConsentType, User, UserRole } from '@prisma/client';
import { UserService } from './user.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';

const ALL_ROLES = [
  UserRole.DRIVER,
  UserRole.STATION_MANAGER,
  UserRole.FLEET_MANAGER,
  UserRole.ADMIN,
  UserRole.DATA_BUYER,
] as const;

@Controller('v1/me')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Delete()
  @HttpCode(204)
  @Roles(...ALL_ROLES)
  async deleteAccount(@CurrentUser() user: User): Promise<void> {
    await this.userService.deleteAccount(user.id, user.supertokens_id!);
  }

  @Get('consents')
  @Roles(...ALL_ROLES)
  async getConsents(@CurrentUser() user: User) {
    return this.userService.getConsents(user.id);
  }

  @Post('consents/:type/withdraw')
  @HttpCode(204)
  @Roles(...ALL_ROLES)
  async withdrawConsent(
    @CurrentUser() user: User,
    @Param('type') type: string,
  ): Promise<void> {
    if (!Object.values(ConsentType).includes(type as ConsentType)) {
      throw new BadRequestException('Invalid consent type');
    }
    await this.userService.withdrawConsent(user.id, type as ConsentType);
  }

  @Post('export')
  @HttpCode(202)
  @Throttle({ default: { ttl: 3600, limit: 3 } })
  @Roles(...ALL_ROLES)
  async requestDataExport(@CurrentUser() user: User): Promise<{ message: string }> {
    if (!user.email) {
      throw new BadRequestException('Account has been deleted — export not available');
    }
    const presignedUrl = await this.userService.exportMyData(user.id);
    void this.userService.sendExportEmail(user.email, presignedUrl);
    return { message: 'Export prepared. Check your email.' };
  }
}
