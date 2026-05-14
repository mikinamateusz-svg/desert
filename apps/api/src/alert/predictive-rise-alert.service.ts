import { Injectable, Inject, Logger } from '@nestjs/common';
import type { ExpoPushMessage } from 'expo-server-sdk';
import type Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import { EXPO_PUSH_CLIENT, type IExpoPushClient } from './expo-push.token.js';
import { NotificationSendLogService } from './notification-send-log.service.js';
import type { PriceRiseSignalJobData } from '../market-signal/types.js';

// AC4 — one alert per fuel type per 72h window. Long enough to span the
// typical 1-2 day Brent → pump-price lag without re-spamming, short
// enough that a fresh cycle can fire next week.
const PREDICTIVE_DEDUP_TTL_SECONDS = 72 * 3600;

// AC2 — copy is intentionally identical to Phase 1's PriceRiseAlertService.
// Driver experience must be consistent across phases (the user can't tell
// — and shouldn't care — whether the signal came from ORLEN rack or Brent
// crude). Keeping the wording in lock-step also means a future translation
// pass updates one set of strings.
const PUSH_TITLE = 'Fuel prices may be rising';
const PUSH_BODY =
  'Our data suggests fuel prices in your area may rise soon — worth filling up if you can.';

interface EligibleUser {
  userId: string;
  pushToken: string;
}

@Injectable()
export class PredictiveRiseAlertService {
  private readonly logger = new Logger(PredictiveRiseAlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(EXPO_PUSH_CLIENT) private readonly expoPush: IExpoPushClient,
    private readonly sendLog: NotificationSendLogService,
  ) {}

