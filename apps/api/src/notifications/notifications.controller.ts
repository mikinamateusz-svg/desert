import { Body, Controller, Get, Patch } from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto.js';
import { CurrentUser } from '../auth/current-user.decorator.js';

@Controller('v1/me/notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  getPreferences(@CurrentUser('id') userId: string) {
    return this.notificationsService.getPreferences(userId);
  }

  @Patch()
  updatePreferences(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateNotificationPreferencesDto,
  ) {
    return this.notificationsService.updatePreferences(userId, dto);
  }
}
