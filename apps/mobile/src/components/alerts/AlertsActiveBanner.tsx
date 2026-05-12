import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { tokens } from '../../theme';
import { useAuth } from '../../store/auth.store';
import { useAlertsStatus } from '../../hooks/useAlertsStatus';
import { flags } from '../../config/flags';

// P5 (6.10 review) — namespace by user id so account-switching on the
// same device doesn't suppress the banner for the new user (or replay
// it inappropriately). Falls back to a generic key when unauthenticated
// (the banner won't render anyway in that case).
//
// AsyncStorage key kept on the legacy `desert:premium-alerts:` namespace
// across the 6.13 rename. Changing it would silently re-fire the banner
// once for every existing user (the new key has no prior value, so the
// "current > lastSeen" check trivially passes). The legacy namespace is
// internal — there is no consumer-facing reference to it.
const lastSeenKeyFor = (userId: string | null) =>
  userId ? `desert:premium-alerts:lastSeenActiveUntil:${userId}` : 'desert:premium-alerts:lastSeenActiveUntil:_anon';

/**
 * Story 6.10 AC9 / 6.13 — activity-screen banner that fires once after
 * a verified submission extends the user's price-alerts window. Reads
 * the current `alerts_active_until` via the shared hook, compares
 * against the last-seen value in AsyncStorage, and renders the banner
 * only when the current value is strictly newer (i.e., something has
 * extended the window since the user last opened this surface).
 *
 * Auto-dismisses on next mount (we update AsyncStorage on render), so
 * a user who returns to activity later doesn't see the same banner
 * twice. Manual dismiss button gives an immediate exit.
 *
 * Hidden when `flags.alertsLoop` is off.
 *
 * Naming: was `PremiumActiveBanner` until Story 6.13.
 */
export function AlertsActiveBanner() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { activeUntil } = useAlertsStatus();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!flags.alertsLoop) return;
    if (!activeUntil) return;

    const key = lastSeenKeyFor(user?.id ?? null);
    void (async () => {
      try {
        const lastSeenStr = await AsyncStorage.getItem(key);
        const lastSeenMs = lastSeenStr ? new Date(lastSeenStr).getTime() : 0;
        // NaN guard — corrupt stored value treated as "never seen"
        const lastSeen = Number.isNaN(lastSeenMs) ? 0 : lastSeenMs;
        if (activeUntil.getTime() > lastSeen) {
          setVisible(true);
          await AsyncStorage.setItem(key, activeUntil.toISOString());
        }
      } catch {
        // AsyncStorage failures are silent — banner just doesn't show. No
        // user-facing degradation; next read attempt may succeed.
      }
    })();
  }, [activeUntil, user?.id]);

  if (!flags.alertsLoop || !visible || !activeUntil) return null;

  const formattedDate = activeUntil.toLocaleDateString(i18n.language, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <View style={styles.banner}>
      <Ionicons name="checkmark-circle" size={20} color={tokens.brand.accent} />
      <Text style={styles.text}>
        {t('activity.alertsExtendedBanner', { date: formattedDate })}
      </Text>
      <TouchableOpacity
        onPress={() => setVisible(false)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel={t('activity.alertsExtendedDismissA11y')}
      >
        <Ionicons name="close" size={18} color={tokens.neutral.n400} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: tokens.surface.warmPage,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: tokens.brand.accent,
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
  },
  text: {
    flex: 1,
    fontSize: 13,
    color: tokens.brand.ink,
    lineHeight: 18,
  },
});
