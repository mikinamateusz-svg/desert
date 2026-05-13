export class StationPriceDto {
  stationId!: string;
  prices!: Record<string, number>; // keys: 'PB_95' | 'PB_98' | 'ON' | 'ON_PREMIUM' | 'LPG'
  priceRanges?: Record<string, { low: number; high: number }>;
  estimateLabel?: Record<string, 'market_estimate' | 'estimated'>;
  sources!: Record<string, 'community' | 'seeded' | 'admin_override'>; // per-fuel
  /**
   * Story 2.17 — per-fuel rack-staleness flag. `true` for a fuel means
   * the rack has moved against this station × fuel since the last
   * verified price; mobile UI renders a grey dot + warning tooltip.
   * Optional — absent === no fuel is stale (mobile treats absent as
   * all-false rather than unknown). See `StationPriceRow.stalenessFlags`
   * for the service-side shape.
   */
  stalenessFlags?: Record<string, boolean>;
  updatedAt!: string; // ISO string
}
