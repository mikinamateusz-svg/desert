import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { AlertsInboxService, type AlertListResult, type AlertRow } from './alerts-inbox.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
// P2 (6.11 review) — `?page=999999999` would compute an enormous OFFSET;
// the inbox is per-user and unlikely to exceed a few hundred rows even
// for power users, so cap aggressively. 10k * 20/page = 200k rows would
// still be well above any realistic single-user inbox.
const MAX_PAGE = 10_000;

/**
 * Story 6.11 — driver-facing inbox endpoints. Roles include ADMIN so admin
 * users (who may also receive alerts via their driver-side account) can
 * use the inbox normally. Filtering is always per-user — admins do not
 * see other users' alerts here.
 */
@Controller('v1/alerts')
export class AlertsInboxController {
  constructor(private readonly inbox: AlertsInboxService) {}

  @Get()
  // Mobile clients refetch on screen-mount + foreground + after read
  // actions. Rate-limit to cap pathological loops; 60/min fits normal
  // usage with headroom.
  @Throttle({ default: { ttl: 60, limit: 60 } })
  @Roles(UserRole.DRIVER, UserRole.ADMIN)
  list(
    @CurrentUser('id') userId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<AlertListResult> {
    const safePage = clampInt(page, 1, MAX_PAGE, 1);
    const safeLimit = clampInt(limit, 1, MAX_LIMIT, DEFAULT_LIMIT);
    return this.inbox.listForUser(userId, safePage, safeLimit);
  }

  // Literal `/read-all` route declared BEFORE the `:id/read` parameterised
  // route so the literal path matches first (Nest registers in declaration
  // order; without this `read-all` would be captured as `id=read-all`).
  @Post('read-all')
  @HttpCode(200)
  @Roles(UserRole.DRIVER, UserRole.ADMIN)
  markAllRead(@CurrentUser('id') userId: string): Promise<{ marked_read: number }> {
    return this.inbox.markAllRead(userId);
  }

  @Post(':id/read')
  @HttpCode(200)
  @Roles(UserRole.DRIVER, UserRole.ADMIN)
  markRead(
    @CurrentUser('id') userId: string,
    @Param('id') alertId: string,
  ): Promise<AlertRow> {
    return this.inbox.markRead(userId, alertId);
  }
}

/**
 * P3 (6.11 review) — `parseInt('0', 10) || fallback` collapses 0 to the
 * fallback (because `0` is falsy). Use Number.isFinite guards so explicit
 * 0 / negative / NaN inputs all clamp to the lower bound rather than
 * silently re-routing to the default.
 */
function clampInt(raw: string | undefined, min: number, max: number, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
