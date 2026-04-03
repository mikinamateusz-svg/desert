import { Injectable, Inject } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module.js';

// Station dedup: 12 hours — prices rarely change more than once a day.
const STATION_DEDUP_WINDOW_SECONDS = 12 * 3600;

// Hash dedup: 24 hours — catches exact duplicate photos submitted twice.
const HASH_DEDUP_TTL_SECONDS = 24 * 3600;

@Injectable()
export class SubmissionDedupService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** Compute SHA-256 hex digest of a photo buffer. */
  static computePhotoHash(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Returns true if a verified OCR result for this station was recorded within the last 12 hours.
   * Key: `dedup:station:{stationId}`
   */
  async checkStationDedup(stationId: string): Promise<boolean> {
    const val = await this.redis.get(`dedup:station:${stationId}`);
    return val !== null;
  }

  /**
   * Records a successful OCR result for this station with a 12-hour TTL.
   * Uses SET key 1 EX ttl (SETEX is deprecated in Redis 7+).
   */
  async recordStationDedup(stationId: string): Promise<void> {
    await this.redis.set(`dedup:station:${stationId}`, '1', 'EX', STATION_DEDUP_WINDOW_SECONDS);
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
}