  /**
   * AC1 — main job processor. Iterates fuel types in the signal,
   * atomically claims the per-fuel dedup slot (SET NX), and sends a
   * single notification covering all newly-claimed fuels.
   *
   * The claim is atomic so two concurrent jobs (e.g. ORLEN + Brent
   * arriving back-to-back, even with the 60s Brent delay) can't both
   * pass and both push. The 60s delay is now a redundant safety net,
   * not the correctness mechanism — same pattern as Story 6.1's
   * price-drop-alert.
   *
   * AC5 + Story 6.2 contract: the dedup key is the CYCLE MARKER, not
   * the recipient list. Once any caller claims it, no other predictive
   * job for that fuel will fire for 72h regardless of who actually
   * received the notification.
   */
  async processSignal(job: PriceRiseSignalJobData): Promise<void> {
    const newFuelTypes: string[] = [];
    for (const fuelType of job.fuelTypes) {
      // Atomic SET NX EX. Returns 'OK' if we won the slot; null if
      // another concurrent job already claimed it.
      if (await this.claimDedup(fuelType)) {
        newFuelTypes.push(fuelType);
      } else {
        this.logger.debug(`Predictive rise already claimed for ${fuelType} — skipping`);
      }
    }

    if (newFuelTypes.length === 0) return;

    this.logger.log(
      `Predictive rise signal: source=${job.signalSource} ` +
        `signalType=${job.signalType} ` +
        `fuels=${newFuelTypes.join(',')} ` +
        `pctMovement=${(job.pctMovement * 100).toFixed(1)}%`,
    );

    // Single user query — same opted-in cohort regardless of fuel type
    // since the notification body doesn't name the fuel.
    const users = await this.getEligibleUsers();
    if (users.length === 0) {
      this.logger.log('No opted-in users with valid push tokens for predictive rise alert');
    } else {
      this.logger.log(`Sending predictive rise alerts to ${users.length} device(s)`);
      await this.sendAlerts(users);
    }

    // Dedup slots already claimed atomically above. Nothing to record
    // here — the slots stand whether or not the push delivered.
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private async getEligibleUsers(): Promise<EligibleUser[]> {
    const prefs = await this.prisma.notificationPreference.findMany({
      where: {
        rise_predictive_enabled: true,
        expo_push_token: { not: null },
        // Mirror price-drop / community-rise services: skip soft-deleted
        // users so we don't push to abandoned accounts.
        user: { deleted_at: null },
      },
      select: { user_id: true, expo_push_token: true },
    });

    const out: EligibleUser[] = [];
    for (const p of prefs) {
      const token = p.expo_push_token;
      if (!token || !this.expoPush.isValidToken(token)) continue;
      out.push({ userId: p.user_id, pushToken: token });
    }
    return out;
  }

  private async sendAlerts(users: EligibleUser[]): Promise<void> {
    const messages: ExpoPushMessage[] = users.map((u) => ({
      to: u.pushToken,
      title: PUSH_TITLE,
      body: PUSH_BODY,
      // AC2 — deep-link to map view. Source data (ORLEN / Brent) is
      // never surfaced to the driver, only the directional intent.
      // Story 6.8 — alertType in payload so the mobile client can label
      // `notification_opened` events with the alert family.
      data: { route: '/', alertType: 'predictive_rise' },
      sound: 'default' as const,
    }));

    const chunks = this.expoPush.chunkMessages(messages);
    let cursor = 0;
    for (const chunk of chunks) {
      try {
        const tickets = await this.expoPush.sendChunk(chunk);
        for (let i = 0; i < tickets.length; i++) {
          const ticket = tickets[i];
          if (ticket.status === 'ok') continue;
          const userId = users[cursor + i]?.userId;
          if (ticket.details?.error === 'DeviceNotRegistered') {
            const rawTo = chunk[i].to;
            const staleToken = Array.isArray(rawTo) ? rawTo[0] : rawTo;
            if (staleToken && userId) {
              try {
                // user_id-scoped clear so a token shared via device
                // handoff / restore-from-backup only nulls the entry
                // for the user who actually got the DeviceNotRegistered
                // ticket.
                await this.prisma.notificationPreference.updateMany({
                  where: { user_id: userId, expo_push_token: staleToken },
                  data: { expo_push_token: null },
                });
                this.logger.warn(
                  `DeviceNotRegistered on predictive rise — cleared stale token for user ${userId} ` +
                    `(${staleToken.slice(0, 20)}...)`,
                );
              } catch (e) {
                this.logger.error(
                  `Failed to clear stale token for ${userId}: ${e instanceof Error ? e.message : String(e)}`,
                );
              }
            }
          } else {
            this.logger.warn(`Push ticket error for ${userId ?? '?'}: ${ticket.message}`);
          }
        }
      } catch (e) {
        // Partial-delivery: log + continue with the next chunk per the
        // codebase's standard alert-pipeline pattern.
        this.logger.error(
          `Failed to send predictive rise chunk: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      cursor += chunk.length;
    }

    // Story 6.8 — record one row per send batch (admin analytics aggregates
    // these for the per-alert-type "sent" count).
    await this.sendLog.recordSend('predictive_rise', messages.length);
  }

  /**
   * Atomic SET NX EX claim. Returns true if THIS call won the slot;
   * false if the key already existed (another concurrent job won it).
   *
   * The value MUST be the Unix-ms timestamp as a string — Story 6.2's
   * checkPredictiveTiming parses it back to compute age-since-predictive
   * vs the 6h "as-expected" / "too-soon" thresholds. TTL matches AC4's
   * 72h window.
   *
   * Fail-OPEN on Redis errors so a Redis outage doesn't suppress the
   * predictive alert pipeline entirely. A rare duplicate is a better
   * failure mode than silent suppression.
   */
  private async claimDedup(fuelType: string): Promise<boolean> {
    const key = predictiveDedupKey(fuelType);
    try {
      const reply = await this.redis.set(
        key,
        Date.now().toString(),
        'EX',
        PREDICTIVE_DEDUP_TTL_SECONDS,
        'NX',
      );
      return reply !== null;
    } catch (e) {
      this.logger.warn(
        `Redis dedup claim failed for ${key} — fail-open: ${e instanceof Error ? e.message : String(e)}`,
      );
      return true;
    }
  }
}

/**
 * Story 6.2/6.3 shared key contract — predictive alerts are NATIONAL
 * (no per-voivodeship scoping); a single alert covers all opted-in
 * drivers. Story 6.2 reads this exact key per fuel type to switch to
 * "as expected" copy after 6h.
 */
function predictiveDedupKey(fuelType: string): string {
  return `alert:rise:predictive:${fuelType}`;
}
