import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface NearbyStation {
  id: string;
  name: string;
  address: string | null;
  google_places_id: string | null;
}

export interface NearbyStationWithDistance {
  id: string;
  name: string;
  address: string | null;
  google_places_id: string | null;
  brand: string | null;  // from Station.brand (Story 2.14 classification)
  distance_m: number;
}

export interface StationInArea {
  id: string;
  name: string;
  address: string | null;
  google_places_id: string | null;
  brand: string | null;
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

  async findById(id: string): Promise<StationInArea | null> {
    const results = await this.prisma.$queryRaw<StationInArea[]>`
      SELECT
        id,
        name,
        address,
        google_places_id,
        brand,
        ST_Y(location::geometry) AS lat,
        ST_X(location::geometry) AS lng
      FROM "Station"
      WHERE id = ${id}
        AND location IS NOT NULL
      LIMIT 1
    `;
    return results[0] ?? null;
  }

  async findNearbyWithDistance(
    lat: number,
    lng: number,
    radiusMeters = 200,
    limit = 5,
  ): Promise<NearbyStationWithDistance[]> {
    return this.prisma.$queryRaw<NearbyStationWithDistance[]>`
      SELECT
        id,
        name,
        address,
        google_places_id,
        brand,
        ST_Distance(location, ST_Point(${lng}, ${lat})::geography) AS distance_m
      FROM "Station"
      WHERE ST_DWithin(location, ST_Point(${lng}, ${lat})::geography, ${radiusMeters})
      ORDER BY location <-> ST_Point(${lng}, ${lat})::geography
      LIMIT ${limit}
    `;
  }

  async findStationsInArea(lat: number, lng: number, radiusMeters: number): Promise<StationInArea[]> {
    return this.prisma.$queryRaw<StationInArea[]>`
      SELECT
        id,
        name,
        address,
        google_places_id,
        brand,
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
