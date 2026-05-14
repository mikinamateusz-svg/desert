import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { useAuth } from '../store/auth.store';
import { apiRegisterGuestPushToken } from '../api/guest-nudge';

/**
 * Story 6.9 — registers the guest's Expo push token with the backend
 * when the user is a guest (skipped onboarding, no session token) AND
 * push permission has already been granted. The previous registration
 * may have happened in the alerts loop (an authenticated user who
 * signed out becomes a guest with a still-valid token); this fire-and-
 * forget upsert ensures the guest row exists for Story 6.9's market
 * event nudge.
 *
 * Renders nothing — it's a side-effect mount under AuthProvider only.
 * Re-runs when `isGuest` flips (e.g. a user signs out and reverts to
 * guest mode mid-session).
 */
export function GuestPushTokenRegistration() {
  const { isGuest } = useAuth();

  useEffect(() => {
    if (!isGuest) return;
    if (Platform.OS === 'web') return; // No Expo push on web.

    let cancelled = false;
    void (async () => {
      try {
        const { status } = await Notifications.getPermissionsAsync();
        if (status !== 'granted') return;
        const { default: Constants } = await import('expo-constants');
        const projectId = Constants.expoConfig?.extra?.eas?.projectId as
          | string
          | undefined;
        if (!projectId) return;
        const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
        if (cancelled || !token) return;
        await apiRegisterGuestPushToken(token);
      } catch {
        // Best-effort — silent failure. The user still has the in-app
        // banner fallback (GET /v1/nudge/market-event) so a missed
        // token registration doesn't kill the conversion surface.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isGuest]);

  return null;
}
