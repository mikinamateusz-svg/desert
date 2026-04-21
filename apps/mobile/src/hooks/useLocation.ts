import { useState, useEffect } from 'react';
import * as Location from 'expo-location';

export type LocationCoords = { lat: number; lng: number };

/** Distance (metres) between updates — keeps battery impact low but still reacts
 *  to real movement. The capture screen needs this so the nearest-station banner
 *  doesn't stay stale while biking past multiple stations. */
const DISTANCE_INTERVAL_M = 15;
/** Minimum wall-clock gap between updates (ms) — belt-and-braces against chatty
 *  GPS hardware firing on every tiny float jitter. */
const TIME_INTERVAL_MS = 4000;

/**
 * Subscribes to the device GPS while the consuming component is mounted.
 * Emits a new coordinate whenever the user moves >~15 m or every ~4 s.
 * Previous implementation used `getCurrentPositionAsync` once on mount, which
 * caused the capture screen to show stale matches while moving — see Story 3.11
 * alpha field test.
 */
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
    let subscription: Location.LocationSubscription | null = null;
    // Once the watch subscription has produced a fix, the seed (which may still
    // be in flight) must not overwrite it with an older coordinate.
    let watchHasFired = false;

    void (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;

        if (status !== 'granted') {
          setPermissionDenied(true);
          setLoading(false);
          return;
        }

        // Seed immediately so consumers get a position without waiting for the
        // first watch callback — first fix on a cold GPS can take a few seconds.
        try {
          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          if (!cancelled && !watchHasFired) {
            setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          }
        } catch {
          // Initial fix failed — watch callbacks will populate once GPS warms up.
        }

        // Live updates. `distanceInterval` is the important one — it gates
        // updates behind real movement rather than time.
        subscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            distanceInterval: DISTANCE_INTERVAL_M,
            timeInterval: TIME_INTERVAL_MS,
          },
          pos => {
            if (cancelled) return;
            watchHasFired = true;
            setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          },
        );
      } catch {
        // GPS error — location stays null; consumers fall back (e.g. Warsaw default).
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, []);

  return { location, permissionDenied, loading };
}
