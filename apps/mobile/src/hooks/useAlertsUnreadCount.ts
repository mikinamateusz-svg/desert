import { useEffect, useSyncExternalStore } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useAuth } from '../store/auth.store';
import { apiGetAlerts } from '../api/alerts';
import { flags } from '../config/flags';

/**
 * Story 6.11 — shared optimistic store for the inbox unread count.
 *
 * Module-level state + `useSyncExternalStore` lets the bell icon and the
 * alerts screen stay in sync without a Provider wrapping the tree, and
 * lets either surface push optimistic updates (single mark-read decrements,
 * mark-all resets to 0) that the other observes immediately.
 *
 * The bell calls `useAlertsUnreadCountAutoRefresh()` to own the lifecycle
 * (initial fetch + foreground re-fetch); the alerts screen reads via
 * `useAlertsUnreadCount()` and mutates via the exported imperative
 * helpers when the user marks rows read.
 */
let unreadCount = 0;
const subscribers = new Set<() => void>();

const subscribe = (cb: () => void) => {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
};

const getSnapshot = () => unreadCount;

const emit = () => {
  for (const cb of subscribers) cb();
};

export function setAlertsUnreadCount(next: number): void {
  if (next === unreadCount) return;
  unreadCount = Math.max(0, next);
  emit();
}

export function decrementAlertsUnreadCount(): void {
  if (unreadCount <= 0) return;
  unreadCount = unreadCount - 1;
  emit();
}

/**
 * P7 (6.11 review) — symmetric helper to `decrementAlertsUnreadCount` for
 * use in optimistic-update rollback paths. Reading the current store
 * value here avoids the React-closure staleness bug where the inbox's
 * catch branch would compute `unreadCount + 1` from a stale snapshot
 * captured at callback creation time.
 */
export function incrementAlertsUnreadCount(): void {
  unreadCount = unreadCount + 1;
  emit();
}

export function resetAlertsUnreadCount(): void {
  if (unreadCount === 0) return;
  unreadCount = 0;
  emit();
}

export function useAlertsUnreadCount(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Owns the network-driven refresh of the unread count. Mount this once
 * in the bell-icon component (or any persistent surface) — fetching from
 * multiple consumers would just multiply requests for no benefit.
 *
 * Fetches a 1-row page (cheapest possible read that still returns the
 * `unread_count` aggregate) on mount, on accessToken change, and on app
 * foreground. When `flags.alertsLoop` is off the network call is skipped
 * entirely AND the shared store is forced to 0 — the bell shouldn't
 * render a stale count after the flag flips off mid-session.
 */
export function useAlertsUnreadCountAutoRefresh(): void {
  const { accessToken } = useAuth();

  useEffect(() => {
    let cancelled = false;

    const refetch = async () => {
      if (!flags.alertsLoop || !accessToken) {
        if (!cancelled) setAlertsUnreadCount(0);
        return;
      }
      try {
        const result = await apiGetAlerts(accessToken, 1, 1);
        if (!cancelled) setAlertsUnreadCount(result.unread_count);
      } catch {
        // Silent — keep the last known value rather than flicker to 0.
      }
    };

    void refetch();

    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') void refetch();
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [accessToken]);
}
