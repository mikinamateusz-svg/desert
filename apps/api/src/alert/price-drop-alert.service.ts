import { Injectable, Inject, Logger } from '@nestjs/common';
import type { ExpoPushMessage } from 'expo-server-sdk';
import type Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import { EXPO_PUSH_CLIENT, type IExpoPushClient } from './expo-push.token.js';
import type { PriceDropCheckJobData } from './price-drop-alert.constants.js';

// AC4 — per-user, per-fuel-type dedup. 4h window prevents spam within a
// single day but allows a second alert if prices drop again in the evening.
const DROP_DEDUP_TTL_SECONDS = 4 * 3600;

// AC4 — batching window for "X stations near you" copy. Other recent drops
// for the same fuel type within 30 min get folded into a single notification.
const BATCH_WINDOW_MS = 30 * 60 * 1000;

// Cap on the number of recent drops we scan for batching. PriceHistory can
// have arbitrarily many entries in 30 min — 20 is enough to give "3 nearby"
// copy variety without hammering the DB on a busy verification surge.
const RECENT_DROPS_SCAN_LIMIT = 20;

const FUEL_LABELS: Record<string, string> = {
  PB_95: 'PB95',
  PB_98: 'PB98',
  ON: 'Diesel',
  ON_PREMIUM: 'Diesel+',
  LPG: 'LPG',
};

interface CandidateUser {
  userId: string;
  pushToken: string;
  mode: 'cheaper_than_now' | 'target_price';
  targetPln: number | null;
  radiusKm: number;
}

interface UserLocation {
  lat: number;
  lng: number;
  voivodeship: string | null;
}

interface StationMatch {
  stationId: string;
  stationName: string;
  pricePln: number;
  // 0 means coarse voivodeship match — no precise distance available because
  // the user has no fill-up history with a geo-located station.
  distanceKm: number;
}

@Injectable()
export class PriceDropAlertService {
  private readonly logger = new Logger(PriceDropAlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(EXPO_PUSH_CLIENT) private readonly expoPush: IExpoPushClient,
  ) {}

