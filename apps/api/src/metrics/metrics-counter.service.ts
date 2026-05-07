import { Injectable, Inject, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module.js';

const COUNTER_TTL_SECONDS = 33 * 24 * 60 * 60; // 33 days — covers 30d period + 3d buffer

function redisKey(prefix: string, date: string): string {
  return `metrics:${prefix}:${date.replace(/-/g, '')}`; // e.g. metrics:map_views:20260406
}

@Injectable()
export class MetricsCounterService {
  private readonly logger = new Logger(MetricsCounterService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Increment the daily map-view counter. Fire-and-forget — never blocks the request path.
   * Tracks total views and authenticated views separately for guest/auth ratio.
   */
  incrementMapView(authenticated: boolean): void {
    const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const totalKey = redisKey('map_views', day);
    const authKey = redisKey('map_views_auth', day);

    // On first increment (result === 1) set TTL so keys auto-expire after 33 days.
    this.redis
      .incr(totalKey)
      .then(v => { if (v === 1) this.redis.expire(totalKey, COUNTER_TTL_SECONDS).catch(() => {}); })
      .catch(() => {});

    if (authenticated) {
      this.redis
        .incr(authKey)
        .then(v => { if (v === 1) this.redis.expire(authKey, COUNTER_TTL_SECONDS).catch(() => {}); })
        .catch(() => {});
    }
  }

  /**
   * Story 3.16 — increment the daily counter for a consensus dedup decision.
   * One emission per submission's dedup outcome:
   *  - 'fresh' / 'corroborated_exact' / 'corroborated_within_noise' /
   *    'conflict_detected' on the verify-or-conflict path.
   *  - 'duplicate_skipped' on the L2 short-circuit (no OCR cost).
   * Fire-and-forget — never blocks the worker.
   */
  incrementDedupDecision(
    decision:
      | 'fresh'
      | 'corroborated_exact'
      | 'corroborated_within_noise'
      | 'conflict_detected'
      | 'duplicate_skipped'
      | 'fuel_set_mismatch',
  ): void {
    const day = new Date().toISOString().slice(0, 10);
    const key = redisKey(`dedup_${decision}`, day);
    // P-18 (3.16 review) — atomic seed-with-TTL pattern. SET ... NX EX
    // creates the key with TTL only if absent; INCR then bumps the
    // counter. Replaces the previous "INCR then conditionally EXPIRE on
    // first hit" pattern that could leak the key forever if EXPIRE
    // crashed between the two round-trips. Both calls fire-and-forget;
    // a Redis blip drops one decision metric, never blocks the worker.
    this.redis
      .set(key, '0', 'EX', COUNTER_TTL_SECONDS, 'NX')
      .then(() => this.redis.incr(key))
      .catch(() => {});
  }

  /**
   * Fetch daily dedup-decision counts for a list of YYYY-MM-DD dates.
   * Returns one entry per date with each decision bucket. Empty Map on Redis failure.
   */
  async getDedupDecisionsByDate(
    dates: string[],
  ): Promise<
    Map<
      string,
      Record<
        | 'fresh'
        | 'corroborated_exact'
        | 'corroborated_within_noise'
        | 'conflict_detected'
        | 'duplicate_skipped'
        | 'fuel_set_mismatch',
        number
      >
    >
  > {
    if (dates.length === 0) return new Map();
    const decisions = [
      'fresh',
      'corroborated_exact',
      'corroborated_within_noise',
      'conflict_detected',
      'duplicate_skipped',
      'fuel_set_mismatch',
    ] as const;

    const allKeys = dates.flatMap((d) =>
      decisions.map((decision) => redisKey(`dedup_${decision}`, d)),
    );
    // P-19 (3.16 review) — docstring promises empty Map on Redis failure;
    // wrap mget so a transient outage doesn't bubble through the dashboard.
    let values: (string | null)[];
    try {
      values = await this.redis.mget(allKeys);
    } catch (e: unknown) {
      this.logger.warn(
        `getDedupDecisionsByDate: Redis mget failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return new Map();
    }

    const result = new Map<
      string,
      Record<(typeof decisions)[number], number>
    >();
    let cursor = 0;
    for (const date of dates) {
      const entry: Record<string, number> = {};
      for (const decision of decisions) {
        entry[decision] = parseInt(values[cursor] ?? '0', 10) || 0;
        cursor++;
      }
      result.set(date, entry as Record<(typeof decisions)[number], number>);
    }
    return result;
  }

  /**
   * Fetch daily map-view totals (total + authenticated) for a list of YYYY-MM-DD dates.
   * Returns empty Map on Redis failure — callers handle gracefully.
   */
  async getMapViewsByDate(dates: string[]): Promise<Map<string, { total: number; auth: number }>> {
    if (dates.length === 0) return new Map();

    const totalKeys = dates.map(d => redisKey('map_views', d));
    const authKeys = dates.map(d => redisKey('map_views_auth', d));

    const [totals, auths] = await Promise.all([
      this.redis.mget(totalKeys),
      this.redis.mget(authKeys),
    ]);

    const result = new Map<string, { total: number; auth: number }>();
    dates.forEach((date, i) => {
      result.set(date, {
        total: parseInt(totals[i] ?? '0', 10) || 0,
        auth: parseInt(auths[i] ?? '0', 10) || 0,
      });
    });
    return result;
  }
}
