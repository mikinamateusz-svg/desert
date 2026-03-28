// Server-side only — do not import this file in Client Components

function normalizeApiUrl(raw: string | undefined): string {
  const url = raw ?? 'http://localhost:3000';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `https://${url}`;
}

const API_URL = normalizeApiUrl(process.env.INTERNAL_API_URL);

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

export async function fetchStationWithPrice(id: string): Promise<StationWithPrice | null> {
  const stationRes = await fetch(`${API_URL}/v1/stations/${encodeURIComponent(id)}`, {
    next: { revalidate: 600 },
  });
  if (!stationRes.ok) return null;
  const station = await stationRes.json() as StationDto;

  // Fetch prices via nearby with tight radius around the station
  const priceRes = await fetch(
    `${API_URL}/v1/prices/nearby?lat=${station.lat}&lng=${station.lng}&radius=200`,
    { next: { revalidate: 600 } },
  );
  const nearbyPrices: StationPriceDto[] = priceRes.ok ? await priceRes.json() : [];
  const price = nearbyPrices.find(p => p.stationId === id) ?? null;

  return { ...station, price };
}