  async checkAndNotify(job: PriceDropCheckJobData): Promise<void> {
    const { stationId, fuelType, newPricePln, stationVoivodeship } = job;

    // 1. Resolve the dropped-price station for name + voivodeship + location.
    const station = await this.prisma.station.findUnique({
      where: { id: stationId },
      select: { id: true, name: true, voivodeship: true },
    });
    if (!station) {
      this.logger.warn(`Station ${stationId} not found — skipping price-drop check`);
      return;
    }
    // Prefer the freshly-fetched DB voivodeship over the job's snapshot —
    // an admin correction in the interim should win over the stale job.
    const effectiveVoivodeship = station.voivodeship ?? stationVoivodeship;

    // 2. Candidates first — we need to know if anyone wants cheaper_than_now
    //    before paying for the 7-day MIN aggregation.
    const candidates = await this.getCandidateUsers(fuelType);
    if (candidates.length === 0) return;

    // 3. areaMin only when at least one cheaper_than_now candidate exists.
    //    If everyone subscribed in target_price mode, the MIN aggregation
    //    is wasted work.
    const needsAreaMin = candidates.some((c) => c.mode === 'cheaper_than_now');
    const areaMin =
      needsAreaMin && effectiveVoivodeship
        ? await this.getCurrentAreaMin(effectiveVoivodeship, fuelType, stationId)
        : null;

    // Per-user location cache for the duration of this job — extendWithRecentDrops
    // would otherwise re-issue the same FillUp lookup for every recent drop.
    const locationCache = new Map<string, UserLocation | null>();
    const getLocation = async (userId: string): Promise<UserLocation | null> => {
      if (locationCache.has(userId)) return locationCache.get(userId)!;
      const loc = await this.getUserLocationProxy(userId);
      locationCache.set(userId, loc);
      return loc;
    };

    // 4. For each candidate: threshold → radius → atomic dedup claim. We
    //    claim the dedup slot BEFORE building the notification (SET NX) so
    //    two concurrent jobs for the same (user, fuel) within the 4h window
    //    can't both pass and both push. Threshold + radius checks come first
    //    to avoid burning the dedup slot on a user who wouldn't qualify.
    const notifyMap = new Map<string, { user: CandidateUser; matchedStations: StationMatch[] }>();
    for (const user of candidates) {
      const meetsThreshold =
        user.mode === 'cheaper_than_now'
          ? areaMin !== null && this.isCheaperThan(newPricePln, areaMin)
          : user.targetPln !== null && newPricePln <= user.targetPln;
      if (!meetsThreshold) continue;

      const userLocation = await getLocation(user.userId);
      const distance = await this.distanceWithinRadius(
        userLocation,
        stationId,
        effectiveVoivodeship,
        user.radiusKm,
      );
      if (distance === false) continue;

      // Atomic claim: SET NX returns null when the key already exists, in
      // which case another concurrent job already won this slot for this
      // (user, fuel). Skip silently. This closes the TOCTOU race that
      // GET-then-SET would leave open under rapid verifications.
      const dedupKey = `alert:drop:${user.userId}:${fuelType}`;
      if (!(await this.claimDedup(dedupKey))) continue;

      notifyMap.set(user.userId, {
        user,
        matchedStations: [
          { stationId, stationName: station.name, pricePln: newPricePln, distanceKm: distance },
        ],
      });
    }

    if (notifyMap.size === 0) return;

    // 5. AC4 — batching. For each qualifying user, fold in any other recent
    //    drops in the same fuel type within their radius AND meeting the
    //    user's threshold rule. Best-effort — failures here just mean the
    //    notification isn't batched.
    await this.extendWithRecentDrops(
      notifyMap,
      fuelType,
      stationId,
      effectiveVoivodeship,
      areaMin,
      job.verifiedAt,
      getLocation,
    );

    // 6. Send.
    await this.sendNotifications(notifyMap, fuelType);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private async getCandidateUsers(fuelType: string): Promise<CandidateUser[]> {
    const prefs = await this.prisma.notificationPreference.findMany({
      where: {
        price_drop_enabled: true,
        expo_push_token: { not: null },
        // Mirror Story 6.10 P6 — exclude soft-deleted users so we don't push
        // to abandoned accounts that retained their token.
        user: { deleted_at: null },
      },
      select: {
        user_id: true,
        expo_push_token: true,
        price_drop_mode: true,
        price_drop_target_pln: true,
        price_drop_fuel_types: true,
        alert_radius_km: true,
      },
    });

    const out: CandidateUser[] = [];
    for (const p of prefs) {
      const token = p.expo_push_token;
      if (!token || !this.expoPush.isValidToken(token)) continue;

      // Empty fuel-type list means "no preference set" — UI hint is
      // "pick at least one to receive alerts", so treat as opt-out
      // rather than implicit opt-in to everything.
      const fuels = p.price_drop_fuel_types ?? [];
      if (fuels.length === 0 || !fuels.includes(fuelType)) continue;

      out.push({
        userId: p.user_id,
        pushToken: token,
        mode: (p.price_drop_mode === 'target_price' ? 'target_price' : 'cheaper_than_now'),
        targetPln: p.price_drop_target_pln !== null ? Number(p.price_drop_target_pln) : null,
        radiusKm: p.alert_radius_km,
      });
    }
    return out;
  }

  private async getUserLocationProxy(userId: string): Promise<UserLocation | null> {
    // Most recent fill-up whose station has a PostGIS location. Drivers who
    // log fillups at GPS-less stations fall through to the voivodeship-only
    // path inside distanceWithinRadius.
    const result = await this.prisma.$queryRaw<
      Array<{ lat: number | null; lng: number | null; voivodeship: string | null }>
    >`
      SELECT
        ST_Y(s.location::geometry) AS lat,
        ST_X(s.location::geometry) AS lng,
        s.voivodeship AS voivodeship
      FROM "FillUp" f
      JOIN "Station" s ON s.id = f.station_id
      WHERE f.user_id = ${userId}::uuid
        AND s.location IS NOT NULL
      ORDER BY f.filled_at DESC
      LIMIT 1
    `;
    const row = result[0];
    if (!row || row.lat === null || row.lng === null) {
      // No geo-located fill-up. Try voivodeship-only fallback from the most
      // recent fill-up where a station is attached (station_id is nullable
      // when GPS match failed). Supports AC5 coarse matching when the user
      // only has fill-ups at stations without GPS.
      const fallback = await this.prisma.fillUp.findFirst({
        where: { user_id: userId, station_id: { not: null } },
        select: { station: { select: { voivodeship: true } } },
        orderBy: { filled_at: 'desc' },
      });
      const voivodeship = fallback?.station?.voivodeship ?? null;
      if (!voivodeship) return null;
      return { lat: NaN, lng: NaN, voivodeship };
    }
    return { lat: row.lat, lng: row.lng, voivodeship: row.voivodeship };
  }

  /**
   * Returns the distance in km if the station is within the radius, or
   * false otherwise. A return value of 0 specifically means "voivodeship
   * coarse match" — used when the user has no GPS-located fill-up history
   * and we fall back to AC5's voivodeship rule.
   */
  private async distanceWithinRadius(
    userLocation: UserLocation | null,
    stationId: string,
    stationVoivodeship: string | null,
    radiusKm: number,
  ): Promise<number | false> {
    if (!userLocation) return false;

    // Voivodeship coarse-match fallback: when we don't have lat/lng for the
    // user (NaN sentinel set in getUserLocationProxy), accept iff the
    // voivodeships line up. AC5: "if the user has no fill-up history [with
    // GPS], the voivodeship of the dropped-price station is used as a
    // coarse match against the user's most recent fill-up voivodeship".
    if (Number.isNaN(userLocation.lat) || Number.isNaN(userLocation.lng)) {
      return stationVoivodeship !== null && stationVoivodeship === userLocation.voivodeship
        ? 0
        : false;
    }

    const radiusMetres = radiusKm * 1000;
    const result = await this.prisma.$queryRaw<Array<{ distance_m: number }>>`
      SELECT ST_Distance(
        s.location,
        ST_SetSRID(ST_MakePoint(${userLocation.lng}, ${userLocation.lat}), 4326)::geography
      ) AS distance_m
      FROM "Station" s
      WHERE s.id = ${stationId}::uuid
        AND s.location IS NOT NULL
        AND ST_DWithin(
          s.location,
          ST_SetSRID(ST_MakePoint(${userLocation.lng}, ${userLocation.lat}), 4326)::geography,
          ${radiusMetres}
        )
    `;
    if (!result[0]) return false;
    // 1-decimal km — matches the notification copy precision.
    return Math.round(result[0].distance_m / 100) / 10;
  }

  private async getCurrentAreaMin(
    voivodeship: string,
    fuelType: string,
    excludeStationId: string,
  ): Promise<number | null> {
    const result = await this.prisma.$queryRaw<Array<{ min_price: number | null }>>`
      SELECT MIN(ph.price)::float AS min_price
      FROM "PriceHistory" ph
      JOIN "Station" s ON s.id = ph.station_id
      WHERE s.voivodeship = ${voivodeship}
        AND ph.fuel_type = ${fuelType}
        AND ph.station_id != ${excludeStationId}::uuid
        AND ph.recorded_at >= NOW() - INTERVAL '7 days'
    `;
    return result[0]?.min_price ?? null;
  }

  private async extendWithRecentDrops(
    notifyMap: Map<string, { user: CandidateUser; matchedStations: StationMatch[] }>,
    fuelType: string,
    sourceStationId: string,
    voivodeship: string | null,
    areaMin: number | null,
    verifiedAt: string,
    getLocation: (userId: string) => Promise<UserLocation | null>,
  ): Promise<void> {
    // Anchor the batch window on verifiedAt — if a job sits in the queue
    // longer than expected, we still ask "what dropped within 30min OF the
    // original drop", not "of now", so backlog jobs don't fold in newer
    // verifications that postdate them.
    const sinceMs = new Date(verifiedAt).getTime() - BATCH_WINDOW_MS;
    const since = new Date(Number.isFinite(sinceMs) ? sinceMs : Date.now() - BATCH_WINDOW_MS);
    let recentDrops: Array<{ station_id: string; price_pln: number; station: { name: string; voivodeship: string | null } }>;
    try {
      const rows = await this.prisma.priceHistory.findMany({
        where: {
          fuel_type: fuelType,
          recorded_at: { gte: since },
          // Exclude the source station — its row is already in matchedStations
          // and the seen-set would skip it anyway, but keeping it out of the
          // 20-row scan budget gives more slots to genuine neighbours.
          station_id: { not: sourceStationId },
          // Voivodeship-scope at the query level prunes nation-wide noise:
          // recent drops in faraway provinces would all fail the radius
          // check anyway, but pre-filtering avoids the N+1 PostGIS hits.
          ...(voivodeship ? { station: { voivodeship } } : {}),
        },
        select: {
          station_id: true,
          price: true,
          station: { select: { name: true, voivodeship: true } },
        },
        // Most-recent-first. Was previously price ASC, which sampled the
        // cheapest 20 globally and starved fresh drops at higher (but
        // still-good) prices.
        orderBy: { recorded_at: 'desc' },
        take: RECENT_DROPS_SCAN_LIMIT,
      });
      recentDrops = rows.map((r) => ({
        station_id: r.station_id,
        price_pln: Number(r.price),
        station: r.station,
      }));
    } catch (err) {
      // Best-effort. If the lookup fails, users still get a single-station
      // notification — they just don't get the "3 stations" batched copy.
      this.logger.warn(
        `extendWithRecentDrops scan failed for ${fuelType}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    for (const [, entry] of notifyMap) {
      const seen = new Set(entry.matchedStations.map((m) => m.stationId));
      const userLocation = await getLocation(entry.user.userId);
      for (const drop of recentDrops) {
        if (seen.has(drop.station_id)) continue;
        // Apply the same threshold rule we used for the source station, so
        // a target_price=5.50 user doesn't get "3 stations dropped" copy
        // listing two stations at 6.50.
        const meetsThreshold =
          entry.user.mode === 'cheaper_than_now'
            ? areaMin !== null && this.isCheaperThan(drop.price_pln, areaMin)
            : entry.user.targetPln !== null && drop.price_pln <= entry.user.targetPln;
        if (!meetsThreshold) continue;
        const distance = await this.distanceWithinRadius(
          userLocation,
          drop.station_id,
          drop.station.voivodeship,
          entry.user.radiusKm,
        );
        if (distance === false) continue;
        entry.matchedStations.push({
          stationId: drop.station_id,
          stationName: drop.station.name,
          pricePln: drop.price_pln,
          distanceKm: distance,
        });
        seen.add(drop.station_id);
      }
    }
  }

  private async sendNotifications(
    notifyMap: Map<string, { user: CandidateUser; matchedStations: StationMatch[] }>,
    fuelType: string,
  ): Promise<void> {
    const messages: ExpoPushMessage[] = [];
    const userIdsByMessage: string[] = [];

    for (const [userId, { user, matchedStations }] of notifyMap) {
      // Sort cheapest-first; deep-link target + headline copy both reference
      // the cheapest station so users tap into the best deal.
      matchedStations.sort((a, b) => a.pricePln - b.pricePln);
      const cheapest = matchedStations[0];
      const { title, body } = this.buildNotificationPayload(matchedStations, fuelType);

      messages.push({
        to: user.pushToken,
        title,
        body,
        data: { route: `/station/${cheapest.stationId}` },
        sound: 'default' as const,
      });
      userIdsByMessage.push(userId);
    }

    if (messages.length === 0) return;

    const chunks = this.expoPush.chunkMessages(messages);
    let cursor = 0;
    for (const chunk of chunks) {
      try {
        const tickets = await this.expoPush.sendChunk(chunk);
        for (let i = 0; i < tickets.length; i++) {
          const ticket = tickets[i];
          const userId = userIdsByMessage[cursor + i];
          const fuelKey = `alert:drop:${userId}:${fuelType}`;
          if (ticket.status === 'ok') {
            // Dedup slot was already claimed before send (SET NX). Nothing
            // to do here — the slot stands.
            continue;
          }
          // Release the dedup slot on any non-ok ticket so the next
          // verification can retry instead of being suppressed for 4h.
          await this.releaseDedup(fuelKey);
          if (ticket.details?.error === 'DeviceNotRegistered') {
            const rawTo = chunk[i].to;
            const staleToken = Array.isArray(rawTo) ? rawTo[0] : rawTo;
            if (staleToken) {
              try {
                // user_id-scoped clear so a token shared via device handoff
                // / restore-from-backup only nulls the entry for the user
                // who actually got the DeviceNotRegistered ticket.
                await this.prisma.notificationPreference.updateMany({
                  where: { user_id: userId, expo_push_token: staleToken },
                  data: { expo_push_token: null },
                });
                this.logger.warn(
                  `DeviceNotRegistered — cleared stale token for user ${userId} (${staleToken.slice(0, 20)}...)`,
                );
              } catch (e) {
                this.logger.error(
                  `Failed to clear stale token for ${userId}: ${e instanceof Error ? e.message : String(e)}`,
                );
              }
            }
          } else {
            this.logger.warn(`Push ticket error for ${userId}: ${ticket.message}`);
          }
        }
      } catch (e) {
        // Whole-chunk send failure: release dedup for everyone in this
        // chunk so the next verification gets a chance.
        for (let i = 0; i < chunk.length; i++) {
          const userId = userIdsByMessage[cursor + i];
          await this.releaseDedup(`alert:drop:${userId}:${fuelType}`);
        }
        this.logger.error(
          `Failed to send price-drop chunk: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      cursor += chunk.length;
    }
  }

  private buildNotificationPayload(
    matches: StationMatch[],
    fuelType: string,
  ): { title: string; body: string } {
    const fuelLabel = FUEL_LABELS[fuelType] ?? fuelType;
    const cheapest = matches[0];
    const priceStr = cheapest.pricePln.toFixed(2);
    // distanceKm of 0 = voivodeship coarse match (unknown precise distance).
    const distStr = cheapest.distanceKm > 0 ? `${cheapest.distanceKm} km away` : 'nearby';

    if (matches.length === 1) {
      return {
        title: `${fuelLabel} price drop`,
        body: `${fuelLabel} dropped to ${priceStr} PLN/L at ${cheapest.stationName} — ${distStr}`,
      };
    }
    return {
      title: `Prices dropped at ${matches.length} stations near you`,
      body: `Cheapest: ${fuelLabel} at ${priceStr} PLN/L at ${cheapest.stationName} — tap to see all`,
    };
  }

  /**
   * Atomic dedup claim. Returns true if THIS call won the slot; false if the
   * key already existed (another concurrent job won it). Replaces the prior
   * GET-then-SET pattern that left a TOCTOU race window between the two
   * Redis round-trips. Fail-open on Redis errors so a Redis outage doesn't
   * suppress alerts entirely.
   */
  private async claimDedup(key: string): Promise<boolean> {
    try {
      const reply = await this.redis.set(key, '1', 'EX', DROP_DEDUP_TTL_SECONDS, 'NX');
      return reply !== null;
    } catch (e) {
      this.logger.warn(
        `Redis dedup claim failed for ${key} — fail-open: ${e instanceof Error ? e.message : String(e)}`,
      );
      return true;
    }
  }

  /**
   * Release a previously-claimed dedup slot. Called when delivery fails so
   * the next verification can retry the alert (otherwise a transient send
   * failure would suppress alerts for the full 4h window).
   */
  private async releaseDedup(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (e) {
      this.logger.warn(
        `Failed to release drop dedup key ${key}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * Float-safe price comparison. PriceHistory.price is Float; the round-trip
   * through Postgres ::float can produce ~1e-15 deltas at boundary values,
   * which would flip strict-less-than at the cent boundary. Compare in
   * integer cents instead to keep the boundary deterministic.
   */
  private isCheaperThan(a: number, b: number): boolean {
    return Math.round(a * 100) < Math.round(b * 100);
  }
}
