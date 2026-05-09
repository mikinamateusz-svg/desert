import { useEffect, useState, useCallback } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useAuth } from '../store/auth.store';
import { apiGetPremiumAlertsStatus } from '../api/alerts';
import { flags } from '../config/flags';

/**
 * Story 6.10 — fetches and tracks the user's premium-alerts status so the
 * bell icon on the map header can render its three states (inactive /
 * active / expiring). Refetches:
 *   - on mount + on accessToken change
 *   - whenever the app returns from background to foreground
 *
 * Refetch on submission verification events isn't wired here — instead
 * the activity-screen "alerts active until" banner (Story 6.10 AC9) reads
 * fresh data on its own mount, which naturally re-syncs when the user
 * returns to the activity surface after a contribution.
 *
 * The hook is a no-op when `flags.alertsLoop` is off — saves the network
 * call entirely on prod APKs that haven't flipped the flag.
 */
export interface PremiumAlertsState {
  /** Parsed Date or null. Null = no active window (inactive state). */
  activeUntil: Date | null;
  /** True while the very first fetch is in flight. */
  loading: boolean;
  /** Manual refetch trigger — call after a verified submission lands. */
  refetch: () => void;
}

export function usePremiumAlertsStatus(): PremiumAlertsState {
  const { accessToken } = useAuth();
  const [activeUntil, setActiveUntil] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStatus = useCallback(async () => {
    if (!flags.alertsLoop) {
      setActiveUntil(null);
      setLoading(false);
      return;
    }
    if (!accessToken) {
      setActiveUntil(null);
      setLoading(false);
      return;
    }
    try {
      const { premiumAlertsActiveUntil } = await apiGetPremiumAlertsStatus(accessToken);
      if (premiumAlertsActiveUntil) {
        const parsed = new Date(premiumAlertsActiveUntil);
        // P9 (6.10 review) — NaN guard on malformed ISO. Treat invalid
        // server data as "no premium" rather than letting NaN flow into
        // bellState comparisons (NaN <= 0 is false; NaN < window is false;
        // an invalid Date would silently classify as 'active').
        setActiveUntil(Number.isNaN(parsed.getTime()) ? null : parsed);
      } else {
        setActiveUntil(null);
      }
    } catch {
      // Silent — bell falls back to inactive state on fetch failure
      // rather than rendering an error. Better UX than a broken icon.
      setActiveUntil(null);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  // Initial fetch on mount + accessToken change
  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  // Refetch on app foreground
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') void fetchStatus();
    });
    return () => sub.remove();
  }, [fetchStatus]);

  return { activeUntil, loading, refetch: fetchStatus };
}

/**
 * Pure helper — the bell-icon state computation. Mirrors the spec's
 * three states. Called from the bell component with the current `Date.now()`
 * and the auth-store's `activeUntil` so it's both unit-testable and
 * trivially recomputable on a re-render without async work.
 */
export type BellState = 'inactive' | 'active' | 'expiring';

const EXPIRING_WINDOW_DAYS = 3;

export function bellState(activeUntil: Date | null, now: Date = new Date()): BellState {
  if (activeUntil == null) return 'inactive';
  // P9 (6.10 review) — NaN guard on the date itself. Hook should never
  // pass an invalid Date (it filters at parse time), but defend anyway
  // since this is a pure function called from multiple places.
  const activeUntilMs = activeUntil.getTime();
  if (Number.isNaN(activeUntilMs)) return 'inactive';
  const remainingMs = activeUntilMs - now.getTime();
  if (remainingMs <= 0) return 'inactive';
  if (remainingMs <= EXPIRING_WINDOW_DAYS * 86_400_000) return 'expiring';
  return 'active';
}
