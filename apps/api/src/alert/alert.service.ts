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

    // 3. Query opted-in users with valid Expo push tokens
    const preferences = await this.prisma.notificationPreference.findMany({
      where: {
        sharp_rise: true,
        expo_push_token: { not: null },
      },
      select: { expo_push_token: true },
    });

    const validTokens = preferences
      .map((p) => p.expo_push_token as string)
      .filter((token) => this.expoPush.isValidToken(token));

    if (validTokens.length === 0) {
      this.logger.log('No opted-in users with valid push tokens — recording dedup and exiting');
      await this.recordAlertedTypes(newTypes);
      return;
    }

    this.logger.log(`Sending price rise alerts to ${validTokens.length} device(s)`);

    // 4. Build messages and send in chunks (Expo recommends max 100 per request)
    const messages: ExpoPushMessage[] = validTokens.map((token) => ({
      to: token,
      title: PUSH_TITLE,
      body: PUSH_BODY,
      data: { route: '/' },
      sound: 'default' as const,
    }));

    await this.sendInChunks(messages);

    // 5. Record dedup keys — prevent re-alerting within 48h per signal type
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
