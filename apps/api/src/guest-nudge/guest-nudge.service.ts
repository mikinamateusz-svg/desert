import { Injectable, Inject, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { ExpoPushMessage } from 'expo-server-sdk';
import type Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import { EXPO_PUSH_CLIENT, type IExpoPushClient } from '../alert/expo-push.token.js';

/**
 * Story 6.9 — guest conversion nudges.
 *
 * Two surfaces are coordinated through this service:
 *   1. Push notification when a community-confirmed rise event fires
 *      (Story 6.2's threshold met). Sends to all `GuestPushToken` rows
 *      with a 48h Redis dedup so we never re-spam guests within the
 *      same market event window.
 *   2. The in-app banner fallback. Mobile reads `GET /v1/nudge/market-
 *      event`; when the Redis dedup key is alive AND the guest hasn't
 *      yet been pushed (no token registered or perms denied), the
 *      banner shows once per `eventId`.
 *
 * The Redis key `guest:nudge:market-event:latest` is the single source
 * of truth for "is there an active market event nudge right now?". Both
 * the push fire-and-forget (this service) and the banner endpoint (the
 * controller) read it.
 */
export const GUEST_MARKET_EVENT_KEY = 'guest:nudge:market-event:latest';
export const GUEST_MARKET_EVENT_TTL_SECONDS = 48 * 60 * 60;

const PUSH_TITLE = 'Fuel prices moved today';
const PUSH_BODY = 'Sign in to get a heads-up next time — and fill up before it happens.';
const PUSH_DEEP_LINK = '/(auth)/login';

@Injectable()
export class GuestNudgeService {
  private readonly logger = new Logger(GuestNudgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(EXPO_PUSH_CLIENT) private readonly expoPush: IExpoPushClient,
  ) {}

  /**
   * Called from CommunityRiseAlertService after a confirmation event.
   * Atomically claims the 48h dedup slot via SET NX EX; if another job
   * already claimed it, no-ops. Errors are swallowed — guest analytics
   * must never block the authenticated alert pipeline.
   */
  async maybeNotifyGuests(): Promise<void> {
    try {
      const marketEventId = randomUUID();
      const payload = JSON.stringify({
        eventId: marketEventId,
        triggeredAt: new Date().toISOString(),
      });

      // SET NX EX is atomic: the first caller wins the slot, every
      // concurrent caller gets `null` and exits. The TTL guarantees the
      // slot auto-clears after 48h so the next event window can fire.
      let claim: 'OK' | null;
      try {
        claim = await this.redis.set(
          GUEST_MARKET_EVENT_KEY,
          payload,
          'EX',
          GUEST_MARKET_EVENT_TTL_SECONDS,
          'NX',
        );
      } catch (e: unknown) {
        // Fail-CLOSED on Redis errors: better to skip one guest push
        // than to risk a re-spam every time we retry.
        this.logger.warn(
          `Redis SET NX failed for guest nudge — skipping: ${e instanceof Error ? e.message : String(e)}`,
        );
        return;
      }
      if (claim === null) {
        this.logger.log(
          'Guest market-event nudge already claimed in current 48h window — skipping push',
        );
        return;
      }

      const tokenRows = await this.prisma.guestPushToken.findMany({
        select: { token: true },
      });

      const validTokens = tokenRows
        .map((r) => r.token)
        .filter((t) => this.expoPush.isValidToken(t));

      if (validTokens.length === 0) {
        this.logger.log(
          `Guest nudge claim succeeded (eventId=${marketEventId}) but no guest push tokens registered — banner fallback only`,
        );
        return;
      }

      this.logger.log(
        `Sending guest market-event nudge to ${validTokens.length} device(s) (eventId=${marketEventId})`,
      );

      const messages: ExpoPushMessage[] = validTokens.map((token) => ({
        to: token,
        title: PUSH_TITLE,
        body: PUSH_BODY,
        data: {
          route: PUSH_DEEP_LINK,
          // Tagged distinctly from authenticated alerts so the mobile
          // `notification_opened` listener can skip it (the user isn't
          // signed in — there's no user_id to log against).
          alertType: 'guest_market_event',
        },
        sound: 'default' as const,
      }));

      const chunks = this.expoPush.chunkMessages(messages);
      for (const chunk of chunks) {
        try {
          await this.expoPush.sendChunk(chunk);
        } catch (e: unknown) {
          // Partial-delivery is acceptable per the codebase convention;
          // dedup key already set so a retry won't re-push.
          this.logger.error(
            `Guest nudge chunk failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    } catch (e: unknown) {
      // Outer safety net — never propagate to the caller (Story 6.2's
      // CommunityRiseAlertService). The authenticated alert pipeline is
      // the primary contract; guest nudges are best-effort.
      this.logger.error(
        `maybeNotifyGuests failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * Read the current market-event nudge state for the in-app banner
   * fallback. Returns `active: true` while the Redis dedup key is alive
   * AND parseable, `active: false` otherwise.
   */
  async getActiveMarketEvent(): Promise<{ active: boolean; eventId: string | null }> {
    try {
      const raw = await this.redis.get(GUEST_MARKET_EVENT_KEY);
      if (!raw) return { active: false, eventId: null };
      const parsed = JSON.parse(raw) as { eventId?: string };
      const eventId = typeof parsed.eventId === 'string' && parsed.eventId.length > 0
        ? parsed.eventId
        : null;
      return { active: eventId !== null, eventId };
    } catch (e: unknown) {
      // Fail-CLOSED: any read failure (Redis down, malformed value)
      // suppresses the banner rather than risking a misleading display.
      this.logger.warn(
        `getActiveMarketEvent failed — banner suppressed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return { active: false, eventId: null };
    }
  }

  /**
   * Persist a guest analytics event. Reuses the NotificationEvent table
   * from Story 6.8 (user_id null distinguishes guest events). Callers
   * stringify the nudge type + sub-event into a single event_type for
   * easy querying.
   */
  async logEvent(eventType: string, trigger: string | null): Promise<void> {
    try {
      await this.prisma.notificationEvent.create({
        data: {
          user_id: null,
          event_type: eventType,
          trigger,
          alert_type: null,
        },
      });
    } catch (e: unknown) {
      // Same fail-silent pattern as the authenticated event endpoint —
      // analytics breakage must never block UX.
      this.logger.warn(
        `Failed to log guest nudge event (${eventType}/${trigger}): ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  /**
   * Upsert a guest push token. Unique on `token`; repeat registrations
   * for the same device are no-ops. Caller is responsible for validating
   * the Expo token format (controller does that).
   */
  async registerToken(token: string): Promise<void> {
    await this.prisma.guestPushToken.upsert({
      where: { token },
      create: { token },
      update: {},
    });
  }

  /** Test seam: confirm whether the Expo token format check passes. */
  isValidExpoToken(token: string): boolean {
    return this.expoPush.isValidToken(token);
  }
}
