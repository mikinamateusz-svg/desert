import { Injectable, Inject, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module.js';

// Station dedup: 12 hours — prices rarely change more than once a day.
const STATION_DEDUP_WINDOW_SECONDS = 12 * 3600;

// Hash dedup: 24 hours — catches exact duplicate photos submitted twice.
const HASH_DEDUP_TTL_SECONDS = 24 * 3600;

@Injectable()
export class SubmissionDedupService {
  private readonly logger = new Logger(SubmissionDedupService.name);

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
