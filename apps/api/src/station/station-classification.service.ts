import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BRAND_PATTERNS } from './config/brand-patterns.js';
import { resolveSettlementTier, type SettlementTierValue } from './config/settlement-data.js';

// German border crossing centroids [lat, lng]
const DE_BORDER_CROSSINGS: [number, number][] = [
  [52.35, 14.55], // Świecko / Słubice (A2)
  [51.15, 15.01], // Zgorzelec (A4)
  [53.41, 14.19], // Lubieszyn (S3)
  [51.53, 14.74], // Łęknica (DK12)
  [51.18, 15.22], // Olszyna (A18)
];
const DE_BORDER_RADIUS_KM = 30;

// Voivodeship slug normalisation — Google returns Polish names with diacritics
const VOIVODESHIP_SLUGS: Record<string, string> = {
  'dolnośląskie': 'dolnoslaskie',
  'dolnoslaskie': 'dolnoslaskie',
  'kujawsko-pomorskie': 'kujawsko-pomorskie',
  'lubelskie': 'lubelskie',
  'lubuskie': 'lubuskie',
  'łódzkie': 'lodzkie',
  'lodzkie': 'lodzkie',
  'małopolskie': 'malopolskie',
  'malopolskie': 'malopolskie',
  'mazowieckie': 'mazowieckie',
  'opolskie': 'opolskie',
  'podkarpackie': 'podkarpackie',
  'podlaskie': 'podlaskie',
  'pomorskie': 'pomorskie',
  'śląskie': 'slaskie',
  'slaskie': 'slaskie',
  'świętokrzyskie': 'swietokrzyskie',
  'swietokrzyskie': 'swietokrzyskie',
  'warmińsko-mazurskie': 'warminsko-mazurskie',
  'warminsko-mazurskie': 'warminsko-mazurskie',
  'wielkopolskie': 'wielkopolskie',
  'zachodniopomorskie': 'zachodniopomorskie',
};

interface AddressComponent {
  long_name: string;
  types: string[];
}

interface GeocodeResult {
  address_components: AddressComponent[];
}

interface GeocodeResponse {
  results: GeocodeResult[];
  status: string;
}

interface NearbySearchResult {
  name: string;
}

interface NearbySearchResponse {
  results: NearbySearchResult[];
  status: string;
}


export interface StationClassification {
  brand: string | null;
  station_type: 'standard' | 'mop';
  voivodeship: string | null;
  settlement_tier: SettlementTierValue;
  is_border_zone_de: boolean;
}

export interface StationForClassification {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

@Injectable()
export class StationClassificationService {
  private readonly logger = new Logger(StationClassificationService.name);

  constructor(private readonly config: ConfigService) {}

  extractBrand(name: string | null): string | null {
    if (!name) return null;
    for (const { pattern, brand } of BRAND_PATTERNS) {
      if (pattern.test(name)) return brand;
    }
    return 'independent';
  }

  async detectMop(lat: number, lng: number, apiKey: string): Promise<boolean> {
    const url = new URL('https://maps.googleapis.com/maps/api/place/nearbysearch/json');
    url.searchParams.set('location', `${lat},${lng}`);
    url.searchParams.set('radius', '300');
    url.searchParams.set('keyword', 'MOP');
    url.searchParams.set('key', apiKey);

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Nearby Search HTTP error: ${res.status}`);

    const data = (await res.json()) as NearbySearchResponse;
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      throw new Error(`Nearby Search API status: ${data.status}`);
    }

    return data.results.some((r) => /mop/i.test(r.name));
  }

  async resolveGeocode(
    lat: number,
    lng: number,
    apiKey: string,
  ): Promise<{ voivodeship: string | null; locality: string | null }> {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('latlng', `${lat},${lng}`);
    url.searchParams.set('result_type', 'administrative_area_level_1|locality');
    url.searchParams.set('key', apiKey);

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Geocoding HTTP error: ${res.status}`);

    const data = (await res.json()) as GeocodeResponse;
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      throw new Error(`Geocoding API status: ${data.status}`);
    }

    let voivodeship: string | null = null;
    let locality: string | null = null;

    for (const result of data.results) {
      for (const component of result.address_components) {
        if (component.types.includes('administrative_area_level_1') && !voivodeship) {
          const raw = component.long_name.toLowerCase();
          voivodeship = VOIVODESHIP_SLUGS[raw] ?? raw;
        }
        if (component.types.includes('locality') && !locality) {
          locality = component.long_name;
        }
      }
      if (voivodeship && locality) break;
    }

    return { voivodeship, locality };
  }

  isGermanBorderZone(lat: number, lng: number): boolean {
    return DE_BORDER_CROSSINGS.some(
      ([bLat, bLng]) => haversineKm(lat, lng, bLat, bLng) <= DE_BORDER_RADIUS_KM,
    );
  }

  async classifyStation(
    station: StationForClassification,
    apiKey: string,
  ): Promise<StationClassification> {
    const [isMop, geocode] = await Promise.all([
      this.detectMop(station.lat, station.lng, apiKey),
      this.resolveGeocode(station.lat, station.lng, apiKey),
    ]);

    return {
      brand: this.extractBrand(station.name),
      station_type: isMop ? 'mop' : 'standard',
      voivodeship: geocode.voivodeship,
      settlement_tier: resolveSettlementTier(geocode.locality),
      is_border_zone_de: this.isGermanBorderZone(station.lat, station.lng),
    };
  }
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
