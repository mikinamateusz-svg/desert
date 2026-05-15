import {
  brandMonogram,
  FILTERABLE_BRANDS,
  type FilterableBrand,
} from '../brandMonogram';

describe('brandMonogram', () => {
  it('returns the 2-char monogram for known brands', () => {
    expect(brandMonogram('orlen')).toBe('OR');
    expect(brandMonogram('bp')).toBe('BP');
    expect(brandMonogram('shell')).toBe('SH');
    expect(brandMonogram('lotos')).toBe('LO');
    expect(brandMonogram('circle_k')).toBe('CK');
    expect(brandMonogram('moya')).toBe('MO');
    expect(brandMonogram('amic')).toBe('AM');
    expect(brandMonogram('avia')).toBe('AV');
    expect(brandMonogram('auchan')).toBe('AU');
    expect(brandMonogram('pieprzyk')).toBe('PI');
    expect(brandMonogram('huzar')).toBe('HU');
    expect(brandMonogram('carrefour')).toBe('CA');
  });

  it('is case-insensitive', () => {
    expect(brandMonogram('Orlen')).toBe('OR');
    expect(brandMonogram('ORLEN')).toBe('OR');
    expect(brandMonogram('Circle_K')).toBe('CK');
  });

  it('returns null for independent (no monogram — absence is the signal)', () => {
    expect(brandMonogram('independent')).toBeNull();
  });

  it('returns null for unknown brand strings', () => {
    expect(brandMonogram('unknown')).toBeNull();
    expect(brandMonogram('not_a_real_chain')).toBeNull();
  });

  it('returns null for null / undefined / empty', () => {
    expect(brandMonogram(null)).toBeNull();
    expect(brandMonogram(undefined)).toBeNull();
    expect(brandMonogram('')).toBeNull();
  });
});

describe('FILTERABLE_BRANDS', () => {
  it('includes every brand that has a monogram, plus independent', () => {
    // Every entry either has a monogram or is the explicit "independent" tail.
    for (const b of FILTERABLE_BRANDS) {
      if (b === 'independent') {
        expect(brandMonogram(b)).toBeNull();
      } else {
        // Type assertion just narrows the parameter; the runtime call is identical.
        expect(brandMonogram(b as FilterableBrand)).not.toBeNull();
      }
    }
  });

  it('lists independent last so the filter sheet renders it as the trailing row', () => {
    expect(FILTERABLE_BRANDS[FILTERABLE_BRANDS.length - 1]).toBe('independent');
  });
});
