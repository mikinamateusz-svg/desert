// Server-side only — do not import this file in Client Components

const API_URL = process.env.INTERNAL_API_URL ?? 'http://localhost:3000';

export interface StationDto {
  id: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
}

export interface StationPriceDto {
  stationId: string;
  prices: Partial<Record<string, number>>;
  priceRanges?: Partial<Record<string, { low: number; high: number }>>;
  estimateLabel?: Partial<Record<string, string>>;
  sources: Partial<Record<string, string>>;
  updatedAt: string;
}

export interface StationWithPrice extends StationDto {
  price: StationPriceDto | null;
}

export async function fetchStationsWithPrices(
  lat: number,
  lng: number,
  radius: number,
): Promise<StationWithPrice[]> {
  const [stations, prices] = await Promise.all([
    fetch(`${API_URL}/v1/stations/nearby?lat=${lat}&lng=${lng}&radius=${radius}`, {
      next: { revalidate: 600 },
    }).then(r => {
      if (!r.ok) return [] as StationDto[];
      return r.json() as Promise<StationDto[]>;
    }),
    fetch(`${API_URL}/v1/prices/nearby?lat=${lat}&lng=${lng}&radius=${radius}`, {
      next: { revalidate: 600 },
    }).then(r => {
      if (!r.ok) return [] as StationPriceDto[];
      return r.json() as Promise<StationPriceDto[]>;
    }),
  ]);

  const priceMap = new Map(prices.map(p => [p.stationId, p]));
  return stations.map(s => ({ ...s, price: priceMap.get(s.id) ?? null }));
}
