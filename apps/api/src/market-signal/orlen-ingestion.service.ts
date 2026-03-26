import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';

const SIGNIFICANT_MOVEMENT_THRESHOLD = 0.03; // 3%
const FETCH_TIMEOUT_MS = 15_000;
// Plausibility bounds for converted PLN/litre value (P2)
const PLN_PER_LITRE_MIN = 0.3;
const PLN_PER_LITRE_MAX = 15.0;

export interface RackPrices {
  pb95: number; // PLN/litre
  on: number;
  lpg: number;
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
 * Ingests ORLEN rack prices from their public wholesale price page.
 *
 * ORLEN publishes prices at ORLEN_RACK_PRICE_URL in a table where rows
 * contain fuel names and prices in PLN/1000L. Known fuel labels:
 *   "Eurosuper 95" → PB95
 *   "Ekodiesel"    → ON
 *   "Autogas"      → LPG
 *
 * NOTE: The parser targets the current ORLEN page structure and may require
 * maintenance if ORLEN changes their site layout.
 *
 * NOTE: pct_change is stored as a fraction (0.03 = 3%), not a percentage.
 * Story 2.8 (staleness detection) must read it accordingly.
 */
@Injectable()
export class OrlenIngestionService {
  private readonly logger = new Logger(OrlenIngestionService.name);
  private readonly orlenUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.orlenUrl = this.config.getOrThrow<string>('ORLEN_RACK_PRICE_URL');
  }

  async ingest(): Promise<void> {
    const html = await this.fetchPage();
    const prices = this.parsePrices(html);
    await this.storeSignals(prices);
  }

  async fetchPage(): Promise<string> {
    const response = await fetch(this.orlenUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DesertPriceBot/1.0)' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`ORLEN page returned HTTP ${response.status} ${response.statusText}`);
    }
    return response.text();
  }

  /**
   * Parses ORLEN rack prices from the page HTML.
   * ORLEN publishes prices in PLN/1000L; this method converts to PLN/litre.
   *
   * The parser locates each fuel label via exec() to get the exact match length
   * (P1: fixes the source.length offset bug for patterns with \s*), then extracts
   * the first decimal number that follows. ORLEN uses a comma decimal separator and
   * may use spaces as a thousands separator (e.g. "1 456,78").
   */
  parsePrices(html: string): RackPrices {
    const extractPrice = (fuelPattern: RegExp): number => {
      // P1: use exec() to get the actual matched length, not the regex source length.
      // For /Eurosuper\s*95/i, source.length = 14 but the matched text "Eurosuper 95"
      // is only 12 chars — using source.length would slice into the label itself.
      const nameMatch = fuelPattern.exec(html);
      if (!nameMatch) {
        throw new Error(`Cannot find "${fuelPattern}" in ORLEN page`);
      }
      const slice = html.slice(nameMatch.index + nameMatch[0].length);

      // P2: restrict to digits and spaces (thousands sep) only — no cross-field greediness
      const match = slice.match(/\d[\d ]*(?:[,.]\d+)?/);
      if (!match) {
        throw new Error(`Cannot parse price after "${fuelPattern}" in ORLEN page`);
      }
      // Normalise: remove spaces (thousands sep), comma → decimal point
      const raw = match[0].trim().replace(/ /g, '').replace(',', '.');
      const perThousandLitre = parseFloat(raw);
      if (isNaN(perThousandLitre) || perThousandLitre <= 0) {
        throw new Error(`Invalid price value "${raw}" for "${fuelPattern}"`);
      }
      const plnPerLitre = perThousandLitre / 1000;

      // P2: plausibility range — catches misparsed values (e.g. a stray date digit)
      if (plnPerLitre < PLN_PER_LITRE_MIN || plnPerLitre > PLN_PER_LITRE_MAX) {
        throw new Error(
          `Price ${plnPerLitre.toFixed(4)} PLN/l is outside plausible range ` +
          `[${PLN_PER_LITRE_MIN}–${PLN_PER_LITRE_MAX}] for "${fuelPattern}"`,
        );
      }
      return plnPerLitre;
    };

    return {
      pb95: extractPrice(/Eurosuper\s*95/i),
      on:   extractPrice(/Ekodiesel/i),
      lpg:  extractPrice(/Autogas/i),
    };
  }

  private async storeSignals(prices: RackPrices): Promise<void> {
    const entries: SignalEntry[] = [
      { type: 'orlen_rack_pb95', value: prices.pb95 },
      { type: 'orlen_rack_on',   value: prices.on },
      { type: 'orlen_rack_lpg',  value: prices.lpg },
    ];

    // P3: read all previous signals in parallel first, then batch-create atomically.
    // Sequential findFirst+create pairs risked partial writes (e.g. pb95 committed,
    // on/lpg not) if the process died mid-loop.
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
      // P4: guard against previous.value === 0 (corrupt historical row) which would
      // produce Infinity — treat as first ingestion instead.
      const pctChange =
        previous !== null && previous.value !== 0
          ? (value - previous.value) / previous.value  // fraction; 0.03 = 3%
          : null;
      const significantMovement =
        pctChange !== null && Math.abs(pctChange) >= SIGNIFICANT_MOVEMENT_THRESHOLD;
      return { type, value, pctChange, significantMovement, previous };
    });

    // P3: all-or-nothing write — three signals from the same run land together
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
