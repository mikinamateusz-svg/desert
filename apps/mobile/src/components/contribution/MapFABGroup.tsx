import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { tokens } from '../../theme';
import { useQueueCount } from '../../hooks/useQueueCount';
import { QueueBadge } from './QueueBadge';

interface Props {
  onAddPrice: () => void;
  onCheapest: () => void;
  showCheapest: boolean;
}

export function MapFABGroup({ onAddPrice, onCheapest, showCheapest }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { pending, failed } = useQueueCount();

  return (
    <View style={[styles.container, { bottom: insets.bottom + 58 }]}>
      {(pending > 0 || failed > 0) && (
        <QueueBadge pending={pending} failed={failed} />
      )}

      <View style={styles.row}>
        {showCheapest && (
          <TouchableOpacity
            style={styles.cheapestPill}
            onPress={onCheapest}
            activeOpacity={0.85}
            accessibilityLabel={t('map.cheapestButton')}
            accessibilityRole="button"
          >
            <Text style={styles.cheapestText}>{t('map.cheapestButton')}</Text>
          </TouchableOpacity>
        )}

        <View style={styles.spacer} />

        <TouchableOpacity
          style={styles.addPricePill}
          onPress={onAddPrice}
          accessibilityLabel={t('contribution.addPrice')}
          accessibilityRole="button"
        >
          <Text style={styles.addPriceText}>{t('contribution.addPrice')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 14,
    right: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  spacer: {
    flex: 1,
  },
  cheapestPill: {
    backgroundColor: tokens.surface.card,
    borderRadius: tokens.radius.full,
    borderWidth: 1,
    borderColor: tokens.neutral.n200,
    paddingVertical: 10,
    paddingHorizontal: 16,
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
    backgroundColor: tokens.brand.ink,
    borderRadius: tokens.radius.full,
    paddingVertical: 10,
    paddingHorizontal: 18,
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
});
