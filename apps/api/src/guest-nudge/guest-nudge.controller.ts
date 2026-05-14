import { BadRequestException, Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator.js';
import { GuestNudgeService } from './guest-nudge.service.js';

const MAX_TOKEN_LEN = 500;
const MAX_EVENT_FIELD_LEN = 50;

// Story 6.9 — analytics event allowlist for guest nudges. Mirrors the
// mobile-side `apiLogGuestNudgeEvent` callers; anything outside this
// set is rejected with 400 to keep the NotificationEvent table free
// of arbitrary user-supplied event types.
const GUEST_NUDGE_EVENT_TYPES = new Set([
  'guest_nudge_shown',
  'guest_nudge_dismissed',
  'guest_nudge_cta_tapped',
]);
const GUEST_NUDGE_TRIGGERS = new Set(['engagement', 'market_event']);

interface RegisterTokenBody {
  token?: unknown;
}

interface NudgeEventBody {
  nudgeType?: unknown;
  eventName?: unknown;
}

function sanitiseString(raw: unknown, maxLen: number): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().slice(0, maxLen);
}

/**
 * Story 6.9 — three endpoints driving the guest conversion nudges.
 * All marked `@Public()` so JwtAuthGuard skips auth. Globals (throttler,
 * etc.) still apply; we add per-route throttles where appropriate.
 *
 * Route paths are absolute (no controller prefix) so the URLs come out
 * exactly as the spec calls for them: `/v1/guest/push-token`,
 * `/v1/nudge/market-event`, `/v1/nudge/events`.
 */
@Controller()
export class GuestNudgeController {
  constructor(private readonly service: GuestNudgeService) {}

  /**
   * Register an Expo push token for an unauthenticated guest. Upsert
   * keyed on token (idempotent re-registrations). Rate-limited per IP
   * to prevent table flooding by an attacker spraying random tokens.
   */
  @Post('v1/guest/push-token')
  @Public()
  @HttpCode(204)
  @Throttle({ default: { ttl: 60, limit: 10 } })
  async registerToken(@Body() body: RegisterTokenBody): Promise<void> {
    const token = sanitiseString(body.token, MAX_TOKEN_LEN);
    if (!token) {
      throw new BadRequestException('Missing token');
    }
    if (!this.service.isValidExpoToken(token)) {
      throw new BadRequestException('Invalid Expo push token format');
    }
    await this.service.registerToken(token);
  }

  /**
   * Used by the in-app banner fallback. Returns `active: true` while
   * the Redis dedup key is alive (set by `maybeNotifyGuests`).
   */
  @Get('v1/nudge/market-event')
  @Public()
  @Throttle({ default: { ttl: 60, limit: 60 } })
  async getMarketEvent(): Promise<{ active: boolean; eventId: string | null }> {
    return this.service.getActiveMarketEvent();
  }

  /**
   * Guest analytics events sink. Allowlist-validated nudgeType +
   * eventName; the persisted `event_type` is `<eventName>` and the
   * `trigger` is `<nudgeType>` so the 6.8 admin tab queries against
   * the same table can group / filter consistently.
   */
  @Post('v1/nudge/events')
  @Public()
  @HttpCode(204)
  @Throttle({ default: { ttl: 60, limit: 60 } })
  async logEvent(@Body() body: NudgeEventBody): Promise<void> {
    const nudgeType = sanitiseString(body.nudgeType, MAX_EVENT_FIELD_LEN);
    const eventName = sanitiseString(body.eventName, MAX_EVENT_FIELD_LEN);
    if (!nudgeType || !eventName) {
      throw new BadRequestException('Missing nudgeType or eventName');
    }
    if (!GUEST_NUDGE_TRIGGERS.has(nudgeType)) {
      throw new BadRequestException('Invalid nudgeType');
    }
    if (!GUEST_NUDGE_EVENT_TYPES.has(eventName)) {
      throw new BadRequestException('Invalid eventName');
    }
    await this.service.logEvent(eventName, nudgeType);
  }
}
