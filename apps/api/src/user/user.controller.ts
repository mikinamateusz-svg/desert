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

  /**
   * Story 6.10 / 6.13 — price-alerts status. Mobile clients fetch this
   * on app foreground + after submission verification events to drive
   * the bell-icon state on the map header. Tiny payload; cheap to poll.
   */
  @Get('alerts-status')
  // P7 (6.10 review) — mobile polls on every app foreground. Rate-limit
  // to cap pathological loops. 60/min generously fits normal usage.
  @Throttle({ default: { ttl: 60, limit: 60 } })
  @Roles(...ALL_ROLES)
  async getAlertsStatus(
    @CurrentUser() user: User,
  ): Promise<{ alerts_active_until: string | null }> {
    return {
      alerts_active_until: user.alerts_active_until?.toISOString() ?? null,
    };
  }
}
