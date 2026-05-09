import { useEffect, useState } from 'react';
import { useAuth } from '../store/auth.store';
import { useNotificationPermission } from '../hooks/useNotificationPermission';
import { apiGetSummaryReprompt } from '../api/notifications';
import { NotificationRepromptSheet } from './NotificationRepromptSheet';
import {
  REPROMPT_MONTHLY_KEY,
  shouldSkipAllReprompts,
  hasShownReprompt,
  recordRepromptShown,
} from './repromptStorage';

/**
 * Story 6.6 — root-level trigger for the monthly-summary smart re-prompt.
 *
 * Lives at the (app) layout so the sheet can surface on any tab once the
 * driver opens the app and:
 *   - is signed in
 *   - has not granted OS notification permission
 *   - hasn't already seen the monthly re-prompt
 *   - hasn't already been shown the photo + monthly pair (two-strike, AC4)
 *   - has a Story 6.5 monthly-summary-calculated key in Redis (server-side)
 *
 * The backend tells us via `pending: true` only when ALL server-side
 * conditions are met (no token + Redis key exists), so the client only
 * has to guard the AsyncStorage flags + permission status.
 *
 * Renders nothing visible until the API confirms a re-prompt is due.
 */
export function MonthlySummaryRepromptTrigger() {
  const { accessToken } = useAuth();
  const { status: permissionStatus, isChecking: permissionChecking } = useNotificationPermission();
  const [savedPln, setSavedPln] = useState<number | null | undefined>(undefined);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!accessToken) return;
    // Only fire for undetermined permission — see confirm.tsx for the
    // iOS dead-button rationale. 'denied' users are handled by the
    // re-prompt UI in alerts.tsx with a Settings deep-link.
    if (permissionChecking || permissionStatus !== 'undetermined') return;
    let cancelled = false;
    void (async () => {
      if (await shouldSkipAllReprompts()) return;
      if (await hasShownReprompt(REPROMPT_MONTHLY_KEY)) return;
      let result;
      try {
        result = await apiGetSummaryReprompt(accessToken);
      } catch {
        return; // network/auth hiccup — try again on next mount
      }
      if (cancelled || !result.pending) return;
      // Re-check live permission — user may have granted via a deep-link
      // / Settings round-trip during the API call window.
      if (permissionStatus !== 'undetermined') return;
      // Record-on-show, not on-dismiss: protects against the user
      // killing the app mid-sheet, which would re-show on next open.
      await recordRepromptShown(REPROMPT_MONTHLY_KEY);
      if (cancelled) return;
      setSavedPln(result.savedPln);
      setVisible(true);
    })();
    return () => {
      cancelled = true;
    };
    // accessToken intentionally excluded from deps: the trigger should
    // run at most once per mount. Token rotation re-renders the layout
    // but mustn't re-fire this effect (the AsyncStorage flag would
    // short-circuit it but the API call would still hit on every
    // rotation, wastefully).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permissionStatus, permissionChecking]);

  if (savedPln === undefined) return null;
  return (
    <NotificationRepromptSheet
      visible={visible}
      variant="monthly"
      savedPln={savedPln}
      onDismiss={() => setVisible(false)}
    />
  );
}
