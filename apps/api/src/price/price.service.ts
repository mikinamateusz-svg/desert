import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { PriceCacheService, StationPriceRow } from './price-cache.service.js';
import { EstimatedPriceService, StationClassificationRow } from './estimated-price.service.js';
import { PriceHistoryService } from './price-history.service.js';
import { StalenessDetectionService } from '../market-signal/staleness-detection.service.js';
import { ESTIMABLE_FUEL_TYPES } from './config/price-modifiers.js';

export type { StationPriceRow };

/**
 * Story 2.17 — merge two optional staleness-flag maps. Returns
 * undefined when both are absent/empty so we keep the API payload
 * minimal. On overlap the second argument (community-row flags)
 * wins, since community flags reflect actual verified-price
 * freshness vs estimated-row flags which are derived per AC5/AC8.
 */
function mergeFlags(
  a: Record<string, boolean> | undefined,
  b: Record<string, boolean> | undefined,
): Record<string, boolean> | undefined {
  if (!a && !b) return undefined;
  const merged: Record<string, boolean> = { ...(a ?? {}), ...(b ?? {}) };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

@Injectable()
export class PriceService {
  private readonly logger = new Logger(PriceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly priceCache: PriceCacheService,
    private readonly estimatedPriceService: EstimatedPriceService,
    private readonly priceHistory: PriceHistoryService,
    // Story 2.17 — batched per-request staleness lookup; folded into
    // every assembled StationPriceRow before the result leaves this
    // service (and before cache-write so cache hits also carry flags).
    private readonly stalenessService: StalenessDetectionService,
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
      const stalenessMap = await this.stalenessService.getStaleFuelsForStations(stationIds);
      const withFlags = this.applyStalenessFlags(communityFallback, stalenessMap);
      return this.appendEstimated(withFlags, stations, stalenessMap);
    }

    // Step 3 — fill misses from DB.
    // Story 2.17: for fresh DB rows we fold stalenessFlags BEFORE cache-write
    // so cache hits also carry the flags. The cache invalidation hook in
    // StalenessDetectionService rebuilds these entries when rack moves.
    let missPrices: StationPriceRow[] = [];
    if (missIds.length > 0) {
      missPrices = await this.findPricesByStationIds(missIds);
    }

    // Step 4 — batched staleness lookup for the whole result set
    // (cache hits + DB-fetched misses + stations that will get estimates).
    // Single query rather than N round-trips.
    const stalenessMap = await this.stalenessService.getStaleFuelsForStations(stationIds);

    // Apply flags to DB-fetched misses then cache them. Cache write
    // captures the flags so a cache hit can serve them even if Step 6
    // is skipped for any reason; the re-application below is the
    // canonical, always-fresh source.
    const missPricesWithFlags = this.applyStalenessFlags(missPrices, stalenessMap);
    for (const row of missPricesWithFlags) {
      this.priceCache.set(row.stationId, row).catch(() => {});
    }

    // Step 5 — combine: cache hits + DB-fetched misses
    const communityPrices: StationPriceRow[] = [];
    for (const id of stationIds) {
      const cached = cachedMap.get(id);
      if (cached !== null && cached !== undefined) {
        communityPrices.push(cached);
      }
    }
    communityPrices.push(...missPricesWithFlags);

    // Step 6 — re-apply staleness flags to the combined array. This
    // covers cache-hit rows too, so that even when the cache-invalidation
    // hook on the worker missed (Redis transient failure) or a cached
    // entry pre-dates 2.17, every response carries the current per-fuel
    // staleness state. Per-row mutation is intentional — `applyStalenessFlags`
    // overwrites `row.stalenessFlags` from a single, freshly-queried
    // source (`stalenessMap`), so correctness no longer depends on the
    // cache hook being reliable. The hook remains as a freshness
    // optimisation (next DB-miss rebuild captures the new state into
    // the cache too) but is no longer load-bearing for correctness.
    this.applyStalenessFlags(communityPrices, stalenessMap);

    // Step 7 — fill estimated ranges for any estimable fuel gaps.
    // AC5 propagation contract (stale neighbour inputs → stale estimate)
    // is honoured by 2.18; for 2.17 the estimated rows pick up flags
    // for their own station ID if any exist (rack moved against a
    // station that has no community price yet).
    return this.appendEstimated(communityPrices, stations, stalenessMap);
  }

  /**
   * Story 2.17 — fold the batched staleness lookup into each row's
   * `stalenessFlags`. Only fuel types the station actually carries a
   * price for get an entry (true if rack-stale, false otherwise) — we
   * don't emit flags for fuels the station doesn't price.
   * Mutates the input row in-place and returns the same array.
   */
  private applyStalenessFlags(
    rows: StationPriceRow[],
    stalenessMap: Map<string, Set<string>>,
  ): StationPriceRow[] {
    for (const row of rows) {
      const staleFuels = stalenessMap.get(row.stationId);
      if (!staleFuels || staleFuels.size === 0) {
        // No flags for this station — leave field undefined to keep the
        // serialised payload small (mobile treats absent === all-false).
        continue;
      }
      const flags: Record<string, boolean> = {};
      for (const fuel of Object.keys(row.prices)) {
        flags[fuel] = staleFuels.has(fuel);
      }
      row.stalenessFlags = flags;
    }
    return rows;
  }

  /**
   * Called by the OCR verification pipeline when a submission is verified.
   * Records price history (best-effort), then atomically invalidates the old cache and writes the new price.
   * History write failure is logged but does not block the cache update.
   */
  async setVerifiedPrice(stationId: string, data: StationPriceRow): Promise<void> {
    try {
      await this.priceHistory.recordPrices(stationId, data);
    } catch (err) {
      this.logger.warn(`History write failed for station ${stationId} — cache update will still proceed`, err);
    }
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
    stalenessMap?: Map<string, Set<string>>,
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

    // Story 2.17 — fold stalenessFlags into the estimated rows too.
    // For 2.17 the rack-formula path is still in use, so the flag
    // applies directly to the station's own ID. 2.18 will extend
    // propagation to "inherited from neighbours" per AC5/AC8 contract.
    if (stalenessMap) {
      this.applyStalenessFlags(Array.from(estimatedMap.values()), stalenessMap);
    }

    const result: StationPriceRow[] = [];
    for (const station of stations) {
      const communityRow = communityMap.get(station.id);
      const estimatedRow = estimatedMap.get(station.id);

      if (communityRow && estimatedRow) {
        // Merge: community prices + estimated prices for missing estimable fuels.
        // Staleness flags from both rows are merged — community flags
        // win on overlap (they reflect actual verified-price freshness).
        const mergedFlags = mergeFlags(estimatedRow.stalenessFlags, communityRow.stalenessFlags);
        result.push({
          stationId: station.id,
          prices:       { ...communityRow.prices, ...estimatedRow.prices },
          priceRanges:  estimatedRow.priceRanges,
          estimateLabel: estimatedRow.estimateLabel,
          sources:      { ...communityRow.sources, ...estimatedRow.sources },
          stalenessFlags: mergedFlags,
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
      SELECT id, name, brand, station_type, voivodeship, settlement_tier, is_border_zone_de
      FROM "Station"
      WHERE location IS NOT NULL
        AND ST_DWithin(location, ST_Point(${lng}, ${lat})::geography, ${radiusMeters})
    `;
  }

  private async findPricesByStationIds(stationIds: string[]): Promise<StationPriceRow[]> {
    if (stationIds.length === 0) return [];

    // Query 1: latest verified submission per station (all fuel types in price_data JSON).
    // Submission.price_data is a JSON ARRAY of {fuel_type, price_per_litre} objects,
    // not a Record — convert to a fuel-keyed map below.
    const submissionRows = await this.prisma.$queryRaw<
      {
        stationId: string;
        priceData: Array<{ fuel_type: string; price_per_litre: number }> | null;
        updatedAt: Date;
        source: 'community' | 'seeded';
      }[]
    >(
      Prisma.sql`
        SELECT DISTINCT ON (sub.station_id)
          sub.station_id   AS "stationId",
          sub.price_data   AS "priceData",
          sub.created_at   AS "updatedAt",
          sub.source       AS source
        FROM "Submission" sub
        WHERE sub.status = 'verified'
          AND sub.station_id IN (${Prisma.join(stationIds)})
        ORDER BY sub.station_id, sub.created_at DESC
      `,
    );

    // Query 2: latest admin_override per station per fuel type — merged on top of submissions
    const overrideRows = await this.prisma.$queryRaw<
      { stationId: string; fuelType: string; price: number; recordedAt: Date }[]
    >(
      Prisma.sql`
        SELECT DISTINCT ON (station_id, fuel_type)
          station_id   AS "stationId",
          fuel_type    AS "fuelType",
          price,
          recorded_at  AS "recordedAt"
        FROM "PriceHistory"
        WHERE station_id IN (${Prisma.join(stationIds)})
          AND source = 'admin_override'
        ORDER BY station_id, fuel_type, recorded_at DESC
      `,
    );

    // Build override lookup: stationId → fuelType → { price, recordedAt }
    const overrideMap = new Map<string, Map<string, { price: number; recordedAt: Date }>>();
    for (const row of overrideRows) {
      if (!overrideMap.has(row.stationId)) overrideMap.set(row.stationId, new Map());
      overrideMap.get(row.stationId)!.set(row.fuelType, { price: row.price, recordedAt: row.recordedAt });
    }

    // Convert submission rows, merging any newer admin override per fuel type.
    // priceData is a JSON array — flatten to a Record<fuel_type, price>. The
    // earlier `{ ...row.prices }` produced numeric-keyed entries (the array
    // indexes), which made downstream consumers see no PB_95/ON/etc. keys.
    const result: StationPriceRow[] = submissionRows.map(row => {
      const prices: Record<string, number> = {};
      const sources: Record<string, 'community' | 'seeded' | 'admin_override'> = {};
      for (const entry of row.priceData ?? []) {
        if (
          entry &&
          typeof entry === 'object' &&
          typeof entry.fuel_type === 'string' &&
          typeof entry.price_per_litre === 'number' &&
          Number.isFinite(entry.price_per_litre)
        ) {
          prices[entry.fuel_type] = entry.price_per_litre;
          sources[entry.fuel_type] = row.source;
        }
      }
      const stationOverrides = overrideMap.get(row.stationId);
      if (stationOverrides) {
        for (const [ft, ov] of stationOverrides) {
          if (ov.recordedAt > row.updatedAt) {
            prices[ft] = ov.price;
            sources[ft] = 'admin_override';
          }
        }
      }
      return { stationId: row.stationId, prices, sources, updatedAt: row.updatedAt };
    });

    // Stations with only admin overrides (no verified submission yet) — serve override data directly
    const submittedIds = new Set(submissionRows.map(r => r.stationId));
    for (const id of stationIds) {
      if (submittedIds.has(id)) continue;
      const stationOverrides = overrideMap.get(id);
      if (!stationOverrides || stationOverrides.size === 0) continue;
      const prices: Record<string, number> = {};
      const sources: Record<string, 'admin_override'> = {};
      let latestDate = new Date(0);
      for (const [ft, ov] of stationOverrides) {
        prices[ft] = ov.price;
        sources[ft] = 'admin_override';
        if (ov.recordedAt > latestDate) latestDate = ov.recordedAt;
      }
      result.push({ stationId: id, prices, sources, updatedAt: latestDate });
    }

    return result;
  }
}
