import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { StationPriceRow } from './price-cache.service.js';
import {
  VOIVODESHIP_MARGINS_GR,
  DEFAULT_MARGIN_GR,
  STATION_TYPE_MODIFIERS_GR,
  BRAND_MODIFIERS_GR,
  DEFAULT_BRAND_MODIFIER_GR,
  BORDER_ZONE_MODIFIER_GR,
  SETTLEMENT_TIER_MODIFIERS_GR,
  BAND_RADIUS_GR,
  FALLBACK_BAND_PCT,
  NATIONAL_FALLBACK_PRICES_PLN,
  ESTIMABLE_FUEL_TYPES,
} from './config/price-modifiers.js';

// Signal types that map to estimable fuel types
const FUEL_TYPE_TO_SIGNAL: Record<string, string> = {
  PB_95: 'orlen_rack_pb95',
  ON:    'orlen_rack_on',
  LPG:   'orlen_rack_lpg',
};

export interface StationClassificationRow {
  id: string;
  name: string;
  brand: string | null;
  station_type: 'standard' | 'mop' | null;
  voivodeship: string | null;
  settlement_tier: 'metropolitan' | 'city' | 'town' | 'rural' | null;
  is_border_zone_de: boolean;
}

@Injectable()
export class EstimatedPriceService {
  private readonly logger = new Logger(EstimatedPriceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fetches the latest rack price for each estimable fuel type from MarketSignal.
   * Returns a Map<fuelType, pricePln>. Missing entries mean no rack data available.
   */
  async getLatestRackPrices(): Promise<Map<string, number>> {
    const signals = await this.prisma.$queryRaw<{ signal_type: string; value: number }[]>`
      SELECT DISTINCT ON (signal_type) signal_type, value
      FROM "MarketSignal"
      WHERE signal_type IN ('orlen_rack_pb95', 'orlen_rack_on', 'orlen_rack_lpg')
      ORDER BY signal_type, recorded_at DESC
    `;

    const map = new Map<string, number>();
    for (const row of signals) {
      const fuelType = Object.entries(FUEL_TYPE_TO_SIGNAL).find(
        ([, sig]) => sig === row.signal_type,
      )?.[0];
      if (fuelType) map.set(fuelType, row.value);
    }
    return map;
  }

  /**
   * Computes the estimated price midpoint (PLN/l) for a given rack price and station.
   * Applies voivodeship margin + station type + brand + border zone + settlement modifiers.
   */
  computeMidpoint(
    rackPricePln: number,
    station: StationClassificationRow,
  ): number {
    const voivKey = station.voivodeship ?? '';
    const voivMarginGr = VOIVODESHIP_MARGINS_GR[voivKey] ?? DEFAULT_MARGIN_GR;
    const stationTypeGr = STATION_TYPE_MODIFIERS_GR[station.station_type ?? 'standard'] ?? 0;
    const brandGr = BRAND_MODIFIERS_GR[station.brand ?? ''] ?? DEFAULT_BRAND_MODIFIER_GR;
    const borderGr = station.is_border_zone_de ? BORDER_ZONE_MODIFIER_GR : 0;
    const settlementGr =
      SETTLEMENT_TIER_MODIFIERS_GR[station.settlement_tier ?? 'metropolitan'] ?? 0;

    const totalModifierGr = voivMarginGr + stationTypeGr + brandGr + borderGr + settlementGr;
    const midpoint = rackPricePln + totalModifierGr / 100;
    return Math.round(midpoint * 100) / 100;
  }

  /**
   * Applies the symmetric ±BAND_RADIUS_GR band to a midpoint.
   */
  computeRange(midpointPln: number): { low: number; high: number } {
    const bandPln = BAND_RADIUS_GR / 100;
    return {
      low:  Math.round((midpointPln - bandPln) * 100) / 100,
      high: Math.round((midpointPln + bandPln) * 100) / 100,
    };
  }

  /**
   * Computes a fallback estimate when rack data is unavailable.
   * Uses a static national average with a ±FALLBACK_BAND_PCT percentage band.
   */
  computeFallback(fuelType: string): { midpoint: number; low: number; high: number } | null {
    const base = NATIONAL_FALLBACK_PRICES_PLN[fuelType];
    if (base === undefined) return null;
    return {
      midpoint: base,
      low:  Math.round(base * (1 - FALLBACK_BAND_PCT) * 100) / 100,
      high: Math.round(base * (1 + FALLBACK_BAND_PCT) * 100) / 100,
    };
  }

  /**
   * Computes estimated price rows for the provided stations.
   * coveredFuelsPerStation: optional map of stationId → Set<fuelType> of fuel types that
   * already have community prices and should be skipped during estimation.
   * Per-fuel: sources and estimateLabel are keyed by fuel type.
   */
  async computeEstimatesForStations(
    stations: StationClassificationRow[],
    coveredFuelsPerStation?: Map<string, Set<string>>,
  ): Promise<Map<string, StationPriceRow>> {
    if (stations.length === 0) return new Map();

    const rackPrices = await this.getLatestRackPrices();
    const now = new Date();
    const result = new Map<string, StationPriceRow>();

    for (const station of stations) {
      const coveredFuels = coveredFuelsPerStation?.get(station.id);
      const prices: Record<string, number> = {};
      const priceRanges: Record<string, { low: number; high: number }> = {};
      const sources: Record<string, 'community' | 'seeded'> = {};
      const estimateLabel: Record<string, 'market_estimate' | 'estimated'> = {};

      // LPG/gas-only stations should only receive LPG estimates, never PB/ON.
      // Matches (case-insensitive): "LPG", "GAZ" (standalone word), "AUTOGAZ",
      // "AUTO-GAZ", "AUTO GAZ", "CNG", "STACJA GAZU", "GAZ-POINT".
      const isLpgOnly = /\b(LPG|GAZ|AUTOGAZ|AUTO[ -]GAZ|CNG|GAZU)\b/i.test(station.name)
        || /GAZ[- ]?POINT/i.test(station.name);

      for (const fuelType of ESTIMABLE_FUEL_TYPES) {
        if (coveredFuels?.has(fuelType)) continue;
        if (isLpgOnly && fuelType !== 'LPG') continue;

        const rackPln = rackPrices.get(fuelType);

        if (rackPln !== undefined) {
          const midpoint = this.computeMidpoint(rackPln, station);
          const range = this.computeRange(midpoint);
          prices[fuelType] = midpoint;
          priceRanges[fuelType] = range;
          sources[fuelType] = 'seeded';
          estimateLabel[fuelType] = 'market_estimate';
        } else {
          const fallback = this.computeFallback(fuelType);
          if (fallback) {
            prices[fuelType] = fallback.midpoint;
            priceRanges[fuelType] = { low: fallback.low, high: fallback.high };
            sources[fuelType] = 'seeded';
            estimateLabel[fuelType] = 'estimated';
          }
        }
      }

      if (Object.keys(prices).length === 0) continue;

      result.set(station.id, {
        stationId: station.id,
        prices,
        priceRanges,
        estimateLabel,
        sources,
        updatedAt: now,
      });
    }

    this.logger.debug(`Computed estimated prices for ${result.size}/${stations.length} stations`);
    return result;
  }
}
