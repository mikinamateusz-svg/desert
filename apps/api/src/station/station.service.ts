import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface NearbyStation {
  id: string;
  name: string;
  address: string | null;
  google_places_id: string | null;
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
}
