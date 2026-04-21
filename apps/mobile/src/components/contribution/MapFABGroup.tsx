import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import { tokens } from '../../theme';
import { useQueueCount } from '../../hooks/useQueueCount';
import { QueueBadge } from './QueueBadge';

interface Props {
  onAddPrice: () => void;
  onCheapest: () => void;
  onRecentre: () => void;
  showCheapest: boolean;
  recentreEnabled: boolean;
}

/**
 * Bottom-row map controls. Three slots laid out as:
 *   [cheapest-pill]  · · ·  [+ add price]  · · ·  [locate-me FAB]
 * "Add price" sits in the visual centre so it reads as the primary CTA.
 * When cheapest is hidden, the add-price pill remains centred via a placeholder.
 * Sits close to the bottom tab bar (insets.bottom + 16) so nothing hovers mid-map.
 */
export function MapFABGroup({
  onAddPrice,
  onCheapest,
  onRecentre,
  showCheapest,
  recentreEnabled,
}: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { pending, failed } = useQueueCount();

  return (
    <View style={[styles.container, { bottom: insets.bottom + 16 }]}>
      {(pending > 0 || failed > 0) && (
        <View style={styles.badgeRow}>
          <QueueBadge pending={pending} failed={failed} />
        </View>
      )}

      <View style={styles.row}>
        {/* Left slot: cheapest pill or invisible placeholder to preserve centring */}
        {showCheapest ? (
          <TouchableOpacity
            style={styles.cheapestPill}
            onPress={onCheapest}
            activeOpacity={0.85}
            accessibilityLabel={t('map.cheapestButton')}
            accessibilityRole="button"
          >
            <Text style={styles.cheapestText}>{t('map.cheapestButton')}</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.slotPlaceholder} />
        )}

        <View style={styles.flexSpacer} />

        {/* Centre slot: primary Add Price CTA */}
        <TouchableOpacity
          style={styles.addPricePill}
          onPress={onAddPrice}
          accessibilityLabel={t('contribution.addPrice')}
          accessibilityRole="button"
        >
          <Text style={styles.addPriceText}>{t('contribution.addPrice')}</Text>
        </TouchableOpacity>

        <View style={styles.flexSpacer} />

        {/* Right slot: locate-me circle */}
        <TouchableOpacity
          style={[styles.recentreFab, !recentreEnabled && styles.recentreFabDisabled]}
          onPress={onRecentre}
          disabled={!recentreEnabled}
          accessibilityLabel={t('map.recentre')}
          accessibilityRole="button"
        >
          <Ionicons name="locate" size={20} color={tokens.neutral.n0} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const SLOT_HEIGHT = 44;

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 14,
    right: 14,
  },
  badgeRow: {
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  flexSpacer: {
    flex: 1,
  },
  slotPlaceholder: {
    width: SLOT_HEIGHT,
    height: SLOT_HEIGHT,
  },
  cheapestPill: {
    height: SLOT_HEIGHT,
    backgroundColor: tokens.surface.card,
    borderRadius: tokens.radius.full,
    borderWidth: 1,
    borderColor: tokens.neutral.n200,
    paddingHorizontal: 16,
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 4,
  },
  cheapestText: {
    color: tokens.brand.ink,
    fontSize: 14,
    fontWeight: '600',
  },
  addPricePill: {
    height: SLOT_HEIGHT,
    backgroundColor: tokens.brand.ink,
    borderRadius: tokens.radius.full,
    paddingHorizontal: 18,
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  addPriceText: {
    color: tokens.neutral.n0,
    fontSize: 14,
    fontWeight: '600',
  },
  recentreFab: {
    width: SLOT_HEIGHT,
    height: SLOT_HEIGHT,
    borderRadius: SLOT_HEIGHT / 2,
    backgroundColor: tokens.brand.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.20,
    shadowRadius: 4,
    elevation: 4,
  },
  recentreFabDisabled: {
    opacity: 0.4,
  },
});
