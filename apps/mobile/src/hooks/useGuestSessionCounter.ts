import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SESSION_DATES_KEY = '@guest:session:dates';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Story 6.9 — counts guest app-open sessions within a rolling 7-day
 * window. Used to gate the engagement card (AC1: 3+ opens in 7 days).
 *
 * On mount: reads the stored timestamps, trims entries older than 7
 * days, appends the current session timestamp, writes back. Returns
 * the new total. Failure-tolerant — if AsyncStorage misbehaves, the
 * count just stays at 0 and the engagement card won't fire.
 *
 * The hook is mount-once-per-screen-mount by design. The map screen
 * mounts at most once per app foreground (Expo Router preserves it
 * during navigation back); rapid screen-mount cycles would
 * over-count. Spec accepts this as an MVP simplification.
 */
export function useGuestSessionCounter(): { sessionCount: number } {
  const [sessionCount, setSessionCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(SESSION_DATES_KEY);
        const stored: unknown = raw ? JSON.parse(raw) : [];
        const arr = Array.isArray(stored) ? (stored as string[]) : [];
        const cutoff = Date.now() - SEVEN_DAYS_MS;
        const recent = arr.filter((d) => {
          const t = new Date(d).getTime();
          return Number.isFinite(t) && t > cutoff;
        });
        recent.push(new Date().toISOString());
        await AsyncStorage.setItem(SESSION_DATES_KEY, JSON.stringify(recent));
        if (!cancelled) setSessionCount(recent.length);
      } catch {
        // Silent — broken AsyncStorage just suppresses the engagement
        // card. The market-event banner has its own path so the user
        // still has a conversion surface.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { sessionCount };
}
