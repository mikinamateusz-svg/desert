import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface NearbyStation {
  id: string;
  name: string;
  address: string | null;
  google_places_id: string | null;
}

export interface StationInArea {
  id: string;
  name: string;
  address: string | null;
  google_places_id: string | null;
  lat: number;
  lng: number;
}

@Injectable()
export class StationService {
  constructor(private readonly prisma: PrismaService) {}

  async findNearestStation(lat: number, lng: number, radiusMeters = 200): Promise<NearbyStation | null> {
    const results = await this.prisma.$queryRaw<NearbyStation[]>`
      SELECT id, name, address, google_places_id
      FROM "Station"
      WHERE ST_DWithin(location, ST_Point(${lng}, ${lat})::geography, ${radiusMeters})
      ORDER BY location <-> ST_Point(${lng}, ${lat})::geography
      LIMIT 1
    `;
    return results[0] ?? null;
  }

  async findStationsInArea(lat: number, lng: number, radiusMeters: number): Promise<StationInArea[]> {
    return this.prisma.$queryRaw<StationInArea[]>`
      SELECT
        id,
        name,
        address,
        google_places_id,
        ST_Y(location::geometry) AS lat,
        ST_X(location::geometry) AS lng
      FROM "Station"
      WHERE location IS NOT NULL
        AND ST_DWithin(location, ST_Point(${lng}, ${lat})::geography, ${radiusMeters})
      ORDER BY location <-> ST_Point(${lng}, ${lat})::geography
      LIMIT 500
    `;
  }
}
