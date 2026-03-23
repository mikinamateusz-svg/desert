import { Controller, Delete, HttpCode } from '@nestjs/common';
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
}
