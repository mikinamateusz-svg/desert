import type { FuelType } from '@desert/types';
import { tokens } from '../theme';
import type { StationPriceDto } from '../api/prices';

export type PriceColor = 'cheapest' | 'cheap' | 'mid' | 'pricey' | 'expensive' | 'nodata';

export const PRICE_COLORS: Record<PriceColor, string> = {
  cheapest:  tokens.price.cheapest,
  cheap:     tokens.price.cheap,
  mid:       tokens.price.mid,
  pricey:    tokens.price.pricey,
  expensive: tokens.price.expensive,
  nodata:    tokens.price.noData,
};

/** Minimum price spread (PLN) to distinguish quintiles. Below this, all stations show as 'mid'. */
const MIN_SPREAD_PLN = 0.10;

/**
 * Compute price color for each station using cluster-aware quintile ranking.
 *
 * - If the price spread is < MIN_SPREAD_PLN, all stations get 'mid' (no meaningful difference).
 * - Otherwise, stations are sorted by price and assigned to quintiles by rank.
 * - Stations without price data get 'nodata'.
 */
export function computePriceColorMap(
  stationIds: string[],
  prices: StationPriceDto[],
  fuelType: FuelType,
): Map<string, PriceColor> {
  const result = new Map<string, PriceColor>();

  // Use reported price when available, fall back to range midpoint for estimated stations
  const priceByStation = new Map(prices.map(p => {
    const reported = p.prices[fuelType];
    if (reported !== undefined) return [p.stationId, reported] as const;
    const range = p.priceRanges?.[fuelType];
    if (range) return [p.stationId, (range.low + range.high) / 2] as const;
    return [p.stationId, undefined] as const;
  }));

  // Collect stations that have a valid price
  const withPrice: { id: string; price: number }[] = [];
  for (const id of stationIds) {
    const price = priceByStation.get(id);
    if (typeof price === 'number' && !isNaN(price)) {
      withPrice.push({ id, price });
    } else {
      result.set(id, 'nodata');
    }
  }

  if (withPrice.length < 2) {
    withPrice.forEach(s => result.set(s.id, 'nodata'));
    return result;
  }

  // Cluster guard: if all prices are within MIN_SPREAD_PLN, show all as 'mid'
  const min = Math.min(...withPrice.map(s => s.price));
  const max = Math.max(...withPrice.map(s => s.price));
  if (max - min < MIN_SPREAD_PLN) {
    withPrice.forEach(s => result.set(s.id, 'mid'));
    return result;
  }

  // Sort by price ascending and assign quintiles by percentile rank
  withPrice.sort((a, b) => a.price - b.price);
  const count = withPrice.length;

  const QUINTILES: PriceColor[] = ['cheapest', 'cheap', 'mid', 'pricey', 'expensive'];

  for (let i = 0; i < count; i++) {
    const rank = i / (count - 1); // 0.0 = cheapest, 1.0 = most expensive
    const bucket = Math.min(Math.floor(rank * 5), 4);
    result.set(withPrice[i]!.id, QUINTILES[bucket]!);
  }

  return result;
}
