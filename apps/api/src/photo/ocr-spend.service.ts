import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module.js';

// Claude Haiku 4.5 pricing (USD per million tokens) — update if Anthropic changes rates.
const COST_PER_INPUT_MTOKEN_USD = 0.80;
const COST_PER_OUTPUT_MTOKEN_USD = 4.00;

@Injectable()
export class OcrSpendService {
  private readonly logger = new Logger(OcrSpendService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {}

  /** Compute cost in USD for a single Claude API call. */
  computeCostUsd(inputTokens: number, outputTokens: number): number {
    return (inputTokens / 1_000_000) * COST_PER_INPUT_MTOKEN_USD +
      (outputTokens / 1_000_000) * COST_PER_OUTPUT_MTOKEN_USD;
  }

  /**
   * Atomically increments the daily spend counter and returns the new total.
   * Key: `ocr:spend:{UTC_DATE}` — TTL 48h for automatic cleanup.
   */
  async recordSpend(costUsd: number): Promise<number> {
    const key = this.getSpendKey();
    const newTotal = await this.redis.incrbyfloat(key, costUsd);
    // Set TTL only if not already set (expire returns 1 on success, 0 if key doesn't exist — but
    // incrbyfloat creates the key if absent, so TTL is safe to set every call idempotently)
    await this.redis.expire(key, 48 * 3600);
    const total = parseFloat(newTotal as unknown as string);
    this.logger.debug(`OCR daily spend: $${total.toFixed(4)} (added $${costUsd.toFixed(4)})`);
    return total;
  }

  /** Returns cumulative spend for the current UTC day in USD. */
  async getDailySpend(): Promise<number> {
    const val = await this.redis.get(this.getSpendKey());
    return val ? parseFloat(val) : 0;
  }

  /** Returns the configured daily spend cap in USD (default: $20). */
  getSpendCap(): number {
    const raw = this.config.get<string>('MAX_DAILY_OCR_SPEND_USD', '20');
    return parseFloat(raw);
  }

  private getSpendKey(): string {
    const utcDate = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
    return `ocr:spend:${utcDate}`;
  }
}
