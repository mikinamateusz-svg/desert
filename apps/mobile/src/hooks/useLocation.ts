import { useState, useEffect, useRef, useCallback } from 'react';
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
 *
 * Story 3.20 — also exposes `firstFixAtMs` (Date.now() of the first non-null
 * fix, or null if not yet acquired) so the capture screen can compute
 * `gps_acquisition_ms` telemetry. Captured once on the first fix per the
 * "acquisition window" defined by `resetFirstFix()` — callers (capture screen
 * focus effect) call that to start a new measurement window when the user
 * returns to the screen, otherwise the prior session's timestamp would carry
 * over and produce a negative `gps_acquisition_ms` against a fresh mount
 * timestamp.
 */
export function useLocation(): {
  location: LocationCoords | null;
  permissionDenied: boolean;
  loading: boolean;
  firstFixAtMs: number | null;
  /** Story 3.20 — restart the first-fix measurement window. Capture screen
   *  calls this from useFocusEffect so the next GPS fix produces a fresh
   *  `firstFixAtMs` relative to that focus moment. */
  resetFirstFix: () => void;
} {
  const [location, setLocation] = useState<LocationCoords | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [firstFixAtMs, setFirstFixAtMs] = useState<number | null>(null);
  // Mutable ref tracks whether the *current* acquisition window has already
  // captured a first fix. resetFirstFix flips it false so the next fix
  // arriving (or already-current fix being re-emitted on movement) records
  // a new firstFixAtMs.
  const firstFixCapturedRef = useRef(false);

  const resetFirstFix = useCallback(() => {
    firstFixCapturedRef.current = false;
    setFirstFixAtMs(null);
    // If GPS is already locked at the moment of reset (re-focus on a
    // long-mounted hook), record the reset moment itself as the "fix"
    // timestamp so the caller's gpsAcquisitionMs computes 0 (instant
    // acquisition) instead of staying null until the next watch event,
    // which only fires on movement and could be many seconds away.
    if (location) {
      firstFixCapturedRef.current = true;
      setFirstFixAtMs(Date.now());
    }
  }, [location]);

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
            if (!firstFixCapturedRef.current) {
              firstFixCapturedRef.current = true;
              setFirstFixAtMs(Date.now());
            }
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
            if (!firstFixCapturedRef.current) {
              firstFixCapturedRef.current = true;
              setFirstFixAtMs(Date.now());
            }
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

  return { location, permissionDenied, loading, firstFixAtMs, resetFirstFix };
}
