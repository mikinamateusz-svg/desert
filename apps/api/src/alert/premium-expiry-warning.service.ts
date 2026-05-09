import { Injectable, Inject, Logger } from '@nestjs/common';
import type { ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import type Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import { EXPO_PUSH_CLIENT, type IExpoPushClient } from './expo-push.token.js';

/**
 * Story 6.10 — pre-expiry warning push for the contribution-gated alerts
 * loop. Runs daily; finds users whose `premium_alerts_active_until` is
 * between NOW + 2d and NOW + 4d (the "≤ 3 days remaining" window) and
 * pushes a renewal nudge to take another photo. Per-user dedup at 14d
 * prevents repeat warnings for the same expiry cycle when a user contributes
 * irregularly. Best-effort throughout — every failure is logged but never
 * propagates.
 */
const WARNING_WINDOW_MIN_DAYS = 2;
const WARNING_WINDOW_MAX_DAYS = 4;
const DEDUP_TTL_SECONDS = 14 * 86_400;

const PUSH_TITLE = 'Twoje alerty premium wygasają wkrótce';
const PUSH_BODY = 'Zrób zdjęcie cen paliw, aby przedłużyć alerty o kolejne 30 dni.';
const PUSH_DEEP_LINK = '/(app)/alerts';

@Injectable()
export class PremiumExpiryWarningService {
  private readonly logger = new Logger(PremiumExpiryWarningService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(EXPO_PUSH_CLIENT) private readonly expoPush: IExpoPushClient,
  ) {}

  /**
   * Find users whose premium-alerts window is between 2 and 4 days away
   * from expiry and push a renewal nudge to each. Per-user dedup at 14d
   * via Redis. Skip silently when a user has no opted-in `sharp_rise`
   * preference or no Expo token (alerts only flow to push-enabled users).
   */
  async sendExpiryWarnings(): Promise<void> {
    const now = new Date();
    const windowStart = new Date(now.getTime() + WARNING_WINDOW_MIN_DAYS * 86_400_000);
    const windowEnd = new Date(now.getTime() + WARNING_WINDOW_MAX_DAYS * 86_400_000);

    const candidates = await this.prisma.notificationPreference.findMany({
      where: {
        sharp_rise: true,
        expo_push_token: { not: null },
        user: {
          premium_alerts_active_until: { gte: windowStart, lte: windowEnd },
          // P6 (6.10 review) — exclude soft-deleted users.
          deleted_at: null,
        },
      },
      select: {
        user_id: true,
        expo_push_token: true,
      },
    });

    if (candidates.length === 0) {
      this.logger.log('No users in 2-4d expiry window — nothing to do');
      return;
    }

    // Filter out users we've already warned in the last 14 days.
    const toWarn: Array<{ userId: string; token: string }> = [];
    for (const c of candidates) {
      const token = c.expo_push_token as string;
      if (!this.expoPush.isValidToken(token)) continue;

      const dedupKey = this.dedupKey(c.user_id);
      try {
        const exists = await this.redis.get(dedupKey);
        if (exists !== null) continue;
      } catch (e: unknown) {
        // Fail-open: Redis unavailable → still send. Avoids "no warnings ever
        // because dedup-store is down" silent failure mode.
        this.logger.warn(
          `Redis dedup check failed for ${c.user_id} — sending anyway: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
      toWarn.push({ userId: c.user_id, token });
    }

    if (toWarn.length === 0) {
      this.logger.log(`Found ${candidates.length} candidates, all already warned within 14d`);
      return;
    }

    // Story 6.11 AC3 — persist a DriverAlert inbox row per recipient
    // before sending the push. If the insert fails for a user we skip
    // their push (no orphan push without inbox record) but continue
    // processing the rest so one failure doesn't block the batch.
    const persisted: Array<{ userId: string; token: string }> = [];
    for (const { userId, token } of toWarn) {
      try {
        await this.prisma.driverAlert.create({
          data: {
            user_id: userId,
            alert_type: 'premium_expiring_warning',
            title: PUSH_TITLE,
            body: PUSH_BODY,
            payload: {
              deepLink: PUSH_DEEP_LINK,
            },
          },
        });
        persisted.push({ userId, token });
      } catch (e: unknown) {
        this.logger.warn(
          `Failed to persist DriverAlert for ${userId} — skipping push: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }

    if (persisted.length === 0) {
      this.logger.log('All candidates failed to persist — no pushes to send');
      return;
    }

    this.logger.log(`Sending premium-expiry warnings to ${persisted.length} user(s)`);

    const messages: ExpoPushMessage[] = persisted.map(({ token }) => ({
      to: token,
      title: PUSH_TITLE,
      body: PUSH_BODY,
      data: { route: PUSH_DEEP_LINK },
      sound: 'default' as const,
    }));

    await this.sendInChunks(messages);

    // Record dedup keys + audit-log entry per user. Best-effort each — a
    // single failure shouldn't block the rest of the batch. Iterates
    // `persisted` (not `toWarn`) so users whose DriverAlert insert failed
    // are not deduped — they'll be reconsidered on the next worker tick.
    for (const { userId } of persisted) {
      try {
        await this.redis.set(this.dedupKey(userId), '1', 'EX', DEDUP_TTL_SECONDS);
      } catch (e: unknown) {
        this.logger.warn(
          `Failed to record dedup key for ${userId}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }

      // P2 (6.10 review) — audit-log entry per warning push so admins can
      // diagnose "why did this user get warned" / "did our warning fire?"
      // questions post-hoc. submission_id is null since this isn't tied to
      // a submission; admin_user_id stores the recipient userId so the
      // existing admin queue groups by user view still surfaces the rows.
      try {
        await this.prisma.adminAuditLog.create({
          data: {
            admin_user_id: userId,
            action: 'PREMIUM_EXPIRING_WARNING_SENT',
            submission_id: null,
            notes: JSON.stringify({
              warned_at: new Date().toISOString(),
            }),
          },
        });
      } catch (e: unknown) {
        this.logger.warn(
          `Failed to write audit log for warning sent to ${userId}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }
  }

  private dedupKey(userId: string): string {
    // Spec AC4 — `premium_expiring_warning:{user_id}` namespace.
    return `premium_expiring_warning:${userId}`;
  }

  private async sendInChunks(messages: ExpoPushMessage[]): Promise<void> {
    const chunks = this.expoPush.chunkMessages(messages);
    for (const chunk of chunks) {
      try {
        const tickets: ExpoPushTicket[] = await this.expoPush.sendChunk(chunk);
        for (let i = 0; i < tickets.length; i++) {
          const ticket = tickets[i];
          if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
            const rawTo = chunk[i].to;
            const staleToken = Array.isArray(rawTo) ? rawTo[0] : rawTo;
            if (staleToken) {
              try {
                await this.prisma.notificationPreference.updateMany({
                  where: { expo_push_token: staleToken },
                  data: { expo_push_token: null },
                });
                this.logger.warn(
                  `DeviceNotRegistered — cleared stale token ${staleToken.slice(0, 20)}...`,
                );
              } catch (e: unknown) {
                this.logger.error(
                  `Failed to clear stale token: ${e instanceof Error ? e.message : String(e)}`,
                );
              }
            }
          }
        }
      } catch (e: unknown) {
        this.logger.error(
          `Expo push chunk failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }
}
