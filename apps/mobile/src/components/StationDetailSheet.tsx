import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  Linking,
  Platform,
} from 'react-native';
import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tokens } from '../theme';
import type { FuelType } from '@desert/types';
import { VALID_FUEL_TYPES } from '../hooks/useFuelTypePreference';
import { relativeTime } from '../utils/relativeTime';
import type { StationDto } from '../api/stations';
import type { StationPriceDto } from '../api/prices';

interface Props {
  station: StationDto | null;
  prices: StationPriceDto | null;
  onDismiss: () => void;
}

export function StationDetailSheet({ station, prices, onDismiss }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  // Preserve last non-null station so content doesn't blank during slide-out animation
  const lastStationRef = useRef<StationDto | null>(null);
  if (station !== null) lastStationRef.current = station;
  const displayStation = station ?? lastStationRef.current;

  const handleNavigate = useCallback(async (lat: number, lng: number) => {
    const iosUrl     = `maps://?daddr=${lat},${lng}`;
    const androidUrl = `geo:${lat},${lng}?q=${lat},${lng}`;
    const webUrl     = `https://maps.google.com/?daddr=${lat},${lng}`;
    const native = Platform.OS === 'ios' ? iosUrl : androidUrl;
    try {
      const canOpen = await Linking.canOpenURL(native).catch(() => false);
      await Linking.openURL(canOpen ? native : webUrl);
    } catch {
      // Navigation silently no-ops if all schemes fail (e.g. emulator with no maps app)
    }
  }, []);

  // Only count fuel types we actually display (VALID_FUEL_TYPES with a defined price)
  const hasPrices = prices !== null &&
    (VALID_FUEL_TYPES as FuelType[]).some(ft => prices.prices[ft] !== undefined);

  const freshness = (() => {
    if (!prices) return null;
    const token = relativeTime(prices.updatedAt);
    if (token === '?') return null; // unparseable updatedAt — suppress freshness line
    return token === 'just now'
      ? t('stationDetail.justNow')
      : t('stationDetail.updatedAgo', { time: token });
  })();

  return (
    <Modal
      transparent
      visible={station !== null}
      animationType="slide"
      onRequestClose={onDismiss}
    >
      <View style={styles.container}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} />

        <View
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 24) }]}
          accessibilityViewIsModal
        >
          <View style={styles.handle} />

          {/* Header */}
          <Text style={styles.stationName} numberOfLines={2}>
            {displayStation?.name ?? ''}
          </Text>
          <Text style={styles.address} numberOfLines={2}>
            {displayStation?.address ?? t('stationDetail.noAddress')}
          </Text>

          {/* Price list */}
          {hasPrices ? (
            <View style={styles.priceList}>
              {(VALID_FUEL_TYPES as FuelType[]).map(ft => {
                const price = prices!.prices[ft];
                if (price === undefined) return null;
                return (
                  <View
                    key={ft}
                    style={styles.priceRow}
                    accessibilityLabel={`${t(`fuelTypes.${ft}`)}: ${price.toFixed(2)} zł/l`}
                  >
                    <Text style={styles.priceLabel}>{t(`fuelTypes.${ft}`)}</Text>
                    <Text style={styles.priceValue}>{price.toFixed(2)} zł/l</Text>
                  </View>
                );
              })}
              {freshness !== null && (
                <Text style={styles.freshness}>{freshness}</Text>
              )}
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>{t('stationDetail.noPrices')}</Text>
            </View>
          )}

          {/* Navigate CTA */}
          <TouchableOpacity
            style={styles.navigateButton}
            onPress={() => displayStation && handleNavigate(displayStation.lat, displayStation.lng)}
            disabled={displayStation === null}
            accessibilityRole="button"
          >
            <Text style={styles.navigateButtonText}>{t('stationDetail.navigate')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: tokens.surface.card,
    borderTopLeftRadius: tokens.radius.lg,
    borderTopRightRadius: tokens.radius.lg,
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: tokens.neutral.n200,
    alignSelf: 'center',
    marginBottom: 20,
  },
  stationName: {
    fontSize: 18,
    fontWeight: '700',
    color: tokens.brand.ink,
    marginBottom: 4,
  },
  address: {
    fontSize: 13,
    color: tokens.neutral.n500,
    marginBottom: 20,
  },
  priceList: {
    marginBottom: 20,
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.neutral.n200,
  },
  priceLabel: {
    fontSize: 15,
    color: tokens.brand.ink,
  },
  priceValue: {
    fontSize: 15,
    fontWeight: '600',
    color: tokens.brand.ink,
  },
  freshness: {
    fontSize: 12,
    color: tokens.neutral.n400,
    marginTop: 10,
    textAlign: 'right',
  },
  emptyState: {
    paddingVertical: 24,
    alignItems: 'center',
    marginBottom: 20,
  },
  emptyText: {
    fontSize: 14,
    color: tokens.neutral.n400,
  },
  navigateButton: {
    backgroundColor: tokens.brand.accent,
    borderRadius: tokens.radius.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  navigateButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: tokens.brand.ink,
  },
});
