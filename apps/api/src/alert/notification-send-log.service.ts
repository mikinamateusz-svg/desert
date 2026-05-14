import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Story 6.8 — records ONE row per alert send batch (not per recipient).
 * Each alert pipeline calls `recordSend(alertType, recipientCount)` after
 * a successful chunk send. The admin analytics tab aggregates these for
 * the per-alert-type "sent" counts.
 *
 * Failures are swallowed — analytics breakage must never block a real
 * push send. The downstream metrics tolerate gaps (engagement rate is
 * just opened/sent over the chosen window).
 */
export type SendLogAlertType =
  | 'price_drop'
  | 'community_rise'
  | 'predictive_rise'
  | 'monthly_summary';

@Injectable()
export class NotificationSendLogService {
  private readonly logger = new Logger(NotificationSendLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async recordSend(alertType: SendLogAlertType, recipientCount: number): Promise<void> {
    if (recipientCount <= 0) return;
    try {
      await this.prisma.notificationSendLog.create({
        data: { alert_type: alertType, recipient_count: recipientCount },
      });
    } catch (e: unknown) {
      this.logger.warn(
        `Failed to record send log for ${alertType} (${recipientCount} recipients): ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }
}
