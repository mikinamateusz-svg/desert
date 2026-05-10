import { Injectable, BadRequestException } from '@nestjs/common';
import { SignalType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Story 4.12 — Admin readouts over the MarketSignal table.
 *
 * Powers the admin Market Signals dashboard so ops can spot ingestion
 * outages (Alpha Vantage rate-limit, NBP downtime, ORLEN scraper
 * breakage, missing API key) without grepping Railway logs.
 */

export type SignalSummary = {
  signalType: SignalType;
  value: number | null;
  pctChange: number | null;
  recordedAt: string | null;
  rateSource: 'live' | 'cached' | null;
};

export type HistoryRow = {
  recordedAt: string;
  value: number;
  pctChange: number | null;
  rateSource: 'live' | 'cached' | null;
  significantMovement: boolean;
};

// Canonical order — matches the dashboard's 2×2 grid layout (ORLEN trio
// then Brent). Stable across calls so the UI doesn't shuffle on refresh.
const ALL_SIGNAL_TYPES: SignalType[] = [
  'orlen_rack_pb95',
  'orlen_rack_on',
  'orlen_rack_lpg',
  'brent_crude_pln',
];

const DEFAULT_HISTORY_LIMIT = 30;
const MAX_HISTORY_LIMIT = 200;

interface LatestRow {
  signal_type: SignalType;
  value: number;
  pct_change: number | null;
  recorded_at: Date;
  rate_source: string | null;
}

@Injectable()
export class AdminMarketSignalsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Latest sample per signal type (one row per type, even types with no
   * data — null fields drive AC5's "Not configured" Brent state).
   */
  async getSummary(): Promise<SignalSummary[]> {
    // DISTINCT ON returns the latest row per signal_type in a single
    // round-trip. The @@index([signal_type, recorded_at]) on MarketSignal
    // makes this cheap even at millions of rows.
    const rows = await this.prisma.$queryRaw<LatestRow[]>`
      SELECT DISTINCT ON (signal_type)
        signal_type, value, pct_change, recorded_at, rate_source
      FROM "MarketSignal"
      ORDER BY signal_type, recorded_at DESC
    `;
    const byType = new Map(rows.map((r) => [r.signal_type, r]));

    return ALL_SIGNAL_TYPES.map((type) => {
      const r = byType.get(type);
      // rate_source is only meaningful for brent_crude_pln; always null
      // for ORLEN rack rows (no rate translation involved).
      const rateSource = type === 'brent_crude_pln' ? normalizeRateSource(r?.rate_source) : null;
      return {
        signalType: type,
        value: r?.value ?? null,
        pctChange: r?.pct_change ?? null,
        recordedAt: r?.recorded_at?.toISOString() ?? null,
        rateSource,
      };
    });
  }

  /**
   * Last N samples for one signal type (newest first). Limit clamped to
   * [1, MAX_HISTORY_LIMIT] so an admin can't accidentally pull a
   * million-row scan via a curl with `?limit=999999`.
   */
  async getHistory(signalType: string, limit: number): Promise<HistoryRow[]> {
    if (!ALL_SIGNAL_TYPES.includes(signalType as SignalType)) {
      throw new BadRequestException(`Unknown signalType: ${signalType}`);
    }
    const safeLimit = Math.min(Math.max(Number(limit) || DEFAULT_HISTORY_LIMIT, 1), MAX_HISTORY_LIMIT);
    const rows = await this.prisma.marketSignal.findMany({
      where: { signal_type: signalType as SignalType },
      orderBy: { recorded_at: 'desc' },
      take: safeLimit,
      select: {
        value: true,
        pct_change: true,
        recorded_at: true,
        rate_source: true,
        significant_movement: true,
      },
    });
    return rows.map((r) => ({
      recordedAt: r.recorded_at.toISOString(),
      value: r.value,
      pctChange: r.pct_change,
      rateSource: normalizeRateSource(r.rate_source),
      significantMovement: r.significant_movement,
    }));
  }
}

function normalizeRateSource(raw: string | null | undefined): 'live' | 'cached' | null {
  // Schema column is open `String?`; UI types only know 'live' | 'cached'.
  // Map unknown values to null rather than letting them leak through, so a
  // future writer that sets e.g. 'fallback' doesn't crash the React render.
  return raw === 'live' || raw === 'cached' ? raw : null;
}
