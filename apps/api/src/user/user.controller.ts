import { BadRequestException, Controller, Delete, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UserService } from './user.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { User } from '@prisma/client';

@Controller('v1/me')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Delete()
  @HttpCode(204)
  async deleteAccount(@CurrentUser() user: User): Promise<void> {
    await this.userService.deleteAccount(user.id, user.supertokens_id!);
  }

  @Post('export')
  @HttpCode(202)
  @Throttle({ default: { ttl: 3600, limit: 3 } })
  async requestDataExport(@CurrentUser() user: User): Promise<{ message: string }> {
    if (!user.email) {
      throw new BadRequestException('Account has been deleted — export not available');
    }
    const presignedUrl = await this.userService.exportMyData(user.id);
    void this.userService.sendExportEmail(user.email, presignedUrl);
    return { message: 'Export prepared. Check your email.' };
  }
}
