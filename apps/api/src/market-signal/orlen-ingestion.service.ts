import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

const SIGNIFICANT_MOVEMENT_THRESHOLD = 0.03; // 3%
const FETCH_TIMEOUT_MS = 15_000;
const PLN_PER_LITRE_MIN = 0.3;
const PLN_PER_LITRE_MAX = 15.0;

/**
 * ORLEN JSON API endpoints — replaces the former HTML scraper.
 * ORLEN migrated their public price page to a JS-rendered SPA; the canonical
 * data source is now the tool.orlen.pl REST API.
 */
const ORLEN_WHOLESALE_URL  = 'https://tool.orlen.pl/api/wholesalefuelprices';
const ORLEN_AUTOGAS_URL    = 'https://tool.orlen.pl/api/autogasprices';
const PRODUCT_PB95         = 'Pb95';
const PRODUCT_ON           = 'ONEkodiesel';

export interface RackPrices {
  pb95: number; // PLN/litre
  on:   number;
  lpg:  number;
}

/** Shape of one item in the wholesalefuelprices response */
interface OrlenWholesaleItem {
  productName:   string;
  effectiveDate: string;
  value:         number; // PLN/1000L
}

/** Shape of one item in the autogasprices response (per-voivodeship, PLN/litre) */
interface OrlenAutogasItem {
  value: number; // PLN/litre
}

type SignalEntry = {
  type: 'orlen_rack_pb95' | 'orlen_rack_on' | 'orlen_rack_lpg';
  value: number;
};

type SignalRecord = SignalEntry & {
  pctChange: number | null;         // fraction: 0.03 = 3% — NOT a percentage
  significantMovement: boolean;
  previous: { value: number } | null;
};

/**
 * Ingests ORLEN rack prices from their public JSON API.
 *
 * ORLEN publishes wholesale fuel prices via tool.orlen.pl:
 *   GET /api/wholesalefuelprices — PB95 + ON in PLN/1000L
 *   GET /api/autogasprices       — LPG per voivodeship in PLN/litre
 *
 * Wholesale prices are divided by 1000 to get PLN/litre.
 * LPG is the mean of all voivodeship prices (range is narrow, ~3–5 gr spread).
 *
 * Product name mapping:
 *   productName "Pb95"       → orlen_rack_pb95
 *   productName "ONEkodiesel" → orlen_rack_on
 *   autogasprices mean        → orlen_rack_lpg
 *
 * NOTE: pct_change is stored as a fraction (0.03 = 3%), not a percentage.
 */
@Injectable()
export class OrlenIngestionService {
  private readonly logger = new Logger(OrlenIngestionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async ingest(): Promise<void> {
    const [wholesale, autogas] = await Promise.all([
      this.fetchJson<OrlenWholesaleItem[]>(ORLEN_WHOLESALE_URL),
      this.fetchJson<OrlenAutogasItem[]>(ORLEN_AUTOGAS_URL),
    ]);
    const prices = this.parsePrices(wholesale, autogas);
    await this.storeSignals(prices);
  }

  /**
   * Parses ORLEN rack prices from the JSON API responses.
   *
   * Wholesale prices are in PLN/1000L and must be divided by 1000.
   * LPG is already PLN/litre — we take the mean across voivodeships.
   */
  parsePrices(wholesale: OrlenWholesaleItem[], autogas: OrlenAutogasItem[]): RackPrices {
    if (!Array.isArray(wholesale)) {
      throw new Error('ORLEN wholesale API returned unexpected shape (expected array)');
    }
    if (!Array.isArray(autogas)) {
      throw new Error('ORLEN autogas API returned unexpected shape (expected array)');
    }

    const findWholesale = (productName: string): number => {
      const item = wholesale.find(i => i.productName === productName);
      if (!item) {
        throw new Error(`Cannot find "${productName}" in ORLEN wholesale data`);
      }
      const plnPerLitre = item.value / 1000;
      if (plnPerLitre < PLN_PER_LITRE_MIN || plnPerLitre > PLN_PER_LITRE_MAX) {
        throw new Error(
          `Price ${plnPerLitre.toFixed(4)} PLN/l is outside plausible range ` +
          `[${PLN_PER_LITRE_MIN}–${PLN_PER_LITRE_MAX}] for "${productName}"`,
        );
      }
      return plnPerLitre;
    };

    const lpgValues = autogas
      .map(i => i.value)
      .filter((v): v is number => typeof v === 'number' && v > 0);
    if (lpgValues.length === 0) {
      throw new Error('Autogas price list is empty or contains no valid values');
    }
    const lpg = lpgValues.reduce((sum, v) => sum + v, 0) / lpgValues.length;
    if (lpg < PLN_PER_LITRE_MIN || lpg > PLN_PER_LITRE_MAX) {
      throw new Error(
        `LPG price ${lpg.toFixed(4)} PLN/l is outside plausible range ` +
        `[${PLN_PER_LITRE_MIN}–${PLN_PER_LITRE_MAX}]`,
      );
    }

    return {
      pb95: findWholesale(PRODUCT_PB95),
      on:   findWholesale(PRODUCT_ON),
      lpg,
    };
  }

  async fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DesertPriceBot/1.0)' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(
        `ORLEN API returned HTTP ${response.status} ${response.statusText} for ${url}`,
      );
    }
    return response.json() as Promise<T>;
  }

  private async storeSignals(prices: RackPrices): Promise<void> {
    const entries: SignalEntry[] = [
      { type: 'orlen_rack_pb95', value: prices.pb95 },
      { type: 'orlen_rack_on',   value: prices.on },
      { type: 'orlen_rack_lpg',  value: prices.lpg },
    ];

    // P3: read all previous signals in parallel first, then batch-create atomically.
    const previousValues = await Promise.all(
      entries.map(({ type }) =>
        this.prisma.marketSignal.findFirst({
          where: { signal_type: type },
          orderBy: { recorded_at: 'desc' },
        }),
      ),
    );

    const records: SignalRecord[] = entries.map(({ type, value }, i) => {
      const previous = previousValues[i];
      // P4: guard against previous.value === 0 (corrupt historical row) → Infinity
      const pctChange =
        previous !== null && previous.value !== 0
          ? (value - previous.value) / previous.value
          : null;
      const significantMovement =
        pctChange !== null && Math.abs(pctChange) >= SIGNIFICANT_MOVEMENT_THRESHOLD;
      return { type, value, pctChange, significantMovement, previous };
    });

    await this.prisma.$transaction(
      records.map(({ type, value, pctChange, significantMovement }) =>
        this.prisma.marketSignal.create({
          data: {
            signal_type:          type,
            value,
            pct_change:           pctChange,
            significant_movement: significantMovement,
          },
        }),
      ),
    );

    for (const { type, value, pctChange, significantMovement, previous } of records) {
      if (significantMovement) {
        this.logger.warn(
          `Significant movement for ${type}: ${(pctChange! * 100).toFixed(2)}% ` +
          `(${previous!.value.toFixed(4)} → ${value.toFixed(4)} PLN/l)`,
        );
      }
    }

    this.logger.log(
      `ORLEN rack prices ingested — PB95: ${prices.pb95.toFixed(4)}, ` +
      `ON: ${prices.on.toFixed(4)}, LPG: ${prices.lpg.toFixed(4)} PLN/l`,
    );
  }
}
