import { TouchableOpacity, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { tokens } from '../../theme';
import { useTranslation } from 'react-i18next';
import { usePremiumAlertsStatus, bellState } from '../../hooks/usePremiumAlertsStatus';
import { flags } from '../../config/flags';

/**
 * Story 6.10 — premium alerts bell icon for the map header chrome.
 *
 * Three states driven by the user's `premium_alerts_active_until`:
 *   - `inactive` — null or in the past → outline bell, neutral grey
 *   - `active`   — > 3 days remaining → filled bell, brand amber
 *   - `expiring` — ≤ 3 days remaining → filled bell + warning dot badge
 *
 * Tap → routes to /(app)/alerts where the status banner spells out the
 * details and (when expiring) presents the "take a photo to extend" CTA.
 *
 * Hidden entirely when `flags.alertsLoop` is off (prod default until
 * marketing-campaign launch flips the flag).
 */
interface Props {
  /** Top inset for safe-area positioning. Caller passes from useSafeAreaInsets. */
  topInset: number;
}

export function BellAlertIcon({ topInset }: Props) {
  const { t } = useTranslation();
  const { activeUntil } = usePremiumAlertsStatus();

  if (!flags.alertsLoop) return null;

  const state = bellState(activeUntil);
  const isFilled = state === 'active' || state === 'expiring';
  const showWarningDot = state === 'expiring';

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
});
