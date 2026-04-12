import { haversineMetres } from '../haversine';

describe('haversineMetres', () => {
  it('returns 0 for identical coordinates', () => {
    expect(haversineMetres(52.23, 21.01, 52.23, 21.01)).toBe(0);
  });

  it('calculates correct distance between Warsaw and Lodz (~120km)', () => {
    // Warsaw: 52.2297, 21.0122  Lodz: 51.7592, 19.4560
    const distance = haversineMetres(52.2297, 21.0122, 51.7592, 19.456);
    expect(distance).toBeGreaterThan(115_000);
    expect(distance).toBeLessThan(125_000);
  });

  it('calculates short distance between two nearby stations (~1km)', () => {
    // Two points ~1km apart in Warsaw
    const distance = haversineMetres(52.23, 21.01, 52.239, 21.01);
    expect(distance).toBeGreaterThan(900);
    expect(distance).toBeLessThan(1100);
  });
});
