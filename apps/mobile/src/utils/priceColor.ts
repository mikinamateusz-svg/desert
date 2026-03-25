import type { FuelType } from '@desert/types';
import { tokens } from '../theme';
import type { StationPriceDto } from '../api/prices';

export type PriceColor = 'cheap' | 'mid' | 'expensive' | 'nodata';

export const PRICE_COLORS: Record<PriceColor, string> = {
  cheap:     tokens.price.cheap,
  mid:       tokens.price.mid,
  expensive: tokens.price.expensive,
  nodata:    tokens.price.noData,
};

export function computePriceColorMap(
  stationIds: string[],
  prices: StationPriceDto[],
  fuelType: FuelType,
): Map<string, PriceColor> {
  const result = new Map<string, PriceColor>();
  const priceByStation = new Map(prices.map(p => [p.stationId, p.prices[fuelType]]));

  const validPrices = stationIds
    .map(id => priceByStation.get(id))
    .filter((p): p is number => typeof p === 'number' && !isNaN(p));

  if (validPrices.length < 2) {
    stationIds.forEach(id => result.set(id, 'nodata'));
    return result;
  }

  const min = Math.min(...validPrices);
  const max = Math.max(...validPrices);
  const range = max - min;

  stationIds.forEach(id => {
    const price = priceByStation.get(id);
    if (price === undefined) { result.set(id, 'nodata'); return; }
    if (range === 0)         { result.set(id, 'mid'); return; }
    const ratio = (price - min) / range;
    result.set(id, ratio <= 0.33 ? 'cheap' : ratio <= 0.66 ? 'mid' : 'expensive');
  });

  return result;
}
