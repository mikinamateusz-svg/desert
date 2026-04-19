import { useState, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiGetNearbyStations, type StationDto } from '../api/stations';
import type { LocationCoords } from './useLocation';

const CACHE_KEY = 'desert.stations_cache';

// In-memory coord-keyed cache to skip refetches when panning back to a recent area.
// Key rounds coords to ~1.1km grid (P-2: token-scoped to prevent cross-account leak).
const COORD_CACHE_TTL_MS = 5 * 60 * 1000;
const coordCache = new Map<string, { data: StationDto[]; ts: number }>();
const coordKey = (lat: number, lng: number, token: string | null) =>
  `${token ?? 'guest'}|${lat.toFixed(2)}_${lng.toFixed(2)}`;

export function useNearbyStations(
  accessToken: string | null,
  center: LocationCoords | null,
): { stations: StationDto[]; loading: boolean; error: boolean } {
  const [stations, setStations] = useState<StationDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Load cache on mount for instant display — only apply if no fresh data has arrived yet
  useEffect(() => {
    void AsyncStorage.getItem(CACHE_KEY).then(raw => {
      if (raw) {
        try {
          const cached = JSON.parse(raw) as StationDto[];
          setStations(prev => (prev.length === 0 ? cached : prev));
        } catch {
          // Ignore corrupt cache
        }
      }
    });
  }, []);

  useEffect(() => {
    if (!center) return;
    // P-4: guard against NaN/Infinity coords producing a shared cache key
    if (!Number.isFinite(center.lat) || !Number.isFinite(center.lng)) return;

    // P-1: cancel any previous in-flight fetch before serving from cache,
    // otherwise a stale response can resolve later and clobber the cached merge.
    abortRef.current?.abort();

    // Cache hit: skip the network call entirely and merge cached stations.
    const cached = coordCache.get(coordKey(center.lat, center.lng, accessToken));
    if (cached && Date.now() - cached.ts < COORD_CACHE_TTL_MS) {
      setStations(prev => {
        const map = new Map(prev.map(s => [s.id, s]));
        for (const s of cached.data) map.set(s.id, s);
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
        const data = await apiGetNearbyStations(
          accessToken,
          center.lat,
          center.lng,
          undefined,
          controller.signal,
        );
        if (controller.signal.aborted) return;

        // Merge new stations with existing ones so pins don't vanish
        // while panning — stations from previous viewports stay in memory
        setStations(prev => {
          const map = new Map(prev.map(s => [s.id, s]));
          for (const s of data) map.set(s.id, s);
          return Array.from(map.values());
        });
        setError(false);
        // P-3: don't cache empty results — masks transient API failures for full TTL
        if (data.length > 0) {
          coordCache.set(coordKey(center.lat, center.lng, accessToken), { data, ts: Date.now() });
          await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(data));
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        // Silent degradation if we have cached stations; error state if not
        setStations(prev => {
          if (prev.length === 0) setError(true);
          return prev;
        });
        console.warn('[useNearbyStations] fetch failed:', err instanceof Error ? err.message : String(err));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [accessToken, center?.lat, center?.lng]);

  return { stations, loading, error };
}
