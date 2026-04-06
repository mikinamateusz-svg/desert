import { Injectable, Inject } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module.js';

const COUNTER_TTL_SECONDS = 33 * 24 * 60 * 60; // 33 days — covers 30d period + 3d buffer

function redisKey(prefix: string, date: string): string {
  return `metrics:${prefix}:${date.replace(/-/g, '')}`; // e.g. metrics:map_views:20260406
}

@Injectable()
export class MetricsCounterService {
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
