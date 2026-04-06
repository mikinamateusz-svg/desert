export class StationPriceDto {
  stationId!: string;
  prices!: Record<string, number>; // keys: 'PB_95' | 'PB_98' | 'ON' | 'ON_PREMIUM' | 'LPG'
  priceRanges?: Record<string, { low: number; high: number }>;
  estimateLabel?: Record<string, 'market_estimate' | 'estimated'>;
  sources!: Record<string, 'community' | 'seeded' | 'admin_override'>; // per-fuel
  updatedAt!: string; // ISO string
}
