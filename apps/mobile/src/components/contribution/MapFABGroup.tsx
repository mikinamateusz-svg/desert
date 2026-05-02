import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import { tokens } from '../../theme';
import { useQueueCount } from '../../hooks/useQueueCount';
import { QueueBadge } from './QueueBadge';

interface Props {
  onAddPrice: () => void;
  onCheapest: () => void;
  /**
   * Optional — undefined when Phase 2 is off (production EAS profile / push
   * builds with EXPO_PUBLIC_PHASE_2=false). When undefined the Log fill-up
   * FAB is not rendered, so the row drops from 4 → 3 buttons cleanly.
   */
  onLogFillup?: () => void;
  onRecentre: () => void;
  showCheapest: boolean;
  recentreEnabled: boolean;
}

// Sizing chosen for one-handed / in-motion use (driving / walking with phone
// in mount). Above WCAG / Material 48dp minima; in the same range as Waze
// (56dp) and below Apple CarPlay (60–80pt) — comfortable without dominating
// the map. Icon size 24 follows Material's standard FAB icon convention.
const FAB_SIZE = 60;
const FAB_GAP = 16;
const ICON_SIZE = 24;
// `add` glyph is visually smaller than `trending-down` / `receipt-outline` /
// `locate` at the same point size, so bump it slightly so all four icons
// read at similar visual weight.
const ADD_ICON_SIZE = 28;

/**
 * Bottom-of-map action row — four icon-only circular FABs in a single row,
 * centred horizontally:
 *   [↓ cheapest] [+ add price] [🧾 fill-up?] [⊙ locate-me]
 *
 * Ordering: actions left-to-right (cheapest → contribute trio → utility),
 * with the locate-me utility on the trailing edge per common toolbar
 * convention. The `+` (Add price) sits in the middle so the primary
 * contribution CTA is visually centred when all four are rendered.
 *
 * Colour split (Concept 1, Google Maps / Apple Maps convention):
 *   - Dark fill (brand.ink) for the three content actions
 *   - White fill (surface.card) for locate-me — the only utility, distinct
 *     from "do something with content"
 *
 * Orange (brand.accent) is intentionally NOT used — it's reserved for
 * fuel-pill "selected" state at the top of the map, and reusing it here
 * would dilute that meaning.
 *
 * Icon-only by design: text labels in PL/UK are too long to fit four
 * pills across a 360 dp screen. Discoverability is provided by:
 *   1. Universally-recognised icons (downward arrow = lower price, plus =
 *      add, receipt = transaction record, crosshair = recenter)
 *   2. accessibilityLabel reads the long-form name to screen readers,
 *      iOS Voice Control, and Android TalkBack long-press tooltip
 *
 * The Cheapest FAB renders disabled (50% opacity, no onPress) when no
 * cheapest highlight is available so the layout doesn't shift between
 * 3 and 4 buttons as the user pans.
 */
export function MapFABGroup({
  onAddPrice,
  onCheapest,
  onLogFillup,
  onRecentre,
  showCheapest,
  recentreEnabled,
}: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { pending, failed } = useQueueCount();

  return (
    <View style={[styles.container, { bottom: insets.bottom + 12 }]}>
      {(pending > 0 || failed > 0) && (
        <View style={styles.badgeRow}>
          <QueueBadge pending={pending} failed={failed} />
        </View>
      )}

      <View style={styles.row}>
        {/* Cheapest in view */}
        <TouchableOpacity
          style={[styles.fab, styles.fabDark, !showCheapest && styles.fabDisabled]}
          onPress={onCheapest}
          disabled={!showCheapest}
          accessibilityLabel={t('map.cheapestButton')}
          accessibilityRole="button"
        >
          <Ionicons name="trending-down" size={ICON_SIZE} color={tokens.neutral.n0} />
        </TouchableOpacity>

        {/* Add price (price-board photo contribution) */}
        <TouchableOpacity
          style={[styles.fab, styles.fabDark]}
          onPress={onAddPrice}
          accessibilityLabel={t('contribution.addPrice')}
          accessibilityRole="button"
        >
          <Ionicons name="add" size={ADD_ICON_SIZE} color={tokens.neutral.n0} />
        </TouchableOpacity>

        {/* Log fill-up (pump-meter OCR; Phase 2 only — falls back to 3-FAB
            row when undefined) */}
        {onLogFillup && (
          <TouchableOpacity
            style={[styles.fab, styles.fabDark]}
            onPress={onLogFillup}
            accessibilityLabel={t('fillup.logFillupCta')}
            accessibilityRole="button"
          >
            <Ionicons name="receipt-outline" size={ICON_SIZE} color={tokens.neutral.n0} />
          </TouchableOpacity>
        )}

        {/* Locate-me — white, distinct from the dark contribution trio */}
        <TouchableOpacity
          style={[styles.fab, styles.fabLight, !recentreEnabled && styles.fabDisabled]}
          onPress={onRecentre}
          disabled={!recentreEnabled}
          accessibilityLabel={t('map.recentre')}
          accessibilityRole="button"
        >
          <Ionicons name="locate" size={ICON_SIZE} color={tokens.brand.ink} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center', // centres the row horizontally
  },
  badgeRow: {
    // Queue badge stays left-aligned (consistent with previous layout) so
    // it doesn't get lost against the centred FAB row below.
    alignSelf: 'flex-start',
    marginLeft: 14,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    gap: FAB_GAP,
  },
  fab: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  fabDark: {
    backgroundColor: tokens.brand.ink,
  },
  fabLight: {
    backgroundColor: tokens.surface.card,
    // Slightly softer shadow on white — same elevation but the contrast
    // against the map needs less drop-shadow weight to read.
    shadowOpacity: 0.15,
  },
  fabDisabled: {
    opacity: 0.4,
  },
});
