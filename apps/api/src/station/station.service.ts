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
      WHERE hidden = false
        AND ST_DWithin(location, ST_Point(${lng}, ${lat})::geography, ${radiusMeters})
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
      WHERE hidden = false
        AND ST_DWithin(location, ST_Point(${lng}, ${lat})::geography, ${radiusMeters})
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
        AND hidden = false
        AND ST_DWithin(location, ST_Point(${lng}, ${lat})::geography, ${radiusMeters})
      ORDER BY location <-> ST_Point(${lng}, ${lat})::geography
      LIMIT 500
    `;
  }

  /**
   * Story 7.1: name + address full-text search for the partner portal's
   * claim-search page. Case-insensitive substring match on name OR
   * address. Hidden stations excluded.
   *
   * Coordinates are returned so the result list can show distance hints
   * if needed; today the partner portal uses just name + address. Limit
   * is small (50) — search is strictly for "find the station I want to
   * claim", not browse.
   *
   * P3 (CR fix): ILIKE wildcards `%` and `_` in user input are escaped
   * — without this, `q=%` matches every row → full table scan + DoS.
   * Length capped at 100 chars to bound the regex work. The `@Throttle`
   * override on the controller endpoint backs this with a per-IP rate
   * limit independent of the global throttler.
   */
  async searchByName(query: string, limit = 50): Promise<StationInArea[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];
    // Reject pathologically long queries before they hit Postgres.
    if (trimmed.length > 100) return [];
    // Escape ILIKE meta-characters so user input is treated as literal
    // text. Backslash must be escaped first — order matters.
    const escaped = trimmed
      .replace(/\\/g, '\\\\')
      .replace(/%/g, '\\%')
      .replace(/_/g, '\\_');
    const pattern = `%${escaped}%`;
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
      WHERE hidden = false
        AND (name ILIKE ${pattern} OR address ILIKE ${pattern})
      ORDER BY name ASC
      LIMIT ${limit}
    `;
  }
}
