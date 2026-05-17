import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import { tokens } from '../../theme';

interface Props {
  /** Renders the banner only when true. */
  visible: boolean;
  /** Tap-to-retry handler — triggers a fresh price fetch via the parent hook. */
  onRetry: () => void;
  /**
   * Absolute-positioning offset from the host. Caller positions it just
   * under the chip row (or under the demote banner when both are active).
   */
  topOffset: number;
}

/**
 * Surfaces a persistent fetch failure from `useNearbyPrices` so the user
 * has a visible signal AND a tap-to-retry path. Without this, a wedged
 * fetch loop produces a silently-broken map (`?` pins) that the user
 * can't recover from without force-stopping the app.
 *
 * Renders only when `visible=true`; collapses out of the DOM otherwise.
 * Always-visible by design while in error state — no auto-dismiss.
 * The hook's exponential-backoff retry runs underneath, so the banner
 * may disappear on its own when a retry lands.
 */
export function PricesErrorBanner({ visible, onRetry, topOffset }: Props) {
  const { t } = useTranslation();

  if (!visible) return null;

  return (
    <View
      style={[styles.host, { top: topOffset }]}
      pointerEvents="box-none"
      accessibilityLiveRegion="polite"
    >
      <TouchableOpacity
        style={styles.banner}
        onPress={onRetry}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={t('map.pricesErrorA11y')}
      >
        <View style={styles.iconWrap}>
          <Ionicons name="cloud-offline-outline" size={18} color={tokens.fresh.old} />
        </View>
        <Text style={styles.text} numberOfLines={2}>
          {t('map.pricesErrorBody')}
        </Text>
        <Text style={styles.retry}>{t('map.pricesErrorRetry')} →</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 14,
    right: 14,
    zIndex: 9,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: tokens.surface.card,
    borderRadius: tokens.radius.md,
    borderLeftWidth: 4,
    borderLeftColor: tokens.fresh.old,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  iconWrap: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    color: tokens.brand.ink,
    fontSize: 12,
    lineHeight: 16,
  },
  retry: {
    color: tokens.brand.accent,
    fontSize: 12,
    fontWeight: '700',
  },
});
