import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { tokens } from '../../theme';
import { useTranslation } from 'react-i18next';
import { usePremiumAlertsStatus, bellState } from '../../hooks/usePremiumAlertsStatus';
import {
  useAlertsUnreadCount,
  useAlertsUnreadCountAutoRefresh,
} from '../../hooks/useAlertsUnreadCount';
import { flags } from '../../config/flags';

/**
 * Story 6.10 — premium alerts bell icon for the map header chrome.
 * Story 6.11 — adds the unread-count numeric badge with the expiring-state
 * override.
 *
 * Three premium states driven by the user's `premium_alerts_active_until`:
 *   - `inactive` — null or in the past → outline bell, neutral grey
 *   - `active`   — > 3 days remaining → filled bell, brand amber
 *   - `expiring` — ≤ 3 days remaining → filled bell + warning dot badge
 *
 * Badge priority (Story 6.11 AC9):
 *   1. expiring → warning dot (highest — drives action)
 *   2. unread > 0 → numeric badge (capped at "9+")
 *   3. otherwise → no badge
 *
 * Tap → routes to /(app)/alerts.
 * Hidden entirely when `flags.alertsLoop` is off.
 */
interface Props {
  /** Top inset for safe-area positioning. Caller passes from useSafeAreaInsets. */
  topInset: number;
}

export function BellAlertIcon({ topInset }: Props) {
  const { t } = useTranslation();
  const { activeUntil } = usePremiumAlertsStatus();
  // Owns the unread-count fetch lifecycle (mount + foreground); mutators
  // from the alerts screen update the same store optimistically.
  useAlertsUnreadCountAutoRefresh();
  const unreadCount = useAlertsUnreadCount();

  if (!flags.alertsLoop) return null;

  const state = bellState(activeUntil);
  const isFilled = state === 'active' || state === 'expiring';
  const showWarningDot = state === 'expiring';
  // Numeric badge only when not expiring (expiring takes priority) AND
  // there is something unread.
  const showUnreadBadge = !showWarningDot && unreadCount > 0;
  const unreadLabel = unreadCount > 9 ? '9+' : String(unreadCount);

  const accessibilityLabel =
    state === 'expiring'
      ? t('alerts.bell.expiringA11y')
      : state === 'active'
        ? t('alerts.bell.activeA11y')
        : t('alerts.bell.inactiveA11y');

  return (
    <TouchableOpacity
      onPress={() => router.push('/(app)/alerts')}
      style={[styles.container, { top: topInset + 12 }]}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <Ionicons
        name={isFilled ? 'notifications' : 'notifications-outline'}
        size={26}
        color={isFilled ? tokens.brand.accent : tokens.neutral.n400}
      />
      {showWarningDot && <View style={styles.warningDot} />}
      {showUnreadBadge && (
        <View
          style={styles.unreadBadge}
          accessibilityLabel={t('alerts.bell.unreadCountA11y', { count: unreadCount })}
        >
          <Text style={styles.unreadText}>{unreadLabel}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    right: 16,
    zIndex: 10,
    padding: 4,
  },
  warningDot: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: tokens.price.expensive,
    borderWidth: 1.5,
    borderColor: tokens.neutral.n0,
  },
  unreadBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: tokens.brand.accent,
    borderWidth: 1.5,
    borderColor: tokens.neutral.n0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadText: {
    color: tokens.neutral.n0,
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 12,
  },
});
