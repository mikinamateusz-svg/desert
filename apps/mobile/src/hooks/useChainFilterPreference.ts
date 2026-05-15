import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FILTERABLE_BRANDS, type FilterableBrand } from '../utils/brandMonogram';

// Story 2.19 — chain filter preference, stored as an array of brand
// codes. Empty array = "no filter active" (all stations full colour).
// Missing key resolves to empty array. Corrupt values fall back to
// empty array + a silent overwrite next time the user changes the
// filter — no error UI; the consequence is one extra "no filter"
// session, not a crash.
const STORAGE_KEY = '@filters:chains';

export interface UseChainFilterPreferenceResult {
  /** Selected brand codes. Empty array means "no filter active". */
  selectedBrands: FilterableBrand[];
  /** Convenience: toggle a single brand in/out of the selection. */
  toggleBrand: (brand: FilterableBrand) => void;
  /** Clear the filter (equivalent to selecting nothing). */
  clearFilter: () => void;
  /** Whether the filter is active (= at least one brand selected). */
  isFilterActive: boolean;
  /**
   * False until AsyncStorage has been read. Prevents the pin-demote
   * pass from running with an empty filter on cold start and then
   * flashing demoted pins once the stored selection lands.
   */
  loaded: boolean;
}

/**
 * Exported for testability. Validates an AsyncStorage value into the
 * canonical `FilterableBrand[]` shape. Tolerant of: missing keys (null),
 * malformed JSON, non-array shapes, unknown brand strings, and mixed
 * arrays containing some valid + some invalid entries.
 */
export function parseStoredBrands(raw: string | null): FilterableBrand[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid = new Set<string>(FILTERABLE_BRANDS);
    return parsed.filter(
      (v): v is FilterableBrand => typeof v === 'string' && valid.has(v),
    );
  } catch {
    return [];
  }
}

export function useChainFilterPreference(): UseChainFilterPreferenceResult {
  const [selectedBrands, setSelectedBrandsState] = useState<FilterableBrand[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Review patch F4 — guard the cold-start AsyncStorage apply against a
  // user-initiated toggle that fires before getItem resolves. Without
  // this, the resolved storage value clobbers the user's choice.
  const hasUserActedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (cancelled) return;
        // If the user already toggled before storage resolved, their
        // choice wins — don't overwrite it with the persisted value.
        if (hasUserActedRef.current) return;
        setSelectedBrandsState(parseStoredBrands(raw));
      })
      .catch(() => {
        // Silent — empty array is the safe default
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleBrand = useCallback((brand: FilterableBrand) => {
    hasUserActedRef.current = true;
    setSelectedBrandsState((prev) => {
      const next = prev.includes(brand)
        ? prev.filter((b) => b !== brand)
        : [...prev, brand];
      const set = new Set(next);
      const ordered = FILTERABLE_BRANDS.filter((b) => set.has(b));
      void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(ordered)).catch(() => {});
      return ordered;
    });
  }, []);

  const clearFilter = useCallback(() => {
    hasUserActedRef.current = true;
    setSelectedBrandsState([]);
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([])).catch(() => {});
  }, []);

  return {
    selectedBrands,
    toggleBrand,
    clearFilter,
    isFilterActive: selectedBrands.length > 0,
    loaded,
  };
}

/**
 * Decide whether a station's brand falls inside an active filter.
 * Used by the pin-demote pass and the detail-sheet non-match hint.
 *
 * - No filter active (`selectedBrands` empty) → every station matches
 *   (highlight mode only applies when the filter has something in it).
 * - Filter active, station brand null → treated as 'independent' for
 *   matching purposes. A null brand never matches a specific-chain
 *   selection unless the user explicitly ticked 'independent'.
 */
export function isStationInFilter(
  stationBrand: string | null | undefined,
  selectedBrands: readonly FilterableBrand[],
): boolean {
  if (selectedBrands.length === 0) return true;
  const brand = (stationBrand ?? 'independent').toLowerCase();
  // FilterableBrand is a string subtype; the readonly type lets us pass
  // it straight to includes() with a `string` check via type narrowing.
  return (selectedBrands as readonly string[]).includes(brand);
}
