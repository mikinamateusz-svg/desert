import { useState, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiGetNearbyStations, type StationDto } from '../api/stations';
import type { LocationCoords } from './useLocation';

const CACHE_KEY = 'desert.stations_cache';

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
    if (!center || !accessToken) return;

    // Cancel previous in-flight request
    abortRef.current?.abort();
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

        setStations(data);
        setError(false);
        await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(data));
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
