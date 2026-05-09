import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import type { MovementRecord } from './types.js';

const ALPHA_VANTAGE_URL = 'https://www.alphavantage.co/query?function=BRENT&interval=daily';
const NBP_URL = 'https://api.nbp.pl/api/exchangerates/rates/A/USD/?format=json';
const FETCH_TIMEOUT_MS = 10_000;

const NBP_REDIS_KEY = 'market:nbp:usd_pln';
const NBP_TTL_SECONDS = 24 * 3600;

// 1 barrel = 158.987 litres (standard petroleum barrel).
const BARRELS_TO_LITRES = 158.987;

// Plausibility ranges — guard against API regressions silently feeding
// nonsense into the alert pipeline. Brent at $300+/bbl or USD/PLN at
// 20+ both indicate a parser bug, not a real market move.
const BRENT_USD_MIN = 0;
const BRENT_USD_MAX = 300;
const NBP_RATE_MIN = 0;
const NBP_RATE_MAX = 20;

const SIGNIFICANT_MOVEMENT_THRESHOLD = 0.03; // 3% — matches OrlenIngestionService

interface AlphaVantageResponse {
  name?: string;
  data?: Array<{ date: string; value: string }>;
}

interface NbpResponse {
  table?: string;
  currency?: string;
  code?: string;
  rates?: Array<{ no: string; effectiveDate: string; mid: number }>;
}

interface NbpRateResult {
  rate: number;
  source: 'live' | 'cached';
}

/**
 * Story 6.0 — Brent crude PLN/litre signal ingestion.
 *
 * Augments the existing ORLEN rack ingestion with an upstream early-
 * warning signal: a 3%+ move in Brent crude (translated to PLN/litre via
 * the NBP USD/PLN rate) typically precedes pump-price moves by 1-2 weeks.
 * Story 6.3's PredictiveRiseAlertWorker consumes the resulting
 * price-rise-signal events.
 *
 * AC1: Alpha Vantage (Brent USD/bbl) + NBP (USD/PLN) every run; persist
 *      brent_crude_pln signal with rate_source 'live'.
 * AC2: NBP unavailable → use cached rate from Redis (24h TTL); persist
 *      with rate_source 'cached'. No cache → skip Brent entirely (warn).
 * AC3: Alpha Vantage unavailable → log [OPS-ALERT], throw — caller's
 *      try/catch swallows so ORLEN ingestion completes normally.
 *
 * The service is also defensive against ALPHA_VANTAGE_API_KEY missing
 * from the environment: returns null without attempting a fetch so the
 * code can ship to dev/staging without provisioning the key.
 */
