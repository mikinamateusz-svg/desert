import { useState, useEffect } from 'react';
import * as Location from 'expo-location';

export type LocationCoords = { lat: number; lng: number };

export function useLocation(): {
  location: LocationCoords | null;
  permissionDenied: boolean;
  loading: boolean;
} {
  const [location, setLocation] = useState<LocationCoords | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;

        if (status !== 'granted') {
          setPermissionDenied(true);
          setLoading(false);
          return;
        }

        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (cancelled) return;

        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      } catch {
        // GPS error — location stays null, map uses fallback centre
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return { location, permissionDenied, loading };
}
