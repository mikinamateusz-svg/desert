import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Story 6.10 / 6.13 — price-alerts contribution loop.
 *
 * `alerts_active_until` extends to MAX(current_value, NOW + 30d) on every
 * submission transitioning to `verified` (auto-pipeline or admin approve).
 * The MAX semantics mean a flurry of verifications never shortens an
 * already-active window — each contribution either renews or extends.
 *
 * `PriceRiseAlertService` filters recipients to rows where this column is
 * non-null and in the future. The 3-day pre-expiry warning worker
 * (`AlertsExpiryWarningWorker`) picks up users whose value is between
 * NOW + 2d and NOW + 4d and pushes a renewal nudge.
 *
 * Naming: was `PremiumAlertsService` until Story 6.13 retired the
 * "premium" framing — alerts are core + contribution-gated, never paid.
 */
export const ALERT_WINDOW_DAYS = 30;

@Injectable()
export class AlertsActivationService {
  private readonly logger = new Logger(AlertsActivationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Extend the user's price-alerts window. Call once per submission
   * verification event. Idempotent: re-running on the same user with no
   * intervening time change is a no-op (MAX(current, NOW + 30d) returns
   * the same value within the same second).
   *
   * Best-effort: any DB error is logged and swallowed — we never want to
   * block the verified-flip flow on an alerts-window write failure.
   * The user's window will simply not extend on this submission; the
   * next one will catch up.
   */
  async extendForUser(userId: string): Promise<void> {
    const newUntil = new Date(Date.now() + ALERT_WINDOW_DAYS * 86_400_000);
    try {
      // Single UPDATE using GREATEST so a flurry of verifications never
      // shortens an already-future value. NULL is treated as "not active",
      // so the very first verification sets the window to now + 30d.
      await this.prisma.$executeRaw`
        UPDATE "User"
        SET "alerts_active_until" = GREATEST(
          COALESCE("alerts_active_until", to_timestamp(0)),
          ${newUntil}::timestamp
        )
        WHERE id = ${userId}
      `;
    } catch (err) {
      // Don't propagate — the verified-flip happened, the user just won't
      // get the alerts extension on this particular event. Next one catches up.
      this.logger.warn(
        `extendForUser failed for user ${userId} — alerts-window write skipped: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
