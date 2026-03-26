import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { PriceCacheService, StationPriceRow } from './price-cache.service.js';

export type { StationPriceRow };

@Injectable()
export class PriceService {
  private readonly logger = new Logger(PriceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly priceCache: PriceCacheService,
  ) {}

  /**
   * Returns the latest verified price for every station within radiusMeters of (lat, lng).
   *
   * Read path:
   *   1. Find station IDs in area (spatial query — always hits DB via PostGIS index).
   *   2. Bulk-fetch prices from Redis (MGET).
   *   3. For cache misses: fetch from DB, write to cache.
   *   4. Redis error fallback: use DB for all missed stations (station IDs already known).
   */
  async findPricesInArea(lat: number, lng: number, radiusMeters: number): Promise<StationPriceRow[]> {
    // Step 1 — station discovery (always DB)
    const stationIds = await this.findStationIdsInArea(lat, lng, radiusMeters);
    if (stationIds.length === 0) return [];

    // Step 2 — try Redis
    let cachedMap: Map<string, StationPriceRow | null>;
    let missIds: string[];
    try {
      cachedMap = await this.priceCache.getMany(stationIds);
      missIds = stationIds.filter(id => cachedMap.get(id) === null);
    } catch (err) {
      // Redis unavailable (AC5) — fall back to DB for all stations
      this.logger.warn('Redis unavailable during price fetch — falling back to DB', err);
      return this.findPricesByStationIds(stationIds);
    }

    // Step 3 — fill misses from DB and populate cache
    let missPrices: StationPriceRow[] = [];
    if (missIds.length > 0) {
      missPrices = await this.findPricesByStationIds(missIds);
      for (const row of missPrices) {
        // Fire-and-forget; errors are swallowed inside PriceCacheService.set
        this.priceCache.set(row.stationId, row).catch(() => {});
      }
    }

    // Step 4 — combine: cache hits + DB-fetched misses
    const results: StationPriceRow[] = [];
    for (const id of stationIds) {
      const cached = cachedMap.get(id);
      if (cached !== null && cached !== undefined) {
        results.push(cached);
      }
    }
    results.push(...missPrices);

    return results;
  }

  /**
   * Called by the OCR verification pipeline (Story 2.10+) when a submission is verified.
   * Atomically invalidates the old cache and writes the new price — stale data can never
   * be served after a verified update (AC3).
   */
  async setVerifiedPrice(stationId: string, data: StationPriceRow): Promise<void> {
    await this.priceCache.setAtomic(stationId, data);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async findStationIdsInArea(
    lat: number,
    lng: number,
    radiusMeters: number,
  ): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id
      FROM "Station"
      WHERE location IS NOT NULL
        AND ST_DWithin(location, ST_Point(${lng}, ${lat})::geography, ${radiusMeters})
    `;
    return rows.map(r => r.id);
  }

  private async findPricesByStationIds(stationIds: string[]): Promise<StationPriceRow[]> {
    if (stationIds.length === 0) return [];
    return this.prisma.$queryRaw<StationPriceRow[]>(
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
  }
}
