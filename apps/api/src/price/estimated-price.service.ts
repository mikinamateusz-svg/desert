import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { PriceCacheService, type StationPriceRow } from './price-cache.service.js';
import { StalenessDetectionService } from '../market-signal/staleness-detection.service.js';
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

// Story 2.18 — community-grid IDW interpolation tunables.
const COMMUNITY_GRID_RADIUS_METERS = 10_000; // 10 km — typical neighbourhood for a Polish city
const COMMUNITY_GRID_MAX_K = 5;              // up to 5 nearest neighbours
const DISTANCE_FLOOR_METERS = 100;           // prevent weight explosion for near-overlapping stations
const SAME_BRAND_WEIGHT_BOOST = 2.0;         // same-brand neighbours weighted 2× (Orlen-near-Orlen tighter signal)

/**
 * Story 2.18 — confidence-tier → band-width map (±PLN/l from midpoint).
 * K used (≥3) → high (±0.05); K=2 → medium (±0.15); K=1 → low (±0.30).
 * AC2: tighter bands at K≥3 because 3+ neighbours produce stable means.
 */
const CONFIDENCE_BAND_PLN: Readonly<Record<number, number>> = {
  1: 0.30,
  2: 0.15,
  3: 0.05,
  4: 0.05,
  5: 0.05,
};

// Optional safety-net (AC4): when true, K=0 falls through to the legacy
// rack-formula path so we have a quick revert if community-grid coverage
// is thinner than expected post-launch. Default off — the user's preference
// per spec: "K=0 → no data is the user's explicit preference".
const ENABLE_RACK_FORMULA_FALLBACK = (process.env['ENABLE_RACK_FORMULA_FALLBACK'] ?? '') === 'true';

