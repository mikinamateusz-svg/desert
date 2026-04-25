import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import { PrismaService } from '../prisma/prisma.service.js';

// Claude Haiku 4.5 pricing (USD per million tokens) — update if Anthropic changes rates.
const COST_PER_INPUT_MTOKEN_USD = 0.80;
const COST_PER_OUTPUT_MTOKEN_USD = 4.00;

const DEFAULT_COST_ALERT_THRESHOLD_USD = 50;
const MONTHLY_ALERT_TTL_SECONDS = 32 * 24 * 3600;

@Injectable()
export class OcrSpendService {
  private readonly logger = new Logger(OcrSpendService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /** Compute cost in USD for a single Claude API call. */
  computeCostUsd(inputTokens: number, outputTokens: number): number {
    return (inputTokens / 1_000_000) * COST_PER_INPUT_MTOKEN_USD +
      (outputTokens / 1_000_000) * COST_PER_OUTPUT_MTOKEN_USD;
  }

  /**
   * Atomically increments the daily spend counter (Redis, 48h TTL) and
   * persists the daily total to DailyApiCost for historical reporting.
   */
  async recordSpend(costUsd: number): Promise<number> {
    const key = this.getSpendKey();
    const newTotal = await this.redis.incrbyfloat(key, costUsd);
    // EXPIRE is best-effort — a transient Redis blip here must not fail an OCR call
    // whose spend has already been recorded. Worst case the key keeps a stale TTL.
    await this.redis.expire(key, 48 * 3600).catch(e =>
      this.logger.warn(`redis.expire failed: ${e instanceof Error ? e.message : String(e)}`),
    );
    const total = parseFloat(newTotal as unknown as string);
    if (!Number.isFinite(total)) {
      // INCRBYFLOAT corrupted the counter (e.g., stored a non-numeric string) — treat as 0
      // rather than NaN so downstream `total >= cap` checks don't silently bypass the cap.
      this.logger.error(`incrbyfloat returned non-finite value: ${String(newTotal)} — treating as 0`);
      return 0;
    }
    this.logger.debug(`OCR daily spend: $${total.toFixed(4)} (added $${costUsd.toFixed(4)})`);

    // Persist + alert are best-effort: never let them break a successful OCR call.
    void this.persistDailySpend(costUsd).catch(e =>
      this.logger.warn(`persistDailySpend failed: ${e instanceof Error ? e.message : String(e)}`),
    );
    void this.checkMonthlyAlert().catch(e =>
      this.logger.warn(`checkMonthlyAlert failed: ${e instanceof Error ? e.message : String(e)}`),
    );

    return total;
  }

  /** Returns cumulative spend for the current UTC day in USD. */
  async getDailySpend(): Promise<number> {
    const val = await this.redis.get(this.getSpendKey());
    return val ? parseFloat(val) : 0;
  }

  /** Returns the active daily spend cap in USD. Redis override (24h TTL) takes precedence over env var. */
  async getSpendCap(): Promise<number> {
    const override = await this.redis.get('ocr:spend-cap:override').catch(() => null);
    if (override !== null) {
      const val = parseFloat(override);
      if (!isNaN(val) && val > 0) return val;
    }
    const raw = this.config.get<string>('MAX_DAILY_OCR_SPEND_USD', '20');
    const cap = parseFloat(raw);
    return isNaN(cap) ? 20 : cap;
  }

  /** Override the daily spend cap for 24h. Set to null to clear the override. */
  async setSpendCapOverride(capUsd: number | null): Promise<void> {
    if (capUsd === null) {
      await this.redis.del('ocr:spend-cap:override');
      this.logger.log('OCR spend cap override cleared — using env var default');
    } else {
      await this.redis.set('ocr:spend-cap:override', capUsd.toString(), 'EX', 24 * 3600);
      this.logger.log(`OCR spend cap overridden to $${capUsd} for 24h`);
    }
  }

  /** Upserts today's DailyApiCost row. Redis is source of truth for intra-day totals;
   *  this table is for historical reporting beyond Redis's 48h TTL. */
  async persistDailySpend(costUsd: number): Promise<void> {
    const today = this.toUtcDateOnly(new Date());
    await this.prisma.dailyApiCost.upsert({
      where: { date: today },
      create: { date: today, spend_usd: costUsd, image_count: 1 },
      update: {
        spend_usd: { increment: costUsd },
        image_count: { increment: 1 },
      },
    });
  }

  /** Sum of spend_usd for the specified UTC month (month is 1-indexed). */
  async getMonthlySpend(year: number, month: number): Promise<number> {
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 1));
    const rows = await this.prisma.dailyApiCost.findMany({
      where: { date: { gte: start, lt: end } },
      select: { spend_usd: true },
    });
    return rows.reduce((sum, r) => sum + r.spend_usd, 0);
  }

  /**
   * If the current-month spend exceeds COST_ALERT_THRESHOLD_USD (default $50),
   * post a Slack alert and set a Redis dedup flag so we only alert once per month.
   * Gracefully no-ops when SLACK_WEBHOOK_URL is not configured.
   */
  async checkMonthlyAlert(): Promise<void> {
    const url = this.config.get<string>('SLACK_WEBHOOK_URL');
    if (!url || !url.startsWith('https://hooks.slack.com/')) return;

    const now = new Date();
    const yearMonth = now.toISOString().slice(0, 7);
    const flagKey = `ocr:cost_alert:${yearMonth}`;
    const alreadySent = await this.redis.get(flagKey);
    if (alreadySent) return;

    const threshold = this.getCostAlertThreshold();
    const monthlySpend = await this.getMonthlySpend(now.getUTCFullYear(), now.getUTCMonth() + 1);
    if (monthlySpend < threshold) return;

    // Atomic claim BEFORE the network call: two concurrent OCR calls hitting the
    // threshold simultaneously would otherwise both pass the GET above and double-post.
    // SET NX returns 'OK' on success, null if the key already exists (someone beat us).
    const claimed = await this.redis.set(flagKey, '1', 'EX', MONTHLY_ALERT_TTL_SECONDS, 'NX');
    if (claimed !== 'OK') return;

    const dashboardUrl = this.config.get<string>('ADMIN_DASHBOARD_URL', '');
    const link = dashboardUrl ? ` ${dashboardUrl}/metrics` : '';
    const body = {
      text: `[COST-ALERT] Claude API monthly spend $${monthlySpend.toFixed(2)} exceeded threshold $${threshold.toFixed(2)}.${link}`,
    };

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
    } catch (e) {
      // Network error / timeout — release the claim so the next OCR call can retry.
      await this.redis.del(flagKey).catch(() => {});
      this.logger.warn(`Slack alert POST failed: ${e instanceof Error ? e.message : String(e)} — releasing dedup flag.`);
      return;
    }

    // 4xx/5xx means the webhook rejected us — release the claim and let the next call retry,
    // rather than muting future alerts for 32 days.
    if (!res.ok) {
      await this.redis.del(flagKey).catch(() => {});
      this.logger.warn(`Slack alert POST returned ${res.status} — releasing dedup flag so the next call retries.`);
      return;
    }

    this.logger.warn(`Monthly cost alert sent for ${yearMonth}: $${monthlySpend.toFixed(2)} over $${threshold.toFixed(2)}`);
  }

  private getCostAlertThreshold(): number {
    const raw = this.config.get<string>('COST_ALERT_THRESHOLD_USD', String(DEFAULT_COST_ALERT_THRESHOLD_USD));
    // Use Number() (strict parsing) instead of parseFloat() — parseFloat('5dollars') silently
    // returns 5, masking misconfig. Number('5dollars') returns NaN. Number.isFinite rejects
    // both NaN and Infinity, so a misconfigured value falls back rather than disabling alerts
    // (Infinity threshold) or accepting partial-numeric strings.
    const val = Number(raw);
    if (!Number.isFinite(val) || val <= 0) {
      if (raw !== String(DEFAULT_COST_ALERT_THRESHOLD_USD)) {
        this.logger.warn(
          `COST_ALERT_THRESHOLD_USD="${raw}" is not a positive finite number — falling back to $${DEFAULT_COST_ALERT_THRESHOLD_USD}`,
        );
      }
      return DEFAULT_COST_ALERT_THRESHOLD_USD;
    }
    return val;
  }

  private toUtcDateOnly(d: Date): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }

  private getSpendKey(): string {
    const utcDate = new Date().toISOString().slice(0, 10);
    return `ocr:spend:${utcDate}`;
  }
}
