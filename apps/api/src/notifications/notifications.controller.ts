import { BadRequestException, Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { NotificationsService } from './notifications.service.js';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';

// Story 6.8 — allowlist of authenticated user event types. Spec allowlist
// (`'reprompt_shown' | 'reprompt_dismissed' | 'reprompt_granted' |
// 'notification_opened'`). Anything outside this list is rejected with 400.
const ALLOWED_EVENT_TYPES = new Set([
  'reprompt_shown',
  'reprompt_dismissed',
  'reprompt_granted',
  'notification_opened',
]);
const MAX_FIELD_LEN = 50;

interface NotificationEventBody {
  eventType?: string;
  trigger?: string | null;
  alertType?: string | null;
}

function sanitiseField(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_FIELD_LEN);
}

const ALL_ROLES = [
  UserRole.DRIVER,
  UserRole.STATION_MANAGER,
  UserRole.FLEET_MANAGER,
  UserRole.ADMIN,
  UserRole.DATA_BUYER,
] as const;

@Controller('v1/me/notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @Roles(...ALL_ROLES)
  getPreferences(@CurrentUser('id') userId: string) {
    return this.notificationsService.getPreferences(userId);
  }

  @Patch()
  @Roles(...ALL_ROLES)
  updatePreferences(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateNotificationPreferencesDto,
  ) {
    return this.notificationsService.updatePreferences(userId, dto);
  }

  /**
   * Story 6.6 — drives the monthly-summary smart re-prompt sheet shown
   * on app open when the user has no push token but Story 6.5 has
   * computed a summary for them. Mobile calls this once per session and
   * suppresses further calls via AsyncStorage two-strike flags.
   */
  @Get('summary-reprompt')
  @Roles(...ALL_ROLES)
  getSummaryReprompt(@CurrentUser('id') userId: string) {
    return this.notificationsService.getSummaryReprompt(userId);
  }

  /**
   * Story 6.8 — analytics event sink. Mobile fires re-prompt show /
   * dismiss / grant events from NotificationRepromptSheet and
   * notification-open events from the root layout's
   * `addNotificationResponseReceivedListener`. Best-effort from the
   * client; this endpoint validates + persists. Response is a 204 since
   * the client doesn't need anything back.
   */
  @Post('events')
  @HttpCode(204)
  @Roles(...ALL_ROLES)
  async recordEvent(
    @CurrentUser('id') userId: string,
    @Body() body: NotificationEventBody,
  ): Promise<void> {
    const eventType = sanitiseField(body.eventType);
    if (!eventType || !ALLOWED_EVENT_TYPES.has(eventType)) {
      throw new BadRequestException('Invalid eventType');
    }
    await this.notificationsService.recordEvent(userId, {
      eventType,
      trigger: sanitiseField(body.trigger),
      alertType: sanitiseField(body.alertType),
    });
  }
}
