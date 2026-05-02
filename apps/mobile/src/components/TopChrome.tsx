import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { tokens } from '../theme';

interface Props {
  /**
   * Map screen renders TopChrome as an absolutely-positioned overlay above
   * the map. Tab screens (Activity, Log) render it as part of normal flex
   * flow with content below it. Defaults to flow layout — pass `overlay`
   * for the map case.
   */
  overlay?: boolean;
}

/**
 * Shared top chrome — wordmark on the left, hamburger menu (→ Account) on
 * the right. Renders with status-bar safe-area padding so content never
 * blends into the OS status bar.
 *
 * Used on Map, Activity, Log so all three core tabs share the same brand
 * mark and menu access — gives the app a consistent identity across tabs
 * and avoids the "headings floating into the status bar" problem on
 * non-map screens.
 *
 * The bell icon (alerts) is intentionally hidden for Phase 1 — alerts are
 * Epic 6. Re-enable when alert preferences and push notifications ship.
 */
export function TopChrome({ overlay = false }: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  return (
    <View
      style={[
        styles.bar,
        overlay && styles.barOverlay,
        { paddingTop: insets.top },
      ]}
    >
      <Text style={styles.wordmark}>
        litr<Text style={styles.wordmarkAccent}>o</Text>
      </Text>
      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => router.push('/(app)/account')}
          accessibilityLabel={t('map.openMenu')}
          accessibilityRole="button"
        >
          <Ionicons name="menu" size={22} color={tokens.brand.ink} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    paddingBottom: 6,
    paddingHorizontal: 16,
    backgroundColor: tokens.surface.card,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    // Subtle drop-shadow / elevation so the chrome reads as a layer above
    // the map (and above scrolling content on Activity / Log).
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
  },
  barOverlay: {
    // Map use: floats above the map canvas. Tab use: stays in-flow so
    // content sits beneath it, not behind it.
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 40,
  },
  wordmark: {
    fontSize: 20,
    fontWeight: '800',
    color: tokens.brand.ink,
    letterSpacing: -0.5,
  },
  wordmarkAccent: {
    color: tokens.brand.accent,
  },
  actions: {
    flexDirection: 'row',
  },
  actionButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
