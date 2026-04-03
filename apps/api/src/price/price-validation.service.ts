import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ExtractedPrice } from '../ocr/ocr.service.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface ValidatedPrice extends ExtractedPrice {
  tier: 1 | 3; // Tier 2 (regional benchmark) deferred to Story 5.0
}

export interface InvalidPrice extends ExtractedPrice {
  reason: string;
}

export interface PriceValidationOutput {
  valid: ValidatedPrice[];
  invalid: InvalidPrice[];
}

// ── Constants ───────────────────────────────────────────────────────────────

/**
 * Tier 3 absolute fallback bands (PLN/litre).
 * Source: Epic 3.7 AC3. These are market-calibrated bounds used when no
 * recent price history exists for a station × fuel-type pair.
 *
 * Story 3.5's PRICE_BANDS (in ocr.service.ts) are a broader pre-filter used
 * during OCR to catch hallucinated values; these Tier 3 bands are the
 * authoritative validation ranges for the pipeline.
 */
export const ABSOLUTE_BANDS: Record<string, { min: number; max: number }> = {
  PB_95: { min: 4.0, max: 12.0 },
  PB_98: { min: 4.5, max: 13.0 },
  ON: { min: 4.0, max: 12.0 },
  ON_PREMIUM: { min: 4.5, max: 13.0 },
  LPG: { min: 1.5, max: 5.0 },
  AdBlue: { min: 3.0, max: 15.0 },
};

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// ── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class PriceValidationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Validates extracted prices against a 3-tier hierarchy:
   *   Tier 1: ±20% of last known price (last 30 days) for that station × fuel_type
   *   Tier 2: regional voivodeship average — DEFERRED to Story 5.0; skipped here
   *   Tier 3: absolute fallback range (ABSOLUTE_BANDS)
   *
   * Deduplicates fuel types before validation — first occurrence wins.
   */
  async validatePrices(
    stationId: string,
    prices: ExtractedPrice[],
  ): Promise<PriceValidationOutput> {
    const deduplicated = this.deduplicate(prices);

    if (deduplicated.length === 0) {
      return { valid: [], invalid: [] };
    }

    const fuelTypes = deduplicated.map(p => p.fuel_type);
    const recentPrices = await this.fetchRecentPrices(stationId, fuelTypes);

    const valid: ValidatedPrice[] = [];
    const invalid: InvalidPrice[] = [];

    for (const price of deduplicated) {
      const recent = recentPrices.get(price.fuel_type);

      if (recent !== undefined) {
        // Tier 1: ±20% of the last known price
        const min = recent * 0.8;
        const max = recent * 1.2;
        if (price.price_per_litre >= min && price.price_per_litre <= max) {
          valid.push({ ...price, tier: 1 });
        } else {
          invalid.push({
            ...price,
            reason: `tier1_out_of_band: ${min.toFixed(2)}–${max.toFixed(2)}`,
          });
        }
      } else {
        // Tier 3: absolute fallback (Tier 2 skipped until Story 5.0)
        const band = ABSOLUTE_BANDS[price.fuel_type];
        if (band && price.price_per_litre >= band.min && price.price_per_litre <= band.max) {
          valid.push({ ...price, tier: 3 });
        } else {
          invalid.push({
            ...price,
            reason: band
              ? `tier3_out_of_range: ${band.min}–${band.max}`
              : 'tier3_unknown_fuel_type',
          });
        }
      }
    }

    return { valid, invalid };
  }

  // ── Private ─────────────────────────────────────────────────────────────

  /**
   * Fetches the most recent price per fuel type within the last 30 days
   * for the given station. Uses DISTINCT ON for efficiency.
   */
  private async fetchRecentPrices(
    stationId: string,
    fuelTypes: string[],
  ): Promise<Map<string, number>> {
    if (fuelTypes.length === 0) return new Map();

    const since = new Date(Date.now() - THIRTY_DAYS_MS);

    const rows = await this.prisma.$queryRaw<{ fuel_type: string; price: number }[]>(
      Prisma.sql`
        SELECT DISTINCT ON (fuel_type) fuel_type, price
        FROM "PriceHistory"
        WHERE station_id = ${stationId}
          AND fuel_type IN (${Prisma.join(fuelTypes)})
          AND recorded_at >= ${since}
        ORDER BY fuel_type, recorded_at DESC
      `,
    );

    return new Map(rows.map(r => [r.fuel_type, r.price]));
  }

  /** Deduplicates by fuel_type — first occurrence wins. */
  private deduplicate(prices: ExtractedPrice[]): ExtractedPrice[] {
    const seen = new Set<string>();
    return prices.filter(p => {
      if (seen.has(p.fuel_type)) return false;
      seen.add(p.fuel_type);
      return true;
    });
  }
}
