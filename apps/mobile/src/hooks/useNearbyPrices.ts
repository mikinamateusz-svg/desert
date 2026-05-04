import { useState, useEffect, useRef, useCallback } from 'react';
import { apiGetNearbyPrices, type StationPriceDto } from '../api/prices';
import type { LocationCoords } from './useLocation';

// In-memory coord-keyed cache to skip refetches when panning back to a recent area.
// Shorter TTL than stations because prices change more often.
// (P-2: token-scoped to prevent cross-account leak.)
const COORD_CACHE_TTL_MS = 2 * 60 * 1000;
const coordCache = new Map<string, { data: StationPriceDto[]; ts: number }>();
const coordKey = (lat: number, lng: number, token: string | null) =>
  `${token ?? 'guest'}|${lat.toFixed(2)}_${lng.toFixed(2)}`;

export function useNearbyPrices(
  accessToken: string | null,
  center: LocationCoords | null,
): { prices: StationPriceDto[]; loading: boolean; error: boolean; refresh: () => void } {
  const [prices, setPrices] = useState<StationPriceDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  // Force a fresh fetch by clearing the current-center cache entry and bumping
  // the effect's dep tick. Used by the map screen on focus + 60s poll so the
  // user sees their own contribution and other live updates without panning.
  const refresh = useCallback(() => {
    if (center && Number.isFinite(center.lat) && Number.isFinite(center.lng)) {
      coordCache.delete(coordKey(center.lat, center.lng, accessToken));
    }
    setRefreshTick(t => t + 1);
  }, [accessToken, center?.lat, center?.lng]);

  useEffect(() => {
    if (!center) {
      setLoading(false);
      return;
    }
    // P-4: guard against NaN/Infinity coords producing a shared cache key
    if (!Number.isFinite(center.lat) || !Number.isFinite(center.lng)) {
      setLoading(false);
      return;
    }

    // P-1: cancel any previous in-flight fetch before serving from cache,
    // otherwise a stale response can resolve later and clobber the cached merge.
    abortRef.current?.abort();

    // Cache hit: skip the network call entirely and merge cached prices.
    const cached = coordCache.get(coordKey(center.lat, center.lng, accessToken));
    if (cached && Date.now() - cached.ts < COORD_CACHE_TTL_MS) {
      setPrices(prev => {
        const map = new Map(prev.map(p => [p.stationId, p]));
        for (const p of cached.data) map.set(p.stationId, p);
        return Array.from(map.values());
      });
      setError(false);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(false);

    void (async () => {
      try {
        const data = await apiGetNearbyPrices(
          accessToken ?? null,
          center.lat,
          center.lng,
          undefined,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        // Merge new prices with existing — keeps prices for stations
        // from previous viewports so pins don't lose their colours
        setPrices(prev => {
          const map = new Map(prev.map(p => [p.stationId, p]));
          for (const p of data) map.set(p.stationId, p);
          return Array.from(map.values());
        });
        setError(false);
        // P-3: don't cache empty results — masks transient API failures for full TTL
        if (data.length > 0) {
          coordCache.set(coordKey(center.lat, center.lng, accessToken), { data, ts: Date.now() });
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(true);
        console.warn('[useNearbyPrices] fetch failed:', err instanceof Error ? err.message : String(err));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [accessToken, center?.lat, center?.lng, refreshTick]);

  return { prices, loading, error, refresh };
}
