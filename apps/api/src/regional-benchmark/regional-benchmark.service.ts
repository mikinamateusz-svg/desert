import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

interface BenchmarkRow {
  voivodeship: string;
  fuel_type: string;
  median_price: number;
  station_count: number;
}

@Injectable()
export class RegionalBenchmarkService {
  private readonly logger = new Logger(RegionalBenchmarkService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Daily snapshot — for each (voivodeship × fuel_type) combination compute the
   * median price across each station's most recent non-seeded PriceHistory row in
   * the last 30 days, then append a RegionalBenchmark row per combination.
   *
   * Why median, not mean: a single price-gouging MOP would skew the mean. Median
   * gives drivers a more honest "what's normal in your area" reference.
   *
   * Why DISTINCT ON (station, fuel_type): one vote per station, not one per
   * submission. A busy ORLEN with 200 community submissions counts the same as
   * a quiet rural station with 2.
   *
   * Why exclude `seeded`: seeded prices are our own estimates. Including them
   * would circularly contaminate the benchmark with our own inferences.
   *
   * The HAVING ≥ 5 clause silently drops sparse combinations (no benchmark is
   * better than a misleading one based on 1-2 stations).
   */
  async calculateAndStore(): Promise<{ inserted: number }> {
    const rows = await this.prisma.$queryRaw<BenchmarkRow[]>`
      SELECT
        s.voivodeship,
        ph.fuel_type,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ph.price)::float8 AS median_price,
        COUNT(DISTINCT ph.station_id)::int                            AS station_count
      FROM (
        SELECT DISTINCT ON (ph2.station_id, ph2.fuel_type)
          ph2.station_id,
          ph2.fuel_type,
          ph2.price
        FROM "PriceHistory" ph2
        WHERE ph2.recorded_at >= NOW() - INTERVAL '30 days'
          AND ph2.source != 'seeded'
        ORDER BY ph2.station_id, ph2.fuel_type, ph2.recorded_at DESC
      ) ph
      JOIN "Station" s ON s.id = ph.station_id
      WHERE s.voivodeship IS NOT NULL
      GROUP BY s.voivodeship, ph.fuel_type
      HAVING COUNT(DISTINCT ph.station_id) >= 5
    `;

    if (rows.length === 0) {
      return { inserted: 0 };
    }

    await this.prisma.regionalBenchmark.createMany({
      data: rows.map((r) => ({
        voivodeship: r.voivodeship,
        fuel_type: r.fuel_type,
        median_price: r.median_price,
        station_count: r.station_count,
        // calculated_at defaults to now() in schema
      })),
    });

    return { inserted: rows.length };
  }

  /**
   * Look up the most recent benchmark for a station's voivodeship × fuel_type.
   * Returns null when:
   *   - The station has no voivodeship (unclassified)
   *   - No benchmark exists for that voivodeship × fuel_type combination
   *
   * Consumers (Story 5.2 FillUp, Story 3.7 price validation) should treat null
   * as "no comparable data" rather than substituting a synthetic value.
   */
  async getLatestForStation(
    stationId: string,
    fuelType: string,
  ): Promise<{ medianPrice: number } | null> {
    const station = await this.prisma.station.findUnique({
      where: { id: stationId },
      select: { voivodeship: true },
    });
    if (!station?.voivodeship) return null;

    const benchmark = await this.prisma.regionalBenchmark.findFirst({
      where: { voivodeship: station.voivodeship, fuel_type: fuelType },
      orderBy: { calculated_at: 'desc' },
      select: { median_price: true },
    });

    return benchmark ? { medianPrice: benchmark.median_price } : null;
  }
}