@Injectable()
export class BrentIngestionService {
  private readonly logger = new Logger(BrentIngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Orchestrates the full Brent ingestion run. Returns a MovementRecord
   * when a signal was persisted (even if the rate came from cache);
   * returns null when ingestion was skipped (no API key, NBP unavailable
   * AND no cache, etc.). Throws only on Alpha Vantage parse failures so
   * the worker's outer try/catch tags AC3's [OPS-ALERT].
   */
  async ingest(): Promise<MovementRecord | null> {
    const apiKey = this.config.get<string>('ALPHA_VANTAGE_API_KEY');
    if (!apiKey) {
      // Tag with [OPS-ALERT] in production so a missing key surfaces in
      // log dashboards. Acceptable to silently no-op in dev/staging.
      const isProd = this.config.get<string>('NODE_ENV') === 'production';
      const tag = isProd ? '[OPS-ALERT] ' : '';
      this.logger.warn(
        `${tag}Brent ingestion skipped — ALPHA_VANTAGE_API_KEY not set` +
          (isProd ? '' : ' (acceptable in dev/staging)'),
      );
      return null;
    }

    const brent = await this.fetchBrentUsd(apiKey);
    if (brent === null) {
      // fetchBrentUsd already logged the failure mode; treat as soft skip
      // so a transient Alpha Vantage outage doesn't fail the worker job.
      this.logger.warn('[OPS-ALERT] Brent USD/bbl unavailable — skipping run');
      return null;
    }
    const { value: usdPerBbl, date: brentDate } = brent;

    const nbp = await this.fetchNbpRate();
    if (nbp === null) {
      this.logger.warn(
        '[OPS-ALERT] Brent ingestion skipped — NBP USD/PLN unavailable and no cached rate',
      );
      return null;
    }

    const plnPerLitre = (usdPerBbl * nbp.rate) / BARRELS_TO_LITRES;

    // Compute pct_change vs the previous brent_crude_pln signal, if any.
    const previous = await this.prisma.marketSignal.findFirst({
      where: { signal_type: 'brent_crude_pln' },
      orderBy: { recorded_at: 'desc' },
    });

    // Brent dedup: Alpha Vantage's BRENT endpoint returns daily bars
    // (no intraday). The cron fires twice a day, so the second run on
    // any given day sees the same `latest.date` as the first. Persisting
    // a duplicate would write pct_change = 0 (vs identical previous
    // value), masking a genuine next-day move — and the publisher would
    // never see a 3% threshold cross because the baseline was overwritten.
    if (previous && this.isSameBrentBar(previous.recorded_at, brentDate)) {
      this.logger.log(
        `Brent already ingested for bar dated ${brentDate} — skipping duplicate`,
      );
      return null;
    }
    const pctChange =
      previous !== null && previous.value !== 0
        ? (plnPerLitre - previous.value) / previous.value
        : null;
    const significantMovement =
      pctChange !== null && Math.abs(pctChange) >= SIGNIFICANT_MOVEMENT_THRESHOLD;

    const created = await this.prisma.marketSignal.create({
      data: {
        signal_type: 'brent_crude_pln',
        value: plnPerLitre,
        pct_change: pctChange,
        significant_movement: significantMovement,
        rate_source: nbp.source,
      },
    });

    this.logger.log(
      `Brent crude ingested — ${usdPerBbl.toFixed(2)} USD/bbl × ` +
        `${nbp.rate.toFixed(4)} PLN/USD (${nbp.source}) = ` +
        `${plnPerLitre.toFixed(4)} PLN/l` +
        (pctChange !== null ? ` (${(pctChange * 100).toFixed(2)}% vs prev)` : ' (first sample)'),
    );

    return {
      signalType: 'brent_crude_pln',
      pctChange,
      significantMovement,
      recordedAt: created.recorded_at,
    };
  }

  /**
   * Fetches the latest Brent USD/bbl bar from Alpha Vantage along with
   * its bar date for dedup. Returns null on any failure — caller decides
   * whether to log [OPS-ALERT]. The bar date is the YYYY-MM-DD string
   * Alpha Vantage publishes; the dedup compares against the previous
   * MarketSignal.recorded_at's UTC date.
   */
  async fetchBrentUsd(apiKey: string): Promise<{ value: number; date: string } | null> {
    try {
      const response = await fetch(`${ALPHA_VANTAGE_URL}&apikey=${apiKey}`, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        this.logger.warn(`Alpha Vantage returned HTTP ${response.status}`);
        return null;
      }
      const body = (await response.json()) as AlphaVantageResponse & {
        Note?: string;
        Information?: string;
      };
      // Alpha Vantage's free tier returns rate-limit responses as HTTP
      // 200 with a `Note` or `Information` field instead of `data`. Tag
      // these as [OPS-ALERT] so quota exhaustion doesn't look like a
      // generic upstream outage.
      if (body.Note || body.Information) {
        this.logger.warn(
          `[OPS-ALERT] Alpha Vantage rate-limited / informational response: ` +
            `${body.Note ?? body.Information}`,
        );
        return null;
      }
      // Don't blindly trust `data[0]` — sort by date desc so a returned
      // ascending array doesn't silently feed us a stale bar.
      const data = body.data ?? [];
      const sorted = [...data].sort((a, b) => b.date.localeCompare(a.date));
      const latest = sorted[0];
      // Alpha Vantage returns "." (single dot) for missing/holiday values.
      if (!latest || latest.value === '.' || latest.value === '') {
        this.logger.warn('Alpha Vantage response missing latest data point');
        return null;
      }
      const val = parseFloat(latest.value);
      if (!Number.isFinite(val) || val <= BRENT_USD_MIN || val > BRENT_USD_MAX) {
        this.logger.warn(
          `Alpha Vantage value ${latest.value} outside plausible range [${BRENT_USD_MIN}, ${BRENT_USD_MAX}]`,
        );
        return null;
      }
      return { value: val, date: latest.date };
    } catch (err) {
      this.logger.warn(
        `Alpha Vantage fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /**
   * Bar-date equality: compare YYYY-MM-DD components only (UTC). Avoids
   * a same-bar duplicate when the cron fires twice on the same day and
   * Alpha Vantage hasn't published a new daily bar in between.
   */
  private isSameBrentBar(previousRecordedAt: Date, latestBarDate: string): boolean {
    const prevDay = previousRecordedAt.toISOString().slice(0, 10);
    return prevDay === latestBarDate;
  }

  /**
   * Fetches the NBP USD/PLN rate. On success, caches it in Redis with a
   * 24h TTL so subsequent runs survive transient NBP outages. On failure,
   * tries the cache. Returns null only when both the live fetch and the
   * cache are unavailable — that's the AC2 "skip Brent entirely" branch.
   */
  async fetchNbpRate(): Promise<NbpRateResult | null> {
    try {
      const response = await fetch(NBP_URL, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (response.ok) {
        const body = (await response.json()) as NbpResponse;
        const rate = body.rates?.[0]?.mid;
        if (rate !== undefined && Number.isFinite(rate) && rate > NBP_RATE_MIN && rate <= NBP_RATE_MAX) {
          // Best-effort cache write. A Redis write failure doesn't void
          // the live fetch — we still return the freshly-fetched rate.
          try {
            await this.redis.set(NBP_REDIS_KEY, rate.toString(), 'EX', NBP_TTL_SECONDS);
          } catch (e) {
            this.logger.warn(
              `Failed to cache NBP rate: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
          return { rate, source: 'live' };
        }
        this.logger.warn(`NBP response value out of range: ${String(rate)}`);
      } else {
        this.logger.warn(`NBP returned HTTP ${response.status}`);
      }
    } catch (err) {
      this.logger.warn(
        `NBP fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Live fetch failed — try cache. Returns null when cache is also empty.
    try {
      const cached = await this.redis.get(NBP_REDIS_KEY);
      if (cached !== null) {
        const rate = parseFloat(cached);
        if (Number.isFinite(rate) && rate > NBP_RATE_MIN && rate <= NBP_RATE_MAX) {
          this.logger.log(`Using cached NBP rate ${rate.toFixed(4)} PLN/USD`);
          return { rate, source: 'cached' };
        }
        this.logger.warn(`Cached NBP rate out of range: ${cached}`);
      }
    } catch (err) {
      this.logger.warn(
        `Failed to read cached NBP rate: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return null;
  }
}
