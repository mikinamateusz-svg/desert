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
import { useCallback, useRef, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tokens } from '../theme';
import type { FuelType } from '@desert/types';
import { VALID_FUEL_TYPES } from '../hooks/useFuelTypePreference';
import { freshnessBand } from '../utils/freshnessBand';
import { FreshnessIndicator } from './FreshnessIndicator';
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
  const [showExplain, setShowExplain] = useState(false);

  // Reset explain modal when station changes or when estimated fuels disappear (e.g. price refresh)
  const hasAnyEstimateForEffect = prices?.estimateLabel !== undefined &&
    Object.keys(prices.estimateLabel).length > 0;
  useEffect(() => {
    setShowExplain(false);
  }, [station?.id, hasAnyEstimateForEffect]);

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

  const hasPrices = prices !== null &&
    (VALID_FUEL_TYPES as FuelType[]).some(ft => prices.prices[ft] !== undefined);

  const band = prices ? freshnessBand(prices.updatedAt) : 'unknown';

  // Determine station-level estimate status from per-fuel estimateLabel
  const estimatedFuels = Object.keys(prices?.estimateLabel ?? {});
  const hasAnyEstimate = estimatedFuels.length > 0;
  const overallEstimateLabel = estimatedFuels.every(
    ft => prices?.estimateLabel?.[ft as FuelType] === 'estimated',
  ) ? 'estimated' : 'market_estimate';

  return (
    <>
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
                  const range = prices!.priceRanges?.[ft];
                  const fuelSource = prices!.sources[ft] ?? 'community';
                  const displayValue = range
                    ? `~${range.low.toFixed(2)}–${range.high.toFixed(2)}`
                    : fuelSource === 'seeded'
                      ? `~${price.toFixed(2)}`
                      : price.toFixed(2);
                  const a11yValue = range
                    ? `${range.low.toFixed(2)} to ${range.high.toFixed(2)} zł/l`
                    : `${fuelSource === 'seeded' ? '~' : ''}${price.toFixed(2)} zł/l`;
                  return (
                    <View
                      key={ft}
                      style={styles.priceRow}
                      accessibilityLabel={`${t(`fuelTypes.${ft}`)}: ${a11yValue}`}
                    >
                      <Text style={styles.priceLabel}>{t(`fuelTypes.${ft}`)}</Text>
                      <View style={styles.priceRight}>
                        <FreshnessIndicator
                          band={band}
                          source={fuelSource}
                          updatedAt={prices!.updatedAt}
                        />
                        <Text style={[
                          styles.priceValue,
                          fuelSource === 'seeded' && styles.priceValueEstimated,
                        ]}>
                          {displayValue} zł/l
                        </Text>
                      </View>
                    </View>
                  );
                })}
                {band === 'stale' && estimatedFuels.length === 0 && (
                  <Text style={styles.staleWarning}>{t('freshness.mayBeOutdated')}</Text>
                )}
                {hasAnyEstimate && (
                  <TouchableOpacity onPress={() => setShowExplain(true)}>
                    <Text style={styles.estimatedLabel}>
                      {overallEstimateLabel === 'market_estimate'
                        ? t('freshness.marketEstimate')
                        : t('freshness.estimated')}
                    </Text>
                  </TouchableOpacity>
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

      {/* Explanation modal for estimated prices */}
      <Modal
        transparent
        visible={showExplain}
        animationType="fade"
        onRequestClose={() => setShowExplain(false)}
      >
        <View style={styles.explainOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowExplain(false)} />
          <View style={styles.explainCard}>
            <Text style={styles.explainTitle}>
              {overallEstimateLabel === 'market_estimate'
                ? t('freshness.marketEstimate')
                : t('freshness.estimated')}
            </Text>
            <Text style={styles.explainBody}>
              {overallEstimateLabel === 'market_estimate'
                ? t('freshness.marketEstimateExplain')
                : t('freshness.estimatedExplain')}
            </Text>
            <Text style={styles.explainContribute}>{t('freshness.contributePrompt')}</Text>
            <TouchableOpacity
              style={styles.explainDismiss}
              onPress={() => setShowExplain(false)}
              accessibilityRole="button"
            >
              <Text style={styles.explainDismissText}>{t('freshness.dismiss')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
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
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.neutral.n200,
  },
  priceLabel: {
    fontSize: 15,
    color: tokens.brand.ink,
  },
  priceRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  priceValue: {
    fontSize: 15,
    fontWeight: '600',
    color: tokens.brand.ink,
  },
  priceValueEstimated: {
    color: tokens.neutral.n400,
  },
  staleWarning: {
    fontSize: 12,
    color: tokens.fresh.old,
    marginTop: 6,
    textAlign: 'right',
  },
  estimatedLabel: {
    fontSize: 12,
    color: tokens.neutral.n400,
    marginTop: 6,
    textAlign: 'right',
    textDecorationLine: 'underline',
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
  explainOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
    paddingHorizontal: 32,
  },
  explainCard: {
    backgroundColor: tokens.surface.card,
    borderRadius: tokens.radius.lg,
    padding: 24,
    width: '100%',
  },
  explainTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: tokens.brand.ink,
    marginBottom: 12,
  },
  explainBody: {
    fontSize: 14,
    color: tokens.brand.ink,
    lineHeight: 20,
    marginBottom: 8,
  },
  explainContribute: {
    fontSize: 13,
    color: tokens.neutral.n500,
    marginBottom: 20,
  },
  explainDismiss: {
    alignSelf: 'flex-end',
  },
  explainDismissText: {
    fontSize: 15,
    fontWeight: '600',
    color: tokens.brand.accent,
  },
});
