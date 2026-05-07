import { Injectable, Inject, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module.js';

// Station dedup: 12 hours — prices rarely change more than once a day.
const STATION_DEDUP_WINDOW_SECONDS = 12 * 3600;

// Hash dedup: 24 hours — catches exact duplicate photos submitted twice.
const HASH_DEDUP_TTL_SECONDS = 24 * 3600;

// Story 3.16: ±0.05 PLN/l per fuel is treated as OCR noise rather than a
// real disagreement. Boundary is inclusive: exactly ±0.05 still corroborates.
const PRICE_NOISE_THRESHOLD = 0.05;

/**
 * Story 3.16 — structured station dedup record stored at
 * `dedup:station:{stationId}`. Replaces the legacy boolean `'1'` value with
 * a corroboration counter so a second driver's photo can either confirm
 * the first one (count → 2, confirmed → true, OCR skipped from then on)
 * or contradict it (routed to admin paired-review via `conflict_group_id`).
 */
export interface StationDedupRecord {
  /** 1 after first verified submission, 2 after second corroborates. Caps at 2. */
  count: number;
  /** True once the count reaches 2 and prices match within noise. */
  confirmed: boolean;
  /** SHA-256 of the canonical-form price_data. Null for legacy/migrated records. */
  prices_hash: string | null;
  /** Epoch ms — informational; the 12h boundary is enforced by Redis TTL. */
  last_at: number;
}


@Injectable()
export class SubmissionDedupService {
  private readonly logger = new Logger(SubmissionDedupService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** Compute SHA-256 hex digest of a photo buffer. */
  static computePhotoHash(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Story 3.16 — canonical hash of the price set for corroboration.
   *
   * - Drops null / non-finite prices (OCR can return a fuel-type label
   *   without a value; that entry doesn't participate in the hash).
   * - Rounds to 2 decimal places to absorb the common 6.490 vs 6.49 case.
   * - Uppercases fuel_type so a hypothetical OCR drift between `'ON'` and
   *   `'on'` doesn't produce a false fuel-set-mismatch (P-15 / P-16).
   * - Sorts by fuel_type so OCR's emit order doesn't matter.
   *
   * Two submissions for the same station produce the same hash iff the
   * fuel set matches AND every price agrees to 2 decimal places. A noise
   * difference (≤ ±0.05 PLN/l) yields different hashes and falls through
   * to {@link compareWithinNoise} for the soft-corroboration check.
   *
   * P-17 (3.16 review) — Edge case: when the canonical array is empty
   * (all prices were null / non-finite), the SHA of `'[]'` is a fixed
   * constant, so two submissions with no parseable prices would
   * hash-collide and falsely corroborate. The pipeline already rejects
   * empty `price_data` upstream (`no_prices_extracted`), so this branch
   * is unreachable today — but we return a unique sentinel rather than
   * the deterministic empty-array hash to harden against a future
   * upstream regression.
   */
  static hashPriceData(
    prices: ReadonlyArray<{ fuel_type: string; price_per_litre: number | null }>,
  ): string {
    const canonical = prices
      .filter(
        (p): p is { fuel_type: string; price_per_litre: number } =>
          typeof p.price_per_litre === 'number' && Number.isFinite(p.price_per_litre),
      )
      .map((p) => ({
        fuel_type: p.fuel_type.toUpperCase(),
        price: Math.round(p.price_per_litre * 100) / 100,
      }))
      .sort((a, b) => a.fuel_type.localeCompare(b.fuel_type));
    if (canonical.length === 0) {
      // Sentinel — a random per-call value so two empty hashes never
      // match each other (preventing false corroboration on a future
      // upstream regression that allows all-null price_data through).
      return `empty:${randomUUID()}`;
    }
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  }

  /**
   * Story 3.16 — soft-corroboration check after exact-hash mismatch.
   *
   * - `'fuel-set-mismatch'`: the fuel keys differ (different scene; caller
   *   treats as a fresh first-submission rather than a corroboration).
   * - `'within-noise'`: every fuel agrees to ±0.05 PLN/l. Caller marks
   *   the record `confirmed: true` and lets the newer prices win.
   * - `'beyond-noise'`: at least one fuel differs by more than the
   *   threshold. Caller routes to the conflict path.
   *
   * Boundary is inclusive (`Math.abs(diff) <= 0.05`) so a clean ±0.05
   * difference still counts as corroboration — the symmetric case to the
   * 2-decimal rounding in {@link hashPriceData}.
   */
  static compareWithinNoise(
    prevPrices: ReadonlyArray<{ fuel_type: string; price_per_litre: number | null }>,
    newPrices: ReadonlyArray<{ fuel_type: string; price_per_litre: number | null }>,
  ): 'within-noise' | 'beyond-noise' | 'fuel-set-mismatch' {
    const prevMap = SubmissionDedupService.toFuelMap(prevPrices);
    const newMap = SubmissionDedupService.toFuelMap(newPrices);

    if (prevMap.size !== newMap.size) return 'fuel-set-mismatch';
    for (const fuel of prevMap.keys()) {
      if (!newMap.has(fuel)) return 'fuel-set-mismatch';
    }

    for (const [fuel, prev] of prevMap) {
      const next = newMap.get(fuel)!;
      if (Math.abs(prev - next) > PRICE_NOISE_THRESHOLD) return 'beyond-noise';
    }
    return 'within-noise';
  }

  private static toFuelMap(
    prices: ReadonlyArray<{ fuel_type: string; price_per_litre: number | null }>,
  ): Map<string, number> {
    const m = new Map<string, number>();
    for (const p of prices) {
      if (typeof p.price_per_litre === 'number' && Number.isFinite(p.price_per_litre)) {
        // P-15 (3.16 review) — uppercase normalization for symmetry with
        // {@link hashPriceData}. Same defensive layer for the same reason.
        m.set(p.fuel_type.toUpperCase(), p.price_per_litre);
      }
    }
    return m;
  }

  /**
   * Story 3.16 — parse a raw Redis value into a {@link StationDedupRecord},
   * with backward compatibility for Story 3.10's boolean `'1'` keys.
   *
   * - `'1'` (legacy) → stub `{ count: 1, confirmed: false, prices_hash: null,
   *   last_at: now() - (12h - ttlSeconds) }`. The next write rewrites it as
   *   JSON, so within 12h of deploy every active station has migrated.
   * - JSON string → parse + shape-validate. Defensive: bad shape → log + absent.
   * - Anything else → defensive log + absent.
   *
   * Returns `null` to signal "treat as absent" so the caller falls through
   * to the fresh-record path without crashing on a corrupt key.
   */
  static parseDedupRecord(rawValue: string, ttlSeconds: number): StationDedupRecord | null {
    if (rawValue === '1') {
      // P-7 (3.16 review) — derive last_at only when ttlSeconds is a real
      // remaining-TTL value. Redis returns -1 (key has no TTL — shouldn't
      // happen for our SET-EX writes but defensive) and -2 (key gone, race
      // between get and ttl). In both cases fall back to "now" so downstream
      // last_at consumers don't see a fabricated 12h-ago timestamp.
      const safeTtl = ttlSeconds > 0 ? ttlSeconds : STATION_DEDUP_WINDOW_SECONDS;
      return {
        count: 1,
        confirmed: false,
        prices_hash: null,
        last_at: Date.now() - Math.max(0, STATION_DEDUP_WINDOW_SECONDS - safeTtl) * 1000,
      };
    }
    try {
      const parsed = JSON.parse(rawValue) as unknown;
      if (
        parsed == null ||
        typeof parsed !== 'object' ||
        !('count' in parsed) ||
        !('confirmed' in parsed) ||
        !('prices_hash' in parsed) ||
        !('last_at' in parsed)
      ) {
        return null;
      }
      const r = parsed as {
        count: unknown;
        confirmed: unknown;
        prices_hash: unknown;
        last_at: unknown;
      };
      // P-8 (3.16 review) — value-range validation. A poisoned record with
      // count: 0, confirmed: true would skip OCR until TTL; negative or
      // non-integer counts have no defined semantics. Reject anything that
      // doesn't match the documented invariants and let the caller treat
      // it as absent (re-seed on next verify).
      if (
        !Number.isInteger(r.count) ||
        (r.count as number) < 0 ||
        (r.count as number) > 2 ||
        typeof r.confirmed !== 'boolean' ||
        (r.prices_hash !== null && typeof r.prices_hash !== 'string') ||
        typeof r.last_at !== 'number' ||
        !Number.isFinite(r.last_at as number) ||
        (r.last_at as number) > Date.now() + 60_000 // tolerate <60s clock skew
      ) {
        return null;
      }
      return {
        count: r.count as number,
        confirmed: r.confirmed,
        prices_hash: r.prices_hash as string | null,
        last_at: r.last_at as number,
      };
    } catch {
      return null;
    }
  }

  /**
   * Returns true if a verified OCR result for this station was recorded within the last 12 hours.
   * Key: `dedup:station:{stationId}`
   *
   * @deprecated Story 3.16 — use {@link checkStationConsensus} for the
   * structured corroboration record. Kept temporarily for any caller still
   * on the legacy boolean shape; will be removed once all sites migrate.
   */
  async checkStationDedup(stationId: string): Promise<boolean> {
    const val = await this.redis.get(`dedup:station:${stationId}`);
    return val !== null;
  }

  /**
   * Records a successful OCR result for this station with a 12-hour TTL.
   * Uses SET key 1 EX ttl (SETEX is deprecated in Redis 7+).
   *
   * @deprecated Story 3.16 — use {@link recordStationConsensus}. Same removal
   * timeline as {@link checkStationDedup}.
   */
  async recordStationDedup(stationId: string): Promise<void> {
    await this.redis.set(`dedup:station:${stationId}`, '1', 'EX', STATION_DEDUP_WINDOW_SECONDS);
  }

  /**
   * Story 3.16 — read the consensus record for a station and decide what
   * the pipeline should do.
   *
   * - `'fresh'`: no record exists (or it can't be parsed). Process this
   *   submission as the first one in the window.
   * - `'corroborate-candidate'`: a `count: 1` record exists. Process this
   *   submission, then compare prices post-OCR to either confirm
   *   (record → `count: 2, confirmed: true`) or route to conflict.
   * - `'duplicate'`: `confirmed: true` and within 12h. Skip OCR entirely.
   *
   * Fail-open on Redis errors — if the read fails, return `'fresh'` and
   * log a warning so a degraded Redis never blocks a verification. The
   * caller can still record a record afterwards; same pattern as the
   * legacy `checkStationDedup`.
   */
  async checkStationConsensus(
    stationId: string,
  ): Promise<
    | { skip: false; reason: 'fresh'; record: null }
    | { skip: false; reason: 'corroborate-candidate'; record: StationDedupRecord }
    | { skip: true; reason: 'duplicate'; record: StationDedupRecord }
  > {
    const key = `dedup:station:${stationId}`;
    let raw: string | null;
    let ttl: number;
    try {
      [raw, ttl] = await Promise.all([this.redis.get(key), this.redis.ttl(key)]);
    } catch (e: unknown) {
      this.logger.warn(
        `checkStationConsensus: Redis read failed for ${stationId}, falling through to fresh: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      return { skip: false, reason: 'fresh', record: null };
    }

    if (raw === null) {
      return { skip: false, reason: 'fresh', record: null };
    }

    const record = SubmissionDedupService.parseDedupRecord(raw, ttl > 0 ? ttl : 0);
    if (record === null) {
      this.logger.warn(
        `checkStationConsensus: corrupt/unrecognised dedup value at ${key}, treating as fresh`,
      );
      return { skip: false, reason: 'fresh', record: null };
    }

    if (record.confirmed) {
      return { skip: true, reason: 'duplicate', record };
    }
    return { skip: false, reason: 'corroborate-candidate', record };
  }

  /**
   * Story 3.16 — write the consensus record for a station with a 12-hour TTL.
   *
   * Stored as JSON-stringified {@link StationDedupRecord}. The next
   * {@link checkStationConsensus} read parses it; legacy `'1'` values still
   * in Redis from Story 3.10 are migrated lazily on first read.
   */
  async recordStationConsensus(stationId: string, record: StationDedupRecord): Promise<void> {
    await this.redis.set(
      `dedup:station:${stationId}`,
      JSON.stringify(record),
      'EX',
      STATION_DEDUP_WINDOW_SECONDS,
    );
  }

  /**
   * Returns true if this exact photo (by SHA-256 hash) was submitted within the last 24 hours.
   * Key: `dedup:hash:{sha256hex}`
   */
  async checkHashDedup(hash: string): Promise<boolean> {
    const val = await this.redis.get(`dedup:hash:${hash}`);
    return val !== null;
  }

  /**
   * Records a photo hash with a 24-hour TTL.
   */
  async recordHashDedup(hash: string): Promise<void> {
    await this.redis.set(`dedup:hash:${hash}`, '1', 'EX', HASH_DEDUP_TTL_SECONDS);
  }

  /**
   * Lift both station and hash dedup keys for a submission. Used when a driver
   * flags their own submission as wrong (Story 3.14) — without lifting, their
   * immediate retake at the same station with the same scene would be silently
   * dedup'd, defeating the self-correction loop.
   *
   * Best-effort: a Redis failure on either key logs but doesn't throw. The flag
   * action shouldn't fail just because Redis is degraded; worst case the user
   * waits 12h for the natural TTL to expire. Both deletes run in parallel.
   */
  async liftDedup(stationId: string | null, photoHash: string | null): Promise<void> {
    const ops: Array<Promise<unknown>> = [];
    if (stationId) ops.push(this.redis.del(`dedup:station:${stationId}`));
    if (photoHash) ops.push(this.redis.del(`dedup:hash:${photoHash}`));
    if (ops.length === 0) return;
    const results = await Promise.allSettled(ops);
    for (const r of results) {
      if (r.status === 'rejected') {
        this.logger.warn(
          `liftDedup: Redis delete failed: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`,
        );
      }
    }
  }
}
