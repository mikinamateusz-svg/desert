import { Injectable, Inject, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module.js';

export interface StationPriceRow {
  stationId: string;
  prices: Record<string, number>;
  updatedAt: Date;
  source: 'community' | 'seeded';
}

const KEY_PREFIX = 'price:station:';
const PRICE_TTL_SECONDS = 86400; // 24 hours — safety fallback, primary freshness via invalidation

@Injectable()
export class PriceCacheService {
  private readonly logger = new Logger(PriceCacheService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Bulk-fetch cached prices for the given station IDs.
   * Returns a Map<stationId, StationPriceRow | null> — null means cache miss.
   * Throws if Redis is unavailable (caller handles fallback).
   * Corrupt entries are treated as misses and invalidated — they never poison the fallback path.
   */
  async getMany(stationIds: string[]): Promise<Map<string, StationPriceRow | null>> {
    if (stationIds.length === 0) return new Map(); // P2: guard against empty MGET (Redis rejects 0-arg MGET)

    const keys = stationIds.map(id => `${KEY_PREFIX}${id}`);
    const values = await this.redis.mget(keys);

    const map = new Map<string, StationPriceRow | null>();
    stationIds.forEach((id, i) => {
      const raw = values[i];
      if (!raw) {
        map.set(id, null);
        return;
      }
      try {
        map.set(id, this.deserialize(raw)); // P1: per-entry try/catch — bad JSON is a miss, not a crash
      } catch {
        this.logger.warn(`Corrupt cache entry for station ${id} — invalidating`);
        this.redis.del(`${KEY_PREFIX}${id}`).catch(() => {}); // fire-and-forget invalidation
        map.set(id, null);
      }
    });
    return map;
  }

  /**
   * Write a station price to Redis with 24h TTL.
   * Used after a DB miss to populate the cache.
   * Errors are swallowed — cache write failure must not affect the response.
   */
  async set(stationId: string, data: StationPriceRow): Promise<void> {
    try {
      await this.redis.setex(`${KEY_PREFIX}${stationId}`, PRICE_TTL_SECONDS, this.serialize(data));
    } catch (err) {
      this.logger.warn(`Cache set failed for station ${stationId}`, err);
    }
  }

  /**
   * Atomically invalidate and rewrite the cache for a station.
   * Used when a price is verified — ensures no stale data is ever served (AC3).
   * MULTI: DEL → SETEX executed as a single Redis transaction.
   */
  async setAtomic(stationId: string, data: StationPriceRow): Promise<void> {
    const key = `${KEY_PREFIX}${stationId}`;
    await this.redis
      .multi()
      .del(key)
      .setex(key, PRICE_TTL_SECONDS, this.serialize(data))
      .exec();
  }

  /**
   * Delete a station's cached price (without rewriting).
   * The next request will fetch fresh data from the DB.
   */
  async invalidate(stationId: string): Promise<void> {
    await this.redis.del(`${KEY_PREFIX}${stationId}`);
  }

  private serialize(data: StationPriceRow): string {
    return JSON.stringify({
      ...data,
      updatedAt: data.updatedAt instanceof Date ? data.updatedAt.toISOString() : data.updatedAt,
    });
  }

  private deserialize(raw: string): StationPriceRow {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      stationId: parsed.stationId as string,
      prices: parsed.prices as Record<string, number>,
      updatedAt: new Date(parsed.updatedAt as string),
      source: parsed.source as 'community' | 'seeded',
    };
  }
}
