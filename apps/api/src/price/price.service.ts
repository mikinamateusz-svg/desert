import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { PriceCacheService, StationPriceRow } from './price-cache.service.js';
import { EstimatedPriceService, StationClassificationRow } from './estimated-price.service.js';
import { ESTIMABLE_FUEL_TYPES } from './config/price-modifiers.js';

export type { StationPriceRow };

@Injectable()
export class PriceService {
  private readonly logger = new Logger(PriceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly priceCache: PriceCacheService,
    private readonly estimatedPriceService: EstimatedPriceService,
  ) {}

  /**
   * Returns prices for every station within radiusMeters of (lat, lng).
   * Community-verified prices are returned as-is. For each station, any estimable
   * fuel type (PB_95, ON, LPG) that lacks a community price receives an estimated range.
   * Coverage is per-fuel — a station with a community PB_95 still gets estimated ON/LPG.
   *
   * Read path:
   *   1. Find stations in area with classification fields (spatial query).
   *   2. Bulk-fetch community prices from Redis (MGET).
   *   3. For cache misses: fetch from DB, write to cache.
   *   4. Redis error fallback: use DB for all missed stations.
   *   5. For each station, estimate any estimable fuels not covered by community data.
   */
  async findPricesInArea(lat: number, lng: number, radiusMeters: number): Promise<StationPriceRow[]> {
    // Step 1 — station discovery (always DB, returns classification fields)
    const stations = await this.findStationsInArea(lat, lng, radiusMeters);
    if (stations.length === 0) return [];

    const stationIds = stations.map(s => s.id);

    // Step 2 — try Redis
    let cachedMap: Map<string, StationPriceRow | null>;
    let missIds: string[];
    try {
      cachedMap = await this.priceCache.getMany(stationIds);
      missIds = stationIds.filter(id => cachedMap.get(id) === null);
    } catch (err) {
      // Redis unavailable — fall back to DB for all stations
      this.logger.warn('Redis unavailable during price fetch — falling back to DB', err);
      const communityFallback = await this.findPricesByStationIds(stationIds);
      return this.appendEstimated(communityFallback, stations);
    }

    // Step 3 — fill misses from DB and populate cache
    let missPrices: StationPriceRow[] = [];
    if (missIds.length > 0) {
      missPrices = await this.findPricesByStationIds(missIds);
      for (const row of missPrices) {
        this.priceCache.set(row.stationId, row).catch(() => {});
      }
    }

    // Step 4 — combine: cache hits + DB-fetched misses
    const communityPrices: StationPriceRow[] = [];
    for (const id of stationIds) {
      const cached = cachedMap.get(id);
      if (cached !== null && cached !== undefined) {
        communityPrices.push(cached);
      }
    }
    communityPrices.push(...missPrices);

    // Step 5 — fill estimated ranges for any estimable fuel gaps
    return this.appendEstimated(communityPrices, stations);
  }

  /**
   * Called by the OCR verification pipeline when a submission is verified.
   * Atomically invalidates the old cache and writes the new price.
   */
  async setVerifiedPrice(stationId: string, data: StationPriceRow): Promise<void> {
    await this.priceCache.setAtomic(stationId, data);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * For each station: if any estimable fuel type is missing a community price,
   * compute estimated ranges for those fuels only and merge into the result row.
   * Stations with no community data receive a fully estimated row.
   */
  private async appendEstimated(
    communityPrices: StationPriceRow[],
    stations: StationClassificationRow[],
  ): Promise<StationPriceRow[]> {
    const communityMap = new Map(communityPrices.map(r => [r.stationId, r]));

    // Determine which stations need estimation (fully or partially uncovered)
    const stationsNeedingEstimates: StationClassificationRow[] = [];
    const coveredFuelsPerStation = new Map<string, Set<string>>();

    for (const station of stations) {
      const communityRow = communityMap.get(station.id);
      if (!communityRow) {
        stationsNeedingEstimates.push(station);
      } else {
        const hasGaps = ESTIMABLE_FUEL_TYPES.some(ft => communityRow.prices[ft] === undefined);
        if (hasGaps) {
          stationsNeedingEstimates.push(station);
          coveredFuelsPerStation.set(station.id, new Set(Object.keys(communityRow.prices)));
        }
      }
    }

    if (stationsNeedingEstimates.length === 0) return communityPrices;

    const estimatedMap = await this.estimatedPriceService.computeEstimatesForStations(
      stationsNeedingEstimates,
      coveredFuelsPerStation,
    );

    const result: StationPriceRow[] = [];
    for (const station of stations) {
      const communityRow = communityMap.get(station.id);
      const estimatedRow = estimatedMap.get(station.id);

      if (communityRow && estimatedRow) {
        // Merge: community prices + estimated prices for missing estimable fuels
        result.push({
          stationId: station.id,
          prices:       { ...communityRow.prices, ...estimatedRow.prices },
          priceRanges:  estimatedRow.priceRanges,
          estimateLabel: estimatedRow.estimateLabel,
          sources:      { ...communityRow.sources, ...estimatedRow.sources },
          updatedAt:    communityRow.updatedAt,
        });
      } else if (communityRow) {
        result.push(communityRow);
      } else if (estimatedRow) {
        result.push(estimatedRow);
      }
    }

    return result;
  }

  private async findStationsInArea(
    lat: number,
    lng: number,
    radiusMeters: number,
  ): Promise<StationClassificationRow[]> {
    return this.prisma.$queryRaw<StationClassificationRow[]>`
      SELECT id, brand, station_type, voivodeship, settlement_tier, is_border_zone_de
      FROM "Station"
      WHERE location IS NOT NULL
        AND ST_DWithin(location, ST_Point(${lng}, ${lat})::geography, ${radiusMeters})
    `;
  }

  private async findPricesByStationIds(stationIds: string[]): Promise<StationPriceRow[]> {
    if (stationIds.length === 0) return [];
    const rows = await this.prisma.$queryRaw<
      { stationId: string; prices: Record<string, number>; updatedAt: Date; source: 'community' | 'seeded' }[]
    >(
      Prisma.sql`
        SELECT DISTINCT ON (sub.station_id)
          sub.station_id   AS "stationId",
          sub.price_data   AS prices,
          sub.created_at   AS "updatedAt",
          sub.source       AS source
        FROM "Submission" sub
        WHERE sub.status = 'verified'
          AND sub.station_id IN (${Prisma.join(stationIds)})
        ORDER BY sub.station_id, sub.created_at DESC
      `,
    );
    // Convert scalar source from DB into per-fuel sources map
    return rows.map(row => ({
      stationId: row.stationId,
      prices:    row.prices,
      sources:   Object.fromEntries(
        Object.keys(row.prices).map(ft => [ft, row.source]),
      ),
      updatedAt: row.updatedAt,
    }));
  }
}
