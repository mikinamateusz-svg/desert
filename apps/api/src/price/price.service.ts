import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

interface StationPriceRow {
  stationId: string;
  prices: Record<string, number>; // JSONB from DB — keys are FuelType values
  updatedAt: Date;
  source: 'community' | 'seeded';
}

@Injectable()
export class PriceService {
  constructor(private readonly prisma: PrismaService) {}

  async findPricesInArea(lat: number, lng: number, radiusMeters: number): Promise<StationPriceRow[]> {
    return this.prisma.$queryRaw<StationPriceRow[]>`
      SELECT DISTINCT ON (sub.station_id)
        sub.station_id   AS "stationId",
        sub.price_data   AS prices,
        sub.created_at   AS "updatedAt",
        sub.source       AS source
      FROM "Submission" sub
      JOIN "Station" s ON s.id = sub.station_id
      WHERE sub.status = 'verified'
        AND s.location IS NOT NULL
        AND ST_DWithin(s.location, ST_Point(${lng}, ${lat})::geography, ${radiusMeters})
      ORDER BY sub.station_id, sub.created_at DESC
    `;
  }
}
