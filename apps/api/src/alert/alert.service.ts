import { Injectable, Inject, Logger } from '@nestjs/common';
import type { ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import type Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import { EXPO_PUSH_CLIENT, type IExpoPushClient } from './expo-push.token.js';

// AC: one alert per signal_type per 48h window
const ALERT_DEDUP_TTL_SECONDS = 48 * 3600;

// Only consider signals recorded in the last 2 hours (fresh, just ingested)
const SIGNAL_WINDOW_MS = 2 * 60 * 60 * 1000;

const PUSH_TITLE = 'Fuel prices may be rising';
const PUSH_BODY =
  "Our data suggests fuel prices in your area may rise soon — worth filling up if you can.";

@Injectable()
export class PriceRiseAlertService {
  private readonly logger = new Logger(PriceRiseAlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(EXPO_PUSH_CLIENT) private readonly expoPush: IExpoPushClient,
  ) {}

  async sendRiseAlerts(): Promise<void> {
    // 1. Find significant movements recorded in the last 2 hours
    const since = new Date(Date.now() - SIGNAL_WINDOW_MS);
    const signals = await this.prisma.marketSignal.findMany({
      where: {
        significant_movement: true,
        recorded_at: { gte: since },
      },
      select: { signal_type: true },
      orderBy: { recorded_at: 'desc' },
    });

    if (signals.length === 0) {
      this.logger.log('No significant market movements in the last 2h — no alerts to send');
      return;
    }

    // 2. Filter to signal types not yet alerted within 48h (dedup)
    const candidateTypes = [...new Set(signals.map((s) => String(s.signal_type)))];
    const newTypes = await this.filterAlreadyAlerted(candidateTypes);

    if (newTypes.length === 0) {
      this.logger.log('All signal types already alerted within 48h — skipping');
      return;
    }

    this.logger.log(`New signal types to alert on: ${newTypes.join(', ')}`);

    // 3. Query opted-in users with valid Expo push tokens AND an active
    //    premium-alerts window (Story 6.10). The contribution-gated alerts
    //    loop means the price-rise push is reserved for users who have a
    //    non-null `premium_alerts_active_until` in the future — earned by
    //    each verified submission. SQL-level predicate to avoid fetching
    //    the full opted-in set into app memory.
    const now = new Date();
    const preferences = await this.prisma.notificationPreference.findMany({
      where: {
        sharp_rise: true,
        expo_push_token: { not: null },
        user: {
          premium_alerts_active_until: { gt: now },
          // P6 (6.10 review) — exclude soft-deleted users so we don't
          // push to abandoned accounts that retained their token.
          deleted_at: null,
        },
      },
      select: { user_id: true, expo_push_token: true },
    });

    if (preferences.length === 0) {
      this.logger.log('No opted-in users with valid push tokens — recording dedup and exiting');
      await this.recordAlertedTypes(newTypes);
      return;
    }

    // 4. Per-recipient: persist a DriverAlert row first (Story 6.11 AC2 —
    //    inbox record before push send). If the insert fails we skip the
    //    push for that user (no orphan pushes without an inbox row) but
    //    keep processing the rest of the batch so a single bad row never
    //    blocks alerts for everyone.
    const messages: ExpoPushMessage[] = [];
    let validTokenCount = 0;
    let persistFailures = 0;
    for (const pref of preferences) {
      const token = pref.expo_push_token as string;
      if (!this.expoPush.isValidToken(token)) continue;
      validTokenCount += 1;

      try {
        await this.prisma.driverAlert.create({
          data: {
            user_id: pref.user_id,
            alert_type: 'price_rise',
            title: PUSH_TITLE,
            body: PUSH_BODY,
            payload: {
              signalTypes: newTypes,
              deepLink: '/',
            },
          },
        });
      } catch (e: unknown) {
        persistFailures += 1;
        this.logger.warn(
          `Failed to persist DriverAlert for ${pref.user_id} — skipping push: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
        continue;
      }

      messages.push({
        to: token,
        title: PUSH_TITLE,
        body: PUSH_BODY,
        data: { route: '/' },
        sound: 'default' as const,
      });
    }

    if (messages.length === 0) {
      // P4 (6.11 review) — distinguish "no valid recipients" (record dedup —
      // there's nothing to retry) from "every persist failed" (don't dedup —
      // the next worker tick should retry once the DB is healthy). Without
      // this, a transient DB outage would silently suppress the signal type
      // for the full 48h dedup window with zero deliveries.
      if (validTokenCount > 0 && persistFailures === validTokenCount) {
        this.logger.error(
          `All ${persistFailures} DriverAlert inserts failed — skipping dedup so the next tick retries`,
        );
        return;
      }
      this.logger.log('No valid recipients — recording dedup and exiting');
      await this.recordAlertedTypes(newTypes);
      return;
    }

    this.logger.log(`Sending price rise alerts to ${messages.length} device(s)`);

    // 5. Send messages in chunks (Expo recommends max 100 per request).
    await this.sendInChunks(messages);

    // 6. Record dedup keys — prevent re-alerting within 48h per signal type.
    await this.recordAlertedTypes(newTypes);
  }

  private async filterAlreadyAlerted(signalTypes: string[]): Promise<string[]> {
    const newTypes: string[] = [];
    for (const type of signalTypes) {
      try {
        const exists = await this.redis.get(`alert:rise:${type}`);
        if (exists === null) newTypes.push(type);
      } catch (e: unknown) {
        // Fail-open: Redis unavailable → treat as new signal, log warning
        this.logger.warn(
          `Redis dedup check failed for ${type} — treating as new: ${e instanceof Error ? e.message : String(e)}`,
        );
        newTypes.push(type);
      }
    }
    return newTypes;
  }

  private async recordAlertedTypes(signalTypes: string[]): Promise<void> {
    for (const type of signalTypes) {
      try {
        await this.redis.set(`alert:rise:${type}`, '1', 'EX', ALERT_DEDUP_TTL_SECONDS);
      } catch (e: unknown) {
        this.logger.warn(
          `Failed to record dedup key for ${type}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  private async sendInChunks(messages: ExpoPushMessage[]): Promise<void> {
    const chunks = this.expoPush.chunkMessages(messages);

    for (const chunk of chunks) {
      try {
        const tickets: ExpoPushTicket[] = await this.expoPush.sendChunk(chunk);

        for (let i = 0; i < tickets.length; i++) {
          const ticket = tickets[i];
          if (ticket.status === 'error') {
            if (ticket.details?.error === 'DeviceNotRegistered') {
              // Expo guarantees tickets are returned in the same order as the chunk messages.
              // to is typed string | string[]; we always build single-token messages, but guard defensively.
              const rawTo = chunk[i].to;
              const staleToken = Array.isArray(rawTo) ? rawTo[0] : rawTo;
              if (!staleToken) {
                this.logger.warn('DeviceNotRegistered — token is empty, skipping cleanup');
              } else {
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
                    `Failed to clear stale token ${staleToken.slice(0, 20)}...: ${e instanceof Error ? e.message : String(e)}`,
                  );
                }
              }
            } else {
              this.logger.warn(`Push ticket error: ${ticket.message}`);
            }
          }
        }
      } catch (e: unknown) {
        // Partial delivery is better than no delivery — log and continue next chunk
        this.logger.error(
          `Failed to send push chunk: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }
}
