import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { getFailedCount, getPendingCount } from '../services/queueDb';

/** Returns the current SQLite queue counts, refreshed every 5 s and on foreground. */
export function useQueueCount(): { pending: number; failed: number } {
  const [counts, setCounts] = useState({ pending: 0, failed: 0 });

  useEffect(() => {
    function refresh() {
      setCounts({ pending: getPendingCount(), failed: getFailedCount() });
    }

    refresh();
    const interval = setInterval(refresh, 5_000);
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') refresh();
    });

    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, []);

  return counts;
}
