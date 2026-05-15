import {
  parseStoredBrands,
  isStationInFilter,
} from '../useChainFilterPreference';

describe('parseStoredBrands', () => {
  it('returns empty array for null (missing key)', () => {
    expect(parseStoredBrands(null)).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(parseStoredBrands('')).toEqual([]);
  });

  it('parses a valid JSON array of known brand codes', () => {
    expect(parseStoredBrands(JSON.stringify(['orlen', 'bp']))).toEqual([
      'orlen',
      'bp',
    ]);
  });

  it('drops unknown brand strings (forward-compat: extra value from older client)', () => {
    expect(parseStoredBrands(JSON.stringify(['orlen', 'not_a_chain', 'bp']))).toEqual([
      'orlen',
      'bp',
    ]);
  });

  it('returns empty array for malformed JSON', () => {
    expect(parseStoredBrands('{not-json')).toEqual([]);
    expect(parseStoredBrands('null')).toEqual([]);
  });

  it('returns empty array for non-array JSON values', () => {
    expect(parseStoredBrands(JSON.stringify({ orlen: true }))).toEqual([]);
    expect(parseStoredBrands(JSON.stringify('orlen'))).toEqual([]);
    expect(parseStoredBrands(JSON.stringify(42))).toEqual([]);
  });

  it('drops non-string entries embedded in an otherwise-valid array', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = JSON.stringify(['orlen', 42, null, 'shell']);
    expect(parseStoredBrands(raw)).toEqual(['orlen', 'shell']);
  });
});

describe('isStationInFilter', () => {
  it('returns true for every station when the filter is empty (no filter active)', () => {
    expect(isStationInFilter('orlen', [])).toBe(true);
    expect(isStationInFilter('bp', [])).toBe(true);
    expect(isStationInFilter('independent', [])).toBe(true);
    expect(isStationInFilter(null, [])).toBe(true);
    expect(isStationInFilter(undefined, [])).toBe(true);
  });

  it('returns true when station brand is in the selected set', () => {
    expect(isStationInFilter('orlen', ['orlen', 'bp'])).toBe(true);
    expect(isStationInFilter('bp', ['orlen', 'bp'])).toBe(true);
  });

  it('returns false when station brand is NOT in the selected set', () => {
    expect(isStationInFilter('shell', ['orlen', 'bp'])).toBe(false);
    expect(isStationInFilter('moya', ['orlen'])).toBe(false);
  });

  it('treats null / undefined brand as independent for matching', () => {
    // A null-branded station never matches a specific-chain filter unless
    // the user explicitly ticked "independent".
    expect(isStationInFilter(null, ['orlen'])).toBe(false);
    expect(isStationInFilter(null, ['independent'])).toBe(true);
    expect(isStationInFilter(undefined, ['independent'])).toBe(true);
  });

  it('is case-insensitive (defensive against capitalised brand strings from API)', () => {
    expect(isStationInFilter('ORLEN', ['orlen'])).toBe(true);
    expect(isStationInFilter('Bp', ['bp'])).toBe(true);
  });
});
