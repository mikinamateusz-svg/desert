import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { StationPriceRow } from './price-cache.service.js';

export interface HistoryEntry {
  price: number;
  source: 'community' | 'seeded';
  recordedAt: Date;
}

export interface RegionalAverageResult {
  voivodeship: string;
  fuelType: string;
  averagePrice: number | null;
  stationCount: number;
}

@Injectable()
export class PriceHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Inserts one PriceHistory row per fuel type in the given price row.
   * Called from PriceService.setVerifiedPrice() on every verified price write.
   */
  async recordPrices(stationId: string, data: StationPriceRow): Promise<void> {
    const records = Object.entries(data.prices).map(([fuelType, price]) => ({
      station_id: stationId,
      fuel_type: fuelType,
      price,
      source: (data.sources[fuelType] ?? 'community') as 'community' | 'seeded',
    }));

    if (records.length === 0) return;

    await this.prisma.priceHistory.createMany({ data: records });
  }

  /**
   * Returns price history for a station + fuel type, newest first.
   * Capped at `limit` rows (default 500) to prevent unbounded responses.
   */
  async getHistory(stationId: string, fuelType: string, limit = 500): Promise<HistoryEntry[]> {
    const rows = await this.prisma.priceHistory.findMany({
      where: { station_id: stationId, fuel_type: fuelType },
      orderBy: { recorded_at: 'desc' },
      select: { price: true, source: true, recorded_at: true },
      take: limit,
    });

    return rows.map(r => ({
      price: r.price,
      source: r.source as 'community' | 'seeded',
      recordedAt: r.recorded_at,
    }));
  }

  /**
   * Returns the average of the most recent price per station in a voivodeship
   * for the given fuel type.
   */
  async getRegionalAverage(voivodeship: string, fuelType: string): Promise<RegionalAverageResult> {
    const rows = await this.prisma.$queryRaw<{ avg_price: number | null; station_count: number }[]>(
      Prisma.sql`
        SELECT
          AVG(ph.price)::float                 AS avg_price,
          COUNT(DISTINCT ph.station_id)::int   AS station_count
        FROM (
          SELECT DISTINCT ON (ph.station_id) ph.station_id, ph.price
          FROM "PriceHistory" ph
          JOIN "Station" s ON s.id = ph.station_id
          WHERE s.voivodeship = ${voivodeship}
            AND ph.fuel_type = ${fuelType}
          ORDER BY ph.station_id, ph.recorded_at DESC
        ) ph
      `,
    );

    const row = rows[0];
    return {
      voivodeship,
      fuelType,
      averagePrice: row?.avg_price ?? null,
      stationCount: Number(row?.station_count ?? 0),
    };
  }
}
