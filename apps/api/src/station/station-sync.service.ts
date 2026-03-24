import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';

interface PlacesResult {
  place_id: string;
  name: string;
  vicinity: string;
  geometry: { location: { lat: number; lng: number } } | null;
}

interface PlacesResponse {
  results: PlacesResult[];
  next_page_token?: string;
  status: string;
}

@Injectable()
export class StationSyncService {
  private readonly logger = new Logger(StationSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async runSync(): Promise<void> {
    const apiKey = this.config.getOrThrow<string>('GOOGLE_PLACES_API_KEY');
    const gridPoints = this.buildPolandGrid();
    let upserted = 0;
    let failed = 0;

    for (let i = 0; i < gridPoints.length; i++) {
      // P3: 200ms inter-grid delay to avoid hammering Places API
      if (i > 0) {
        await new Promise(r => setTimeout(r, 200));
      }

      const [lat, lng] = gridPoints[i];

      // P1: per-point error isolation — log and skip, don't abort the whole sync
      try {
        const stations = await this.fetchStationsAtPoint(lat, lng, apiKey);
        for (const s of stations) {
          // P7: skip stations without geometry
          if (!s.geometry?.location) {
            this.logger.warn(`Skipping station "${s.name}" (${s.place_id}): missing geometry`);
            continue;
          }
          await this.upsertStation(s as PlacesResult & { geometry: { location: { lat: number; lng: number } } });
          upserted++;
        }
      } catch (err) {
        failed++;
        this.logger.warn(
          `Grid point [${lat}, ${lng}] failed — skipping (${failed} failed so far)`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    this.logger.log(`Sync complete: ${upserted} station records processed, ${failed} grid points failed`);
  }

  buildPolandGrid(): [number, number][] {
    // P2: 25km grid over Poland bbox (lat 49.0–54.9, lng 14.1–24.2)
    // ~0.22° lat ≈ 25km; ~0.32° lng ≈ 25km at Polish latitudes
    // Radius reduced to 25000m to avoid the 60-result cap in dense cities
    const points: [number, number][] = [];
    for (let lat = 49.2; lat <= 54.8; lat += 0.22) {
      for (let lng = 14.2; lng <= 24.1; lng += 0.32) {
        points.push([
          Math.round(lat * 1000) / 1000,
          Math.round(lng * 1000) / 1000,
        ]);
      }
    }
    return points;
  }

  async fetchStationsAtPoint(lat: number, lng: number, apiKey: string): Promise<PlacesResult[]> {
    const results: PlacesResult[] = [];
    let pageToken: string | undefined;

    do {
      // P4: classic Places Nearby Search requires `key` as a URL query param —
      // X-Goog-Api-Key header is NOT supported by this endpoint (New Places API only).
      const url = new URL('https://maps.googleapis.com/maps/api/place/nearbysearch/json');
      url.searchParams.set('location', `${lat},${lng}`);
      url.searchParams.set('radius', '25000'); // P2: reduced from 50000
      url.searchParams.set('type', 'gas_station');
      url.searchParams.set('key', apiKey);
      if (pageToken) {
        url.searchParams.set('pagetoken', pageToken);
        // Google requires ~2s delay before requesting next_page_token
        await new Promise(r => setTimeout(r, 2000));
      }

      const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`Places API HTTP error: ${res.status}`);

      const data = await res.json() as PlacesResponse;
      if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
        throw new Error(`Places API status: ${data.status}`);
      }

      results.push(...data.results);
      pageToken = data.next_page_token;
    } while (pageToken);

    return results;
  }

  async upsertStation(s: PlacesResult & { geometry: { location: { lat: number; lng: number } } }): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO "Station" (id, name, address, google_places_id, location, last_synced_at, created_at, updated_at)
      VALUES (
        gen_random_uuid()::text,
        ${s.name},
        ${s.vicinity},
        ${s.place_id},
        ST_Point(${s.geometry.location.lng}, ${s.geometry.location.lat})::geography,
        NOW(),
        NOW(),
        NOW()
      )
      ON CONFLICT (google_places_id) DO UPDATE SET
        name = EXCLUDED.name,
        address = EXCLUDED.address,
        location = EXCLUDED.location,
        last_synced_at = NOW(),
        updated_at = NOW()
    `;
  }
}