interface CommunityGridEstimate {
  midpoint: number;
  range: { low: number; high: number };
  referenceStationCount: number;
  isFromStaleInput: boolean;
}

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

  constructor(
    private readonly prisma: PrismaService,
    // Story 2.18 — propagation flow writes recomputed neighbour estimates
    // back into the cache after a verified submission lands.
    private readonly priceCache: PriceCacheService,
    // Story 2.18 / AC8 — input-neighbour staleness propagation: if any
    // contributing neighbour's same-fuel price is rack-stale, the
    // resulting estimate inherits the stale flag.
    private readonly stalenessService: StalenessDetectionService,
  ) {}

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

    const now = new Date();
    const result = new Map<string, StationPriceRow>();
    // Story 2.18 — rack prices only fetched if the deep-fallback flag is on;
    // the standard path is community-grid IDW (see computeCommunityGridEstimate).
    const rackPrices: Map<string, number> = ENABLE_RACK_FORMULA_FALLBACK
      ? await this.getLatestRackPrices()
      : new Map();

    for (const station of stations) {
      const coveredFuels = coveredFuelsPerStation?.get(station.id);
      const prices: Record<string, number> = {};
      const priceRanges: Record<string, { low: number; high: number }> = {};
      const sources: Record<string, 'community' | 'seeded'> = {};
      const estimateLabel: Record<string, 'market_estimate' | 'estimated'> = {};
      const referenceStationCount: Record<string, number> = {};
      const stalenessFlags: Record<string, boolean> = {};

      // LPG/gas-only filter — applies ONLY at cold-start seeding (no community
      // data yet). Once a community submission has reported any non-LPG fuel,
      // the station has proven multi-fuel, so we estimate the full set of
      // gaps. Without this guard a partial OCR (e.g. captured PB_98+ON_PREMIUM
      // but missed PB_95) would leave PB_95 and ON permanently missing on
      // gaz-named stations like "Cha-El-Gaz".
      const hasNonLpgCommunity =
        !!coveredFuels && Array.from(coveredFuels).some(ft => ft !== 'LPG');
      const nameLooksLpgOnly =
        /\b(LPG|GAZ|AUTOGAZ|AUTO[ -]GAZ|CNG|GAZU)\b/i.test(station.name) ||
        /GAZ[- ]?POINT/i.test(station.name);
      const isLpgOnly = nameLooksLpgOnly && !hasNonLpgCommunity;

      for (const fuelType of ESTIMABLE_FUEL_TYPES) {
        if (coveredFuels?.has(fuelType)) continue;
        if (isLpgOnly && fuelType !== 'LPG') continue;

        // Story 2.18 AC1 — standard path: K-nearest IDW interpolation
        // from verified community prices within 10 km. Same-brand neighbours
        // weighted 2× per AC1. K=0 → null → fuel is omitted from the row
        // (per AC4 "no data is the user's explicit preference").
        const gridEstimate = await this.computeCommunityGridEstimate(
          station.id,
          fuelType,
          station.brand,
        );

        if (gridEstimate) {
          prices[fuelType] = gridEstimate.midpoint;
          priceRanges[fuelType] = gridEstimate.range;
          sources[fuelType] = 'seeded';
          // Re-use the existing label semantic — `market_estimate` is the
          // visible "Estimated" treatment in the detail sheet. We don't
          // introduce a new label string per the spec: the rack-formula
          // path is gone for UI, so `market_estimate` now means "community-
          // grid derived".
          estimateLabel[fuelType] = 'market_estimate';
          referenceStationCount[fuelType] = gridEstimate.referenceStationCount;
          if (gridEstimate.isFromStaleInput) {
            stalenessFlags[fuelType] = true;
          }
          continue;
        }

        // AC4 deep-fallback — only when the optional env safety-net is on.
        // Default off: K=0 leaves the fuel out of the response entirely.
        if (ENABLE_RACK_FORMULA_FALLBACK) {
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
        // Else: K=0 + flag off → no entry for this fuel; mobile renders
        // the station with whatever other fuels remain (or as 'nodata').
      }

      if (Object.keys(prices).length === 0) continue;

      const row: StationPriceRow = {
        stationId: station.id,
        prices,
        priceRanges,
        estimateLabel,
        sources,
        updatedAt: now,
      };
      if (Object.keys(referenceStationCount).length > 0) {
        row.referenceStationCount = referenceStationCount;
      }
      if (Object.keys(stalenessFlags).length > 0) {
        row.stalenessFlags = stalenessFlags;
      }
      result.set(station.id, row);
    }

    this.logger.debug(`Computed estimated prices for ${result.size}/${stations.length} stations`);
    return result;
  }

  /**
   * Story 2.18 AC1 — K-nearest inverse-distance-weighted interpolation
   * over verified community prices for the given fuel within 10 km.
   *
   * Steps:
   *   1. Find up to 5 nearest verified prices for the same fuel within
   *      10 km of the target station (PostGIS ST_DWithin / ST_Distance,
   *      excluding the target station itself).
   *   2. Weight each neighbour: `1 / max(distance_m, 100)` (the floor
   *      prevents weight-explosion for near-overlapping stations on
   *      opposite sides of a road).
   *   3. Apply same-brand boost: ×2.0 when neighbour.brand === target.brand.
   *   4. Compute weighted-average midpoint.
   *   5. Map K to band width per AC2 (5/3-4 → ±0.05, 2 → ±0.15, 1 → ±0.30).
   *   6. AC8 staleness propagation: if any input neighbour has a
   *      StationFuelStaleness row for this fuel, mark the estimate as
   *      derived from stale input.
   *
   * Returns null at K=0 — caller decides whether to fall through to the
   * rack-formula safety net (gated by ENABLE_RACK_FORMULA_FALLBACK) or
   * leave the fuel out of the response (default).
   */
  async computeCommunityGridEstimate(
    stationId: string,
    fuelType: string,
    targetBrand: string | null,
  ): Promise<CommunityGridEstimate | null> {
    // K-nearest neighbours within radius. Uses the existing Station.location
    // GIST index for the distance predicate. The verified-price subquery
    // unrolls Submission.price_data (JSON array of {fuel_type, price_per_litre})
    // via PostgreSQL jsonb_array_elements and picks the latest per station.
    //
    // P6 (2.18 review) — `target.location IS NOT NULL` baked into the
    // outer WHERE so a target station with NULL location short-circuits
    // to K=0 (returns null below) rather than silently returning empty
    // via ST_DWithin's NULL → NULL semantics.
    const rows = await this.prisma.$queryRaw<
      {
        stationId: string;
        brand: string | null;
        priceLitre: number;
        distanceMeters: number;
      }[]
    >`
      SELECT
        latest.station_id           AS "stationId",
        s.brand                     AS brand,
        latest.price_per_litre      AS "priceLitre",
        ST_Distance(s.location, target.location) AS "distanceMeters"
      FROM "Station" target
      -- Hotfix 2026-05-14: was CROSS JOIN LATERAL (...) ON true which
      -- Postgres rejects (42601: syntax error at or near "ON") — CROSS
      -- JOIN does not accept an ON clause. LEFT JOIN LATERAL ... ON true
      -- has equivalent semantics here (when the subquery returns no
      -- rows, the inner JOIN to Station s drops the resulting null row,
      -- so the final result still yields zero rows for stations with no
      -- qualifying neighbours).
      LEFT JOIN LATERAL (
        SELECT DISTINCT ON (sub.station_id)
          sub.station_id,
          (elem->>'price_per_litre')::float8 AS price_per_litre
        FROM "Station" s2
        JOIN "Submission" sub ON sub.station_id = s2.id
        CROSS JOIN LATERAL jsonb_array_elements(sub.price_data::jsonb) elem
        WHERE s2.id <> target.id
          AND s2.location IS NOT NULL
          AND ST_DWithin(s2.location, target.location, ${COMMUNITY_GRID_RADIUS_METERS})
          AND sub.status = 'verified'
          AND elem->>'fuel_type' = ${fuelType}
          AND elem ? 'price_per_litre'
          AND (elem->>'price_per_litre') IS NOT NULL
        -- P4 (2.18 review) — sub.id as final tiebreak so DISTINCT ON is
        -- deterministic when two submissions share an exact created_at.
        ORDER BY sub.station_id, sub.created_at DESC, sub.id DESC
      ) AS latest ON true
      JOIN "Station" s ON s.id = latest.station_id
      WHERE target.id = ${stationId}
        AND target.location IS NOT NULL
      ORDER BY ST_Distance(s.location, target.location) ASC
      LIMIT ${COMMUNITY_GRID_MAX_K}
    `;

    if (rows.length === 0) return null;

    // P2 (2.18 review) — defensive: filter any neighbour row whose
    // priceLitre came back as NaN / non-finite (despite the SQL guard).
    // One bad row would otherwise poison the entire IDW midpoint.
    const validRows = rows.filter(r => Number.isFinite(r.priceLitre) && Number.isFinite(r.distanceMeters));
    if (validRows.length === 0) return null;

    // IDW math — weight per AC1; same-brand boost per AC1.
    // P5 (2.18 review) — case-insensitive brand comparison so seeded
    // / OCR-derived brand strings with different casing still trigger
    // the same-brand boost ("Orlen" vs "orlen" vs "ORLEN").
    const normalisedTargetBrand = targetBrand?.toLowerCase() ?? null;
    let weightSum = 0;
    let weightedPriceSum = 0;
    for (const r of validRows) {
      const floored = Math.max(r.distanceMeters, DISTANCE_FLOOR_METERS);
      const baseWeight = 1 / floored;
      const sameBrand = normalisedTargetBrand !== null
        && r.brand?.toLowerCase() === normalisedTargetBrand;
      const w = sameBrand ? baseWeight * SAME_BRAND_WEIGHT_BOOST : baseWeight;
      weightSum += w;
      weightedPriceSum += w * r.priceLitre;
    }
    const midpointRaw = weightedPriceSum / weightSum;
    const midpoint = Math.round(midpointRaw * 100) / 100;

    // Band width per K used (AC2). Uses validRows (post-NaN-filter) so
    // confidence accurately reflects usable inputs.
    const k = validRows.length;
    const bandPln = CONFIDENCE_BAND_PLN[k] ?? CONFIDENCE_BAND_PLN[5];
    const range = {
      low:  Math.round((midpoint - bandPln) * 100) / 100,
      high: Math.round((midpoint + bandPln) * 100) / 100,
    };

    // AC8 — staleness propagation: estimate inherits stale flag if any
    // contributing neighbour's same-fuel price is currently rack-stale.
    // Batched single lookup over the K input stationIds.
    const neighbourIds = validRows.map(r => r.stationId);
    const stalenessMap = await this.stalenessService.getStaleFuelsForStations(neighbourIds);
    let isFromStaleInput = false;
    for (const id of neighbourIds) {
      if (stalenessMap.get(id)?.has(fuelType)) {
        isFromStaleInput = true;
        break;
      }
    }

    return { midpoint, range, referenceStationCount: k, isFromStaleInput };
  }

  /**
   * Story 2.18 AC5 — eager recompute of community-grid estimates for
   * stations within 10 km of `originStationId` that don't yet have a
   * verified `fuelType` price. Called after a verified submission lands
   * (photo pipeline / admin approve / fillup), bounding the ripple to
   * the neighbourhood the new data point now informs.
   *
   * Per-station error isolation: a single recompute failure logs and
   * the loop continues — never blocks the original submission flow.
   * Fire-and-forget at the call site (caller doesn't await).
   *
   * Per-fuel granularity (AC7) — only the fuel that just verified is
   * recomputed; other fuels at neighbour stations are untouched (no new
   * data for them).
   */
  async propagateToNearbyStations(originStationId: string, fuelType: string): Promise<void> {
    // Find nearby station IDs that don't carry a verified `fuelType` price
    // (otherwise community would dominate; nothing to recompute for them).
    let neighbours: { id: string; brand: string | null }[];
    try {
      neighbours = await this.prisma.$queryRaw<{ id: string; brand: string | null }[]>`
        SELECT s.id, s.brand
        FROM "Station" target
        JOIN "Station" s
          ON s.location IS NOT NULL
          AND s.id <> target.id
          AND ST_DWithin(s.location, target.location, ${COMMUNITY_GRID_RADIUS_METERS})
        WHERE target.id = ${originStationId}
          AND NOT EXISTS (
            SELECT 1 FROM "Submission" sub
            CROSS JOIN LATERAL jsonb_array_elements(sub.price_data::jsonb) elem
            WHERE sub.station_id = s.id
              AND sub.status = 'verified'
              AND elem->>'fuel_type' = ${fuelType}
          )
      `;
    } catch (err) {
      // Propagation is best-effort — DB hiccup here doesn't fail the
      // original verify path.
      this.logger.warn(
        `propagateToNearbyStations: neighbour query failed for ${originStationId}/${fuelType}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    if (neighbours.length === 0) return;

    let updated = 0;
    let skipped = 0;
    for (const n of neighbours) {
      try {
        const estimate = await this.computeCommunityGridEstimate(n.id, fuelType, n.brand);
        if (!estimate) {
          skipped++;
          continue;
        }

        // Read-modify-write the cached row. If absent, skip — the lazy
        // fallback in PriceService.findPricesInArea will compute on demand.
        // If present, merge our fuel into prices / priceRanges / sources /
        // estimateLabel / referenceStationCount / stalenessFlags.
        const cachedMap = await this.priceCache.getMany([n.id]);
        const existing = cachedMap.get(n.id);
        if (!existing) {
          skipped++;
          continue;
        }

        const merged: StationPriceRow = {
          ...existing,
          prices: { ...existing.prices, [fuelType]: estimate.midpoint },
          priceRanges: { ...(existing.priceRanges ?? {}), [fuelType]: estimate.range },
          estimateLabel: { ...(existing.estimateLabel ?? {}), [fuelType]: 'market_estimate' },
          sources: { ...existing.sources, [fuelType]: 'seeded' },
          referenceStationCount: {
            ...(existing.referenceStationCount ?? {}),
            [fuelType]: estimate.referenceStationCount,
          },
          stalenessFlags: estimate.isFromStaleInput
            ? { ...(existing.stalenessFlags ?? {}), [fuelType]: true }
            : (() => {
                // Stale-input went away on this recompute — clear the flag
                // for this specific fuel if it was set.
                const next = { ...(existing.stalenessFlags ?? {}) };
                if (next[fuelType]) delete next[fuelType];
                return Object.keys(next).length > 0 ? next : undefined;
              })(),
          updatedAt: new Date(),
        };

        await this.priceCache.set(n.id, merged);
        updated++;
      } catch (err) {
        this.logger.warn(
          `propagateToNearbyStations: recompute failed for neighbour ${n.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    this.logger.log(
      `propagateToNearbyStations: ${originStationId}/${fuelType} → updated ${updated}, skipped ${skipped} (of ${neighbours.length} neighbours)`,
    );
  }
}
