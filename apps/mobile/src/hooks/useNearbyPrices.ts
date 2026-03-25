import { useState, useEffect, useRef } from 'react';
import { apiGetNearbyPrices, type StationPriceDto } from '../api/prices';
import type { LocationCoords } from './useLocation';

export function useNearbyPrices(
  accessToken: string | null,
  center: LocationCoords | null,
): { prices: StationPriceDto[]; loading: boolean; error: boolean } {
  const [prices, setPrices] = useState<StationPriceDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!center || !accessToken) {
      setLoading(false);
      return;
    }

    // Cancel previous in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(false);

    void (async () => {
      try {
        const data = await apiGetNearbyPrices(
          accessToken,
          center.lat,
          center.lng,
          undefined,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setPrices(data);
        setError(false);
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
  }, [accessToken, center?.lat, center?.lng]);

  return { prices, loading, error };
}
