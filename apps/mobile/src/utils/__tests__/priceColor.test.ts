import { computePriceColorMap } from '../priceColor';
import type { StationPriceDto } from '../../api/prices';

const makePrice = (stationId: string, pb95?: number, range?: { low: number; high: number }): StationPriceDto => ({
  stationId,
  prices: pb95 !== undefined ? { PB_95: pb95 } : {},
  ...(range ? { priceRanges: { PB_95: range } } : {}),
  sources: {},
  updatedAt: new Date().toISOString(),
});

describe('computePriceColorMap', () => {
  it('returns nodata for all stations when fewer than 2 have prices', () => {
    const ids = ['s1', 's2'];
    const prices = [makePrice('s1', 5.89)];
    const result = computePriceColorMap(ids, prices, 'PB_95');
    expect(result.get('s1')).toBe('nodata');
    expect(result.get('s2')).toBe('nodata');
  });

  it('assigns cheap/mid/expensive based on price spread', () => {
    const ids = ['s1', 's2', 's3'];
    const prices = [
      makePrice('s1', 5.50), // cheapest
      makePrice('s2', 5.80), // mid
      makePrice('s3', 6.10), // most expensive
    ];
    const result = computePriceColorMap(ids, prices, 'PB_95');
    expect(result.get('s1')).toBe('cheap');
    expect(result.get('s2')).toBe('mid');
    expect(result.get('s3')).toBe('expensive');
  });

  it('assigns mid when all prices are equal', () => {
    const ids = ['s1', 's2'];
    const prices = [makePrice('s1', 5.89), makePrice('s2', 5.89)];
    const result = computePriceColorMap(ids, prices, 'PB_95');
    expect(result.get('s1')).toBe('mid');
    expect(result.get('s2')).toBe('mid');
  });

  it('uses range midpoint for estimated prices', () => {
    const ids = ['s1', 's2'];
    const prices = [
      makePrice('s1', 5.50),
      makePrice('s2', undefined, { low: 5.80, high: 6.20 }), // midpoint = 6.00
    ];
    const result = computePriceColorMap(ids, prices, 'PB_95');
    expect(result.get('s1')).toBe('cheap');
    expect(result.get('s2')).toBe('expensive');
  });

  it('returns nodata for stations without prices', () => {
    const ids = ['s1', 's2', 's3'];
    const prices = [
      makePrice('s1', 5.50),
      makePrice('s2', 6.00),
      // s3 has no price data
    ];
    const result = computePriceColorMap(ids, prices, 'PB_95');
    expect(result.get('s3')).toBe('nodata');
  });
});
