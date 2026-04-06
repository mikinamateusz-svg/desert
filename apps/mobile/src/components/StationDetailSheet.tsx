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
import { FuelBadge } from './FuelBadge';
import { BrandLogo } from './BrandLogo';
import type { StationDto } from '../api/stations';
import type { StationPriceDto } from '../api/prices';

interface Props {
  station: StationDto | null;
  prices: StationPriceDto | null;
  selectedFuel: FuelType | null;
  onDismiss: () => void;
}

export function StationDetailSheet({ station, prices, selectedFuel, onDismiss }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [showExplain, setShowExplain] = useState(false);

  // Reset explain modal when station changes or estimated fuels disappear
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

  const band = prices ? freshnessBand(prices.updatedAt) : 'unknown';

  const estimatedFuels = Object.keys(prices?.estimateLabel ?? {});
  const hasAnyEstimate = estimatedFuels.length > 0;
  const overallEstimateLabel = estimatedFuels.every(
    ft => prices?.estimateLabel?.[ft as FuelType] === 'estimated',
  ) ? 'estimated' : 'market_estimate';

  // Fuel ordering: highlighted first → available secondaries → unavailable (∅) at end
  const highlightedFuel = selectedFuel && prices?.prices[selectedFuel] !== undefined
    ? selectedFuel
    : null;
  const availableFuels = (VALID_FUEL_TYPES as FuelType[]).filter(
    ft => prices?.prices[ft] !== undefined,
  );
  const unavailableFuels = (VALID_FUEL_TYPES as FuelType[]).filter(
    ft => prices?.prices[ft] === undefined,
  );
  const secondaryFuels = availableFuels.filter(ft => ft !== highlightedFuel);

  // When there is no highlighted row, available rows render at equal weight (not dimmed)
  const hasHighlight = highlightedFuel !== null;

  const renderPriceValue = (ft: FuelType) => {
    if (!prices) return '';
    const price = prices.prices[ft];
    if (price === undefined) return '';
    const range = prices.priceRanges?.[ft];
    const fuelSource = prices.sources[ft] ?? 'community';
    if (range) return `~${range.low.toFixed(2)}–${range.high.toFixed(2)}`;
    if (fuelSource === 'seeded') return `~${price.toFixed(2)}`;
    return price.toFixed(2);
  };

  const renderA11yValue = (ft: FuelType) => {
    if (!prices) return '';
    const price = prices.prices[ft];
    if (price === undefined) return t('stationDetail.notAvailable');
    const range = prices.priceRanges?.[ft];
    const fuelSource = prices.sources[ft] ?? 'community';
    if (range) return `${range.low.toFixed(2)} to ${range.high.toFixed(2)} zł/l`;
    return `${fuelSource === 'seeded' ? '~' : ''}${price.toFixed(2)} zł/l`;
  };

  const isEstimated = (ft: FuelType) =>
    (prices?.sources[ft] ?? 'community') === 'seeded';

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

            {/* Close button */}
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={onDismiss}
              accessibilityRole="button"
              accessibilityLabel={t('stationDetail.close')}
            >
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>

            {/* Header: brand logo + station name + address */}
            <View style={styles.header}>
              <BrandLogo brand={displayStation?.brand ?? null} />
              <View style={styles.headerText}>
                <Text style={styles.stationName} numberOfLines={2}>
                  {displayStation?.name ?? ''}
                </Text>
                {displayStation?.address ? (
                  <Text style={styles.address} numberOfLines={1}>
                    {displayStation.address}
                  </Text>
                ) : null}
              </View>
            </View>

            {/* Price list — shown whenever prices object exists */}
            {prices !== null ? (
              <View style={styles.priceList}>

                {/* Selected / highlighted fuel — primary row */}
                {highlightedFuel && (
                  <View
                    style={styles.primaryRow}
                    accessibilityLabel={`${t(`fuelTypes.${highlightedFuel}`)}: ${renderA11yValue(highlightedFuel)}`}
                  >
                    <View style={styles.fuelLeft}>
                      <FuelBadge fuelType={highlightedFuel} size="lg" />
                      <Text style={styles.primaryLabel}>{t(`fuelTypes.${highlightedFuel}`)}</Text>
                    </View>
                    <View style={styles.priceRight}>
                      <FreshnessIndicator
                        band={band}
                        source={prices?.sources[highlightedFuel] ?? 'community'}
                        updatedAt={prices.updatedAt}
                      />
                      <Text style={[
                        styles.primaryPrice,
                        isEstimated(highlightedFuel) && styles.priceEstimated,
                      ]}>
                        {renderPriceValue(highlightedFuel)}
                      </Text>
                      <Text style={styles.priceUnit}>zł/l</Text>
                    </View>
                  </View>
                )}

                {/* Available secondary fuels */}
                {secondaryFuels.map((ft, index) => {
                  const isLast = index === secondaryFuels.length - 1 && unavailableFuels.length === 0;
                  return (
                    <View
                      key={ft}
                      style={[styles.secondaryRow, isLast && styles.lastRow]}
                      accessibilityLabel={`${t(`fuelTypes.${ft}`)}: ${renderA11yValue(ft)}`}
                    >
                      <View style={styles.fuelLeft}>
                        <FuelBadge fuelType={ft} size="sm" />
                        <Text style={hasHighlight ? styles.secondaryLabel : styles.neutralLabel}>
                          {t(`fuelTypes.${ft}`)}
                        </Text>
                      </View>
                      <View style={styles.priceRight}>
                        <FreshnessIndicator
                          band={band}
                          source={prices.sources[ft] ?? 'community'}
                          updatedAt={prices.updatedAt}
                        />
                        <Text style={[
                          hasHighlight ? styles.secondaryPrice : styles.neutralPrice,
                          isEstimated(ft) && styles.priceEstimated,
                        ]}>
                          {renderPriceValue(ft)}
                        </Text>
                        <Text style={styles.priceUnit}>zł/l</Text>
                      </View>
                    </View>
                  );
                })}

                {/* Unavailable fuels — demoted to end, ∅ in price position */}
                {unavailableFuels.map((ft, index) => {
                  const isLast = index === unavailableFuels.length - 1;
                  return (
                    <View
                      key={ft}
                      style={[styles.secondaryRow, isLast && styles.lastRow]}
                      accessibilityLabel={`${t(`fuelTypes.${ft}`)}: ${t('stationDetail.notAvailable')}`}
                    >
                      <View style={styles.fuelLeft}>
                        <FuelBadge fuelType={ft} size="sm" />
                        <Text style={styles.unavailableLabel}>{t(`fuelTypes.${ft}`)}</Text>
                      </View>
                      <Text style={styles.unavailableSymbol}>∅</Text>
                    </View>
                  );
                })}

                {band === 'stale' && estimatedFuels.length === 0 && availableFuels.length > 0 && (
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
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: tokens.neutral.n200,
    alignSelf: 'center',
    marginBottom: 14,
  },

  // Close button
  closeBtn: {
    position: 'absolute',
    top: 10,
    right: 14,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: tokens.neutral.n100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    fontSize: 14,
    color: tokens.neutral.n400,
    fontWeight: '600',
    lineHeight: 16,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  stationName: {
    fontSize: 17,
    fontWeight: '700',
    color: tokens.brand.ink,
    lineHeight: 22,
  },
  address: {
    fontSize: 12,
    color: tokens.neutral.n500,
    marginTop: 2,
  },

  // Price list
  priceList: {
    marginBottom: 16,
  },

  // Primary (selected + available) fuel row
  primaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fef3c7',
    borderRadius: tokens.radius.md,
    paddingVertical: 11,
    paddingHorizontal: 13,
    marginBottom: 6,
  },
  primaryLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: tokens.brand.ink,
  },
  primaryPrice: {
    fontSize: 19,
    fontWeight: '800',
    color: tokens.brand.ink,
  },

  // Secondary rows (when a highlighted row exists — dimmed relative to primary)
  secondaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.neutral.n200,
  },
  lastRow: {
    borderBottomWidth: 0,
  },
  secondaryLabel: {
    fontSize: 14,
    fontWeight: '400',
    color: tokens.neutral.n500,
  },
  secondaryPrice: {
    fontSize: 14,
    fontWeight: '500',
    color: tokens.brand.ink,
  },

  // Neutral rows (when NO highlighted row — equal weight, not dimmed)
  neutralLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: tokens.brand.ink,
  },
  neutralPrice: {
    fontSize: 15,
    fontWeight: '600',
    color: tokens.brand.ink,
  },

  // Unavailable fuel rows (∅ — no price data)
  unavailableLabel: {
    fontSize: 14,
    fontWeight: '400',
    color: tokens.neutral.n400,
  },
  unavailableSymbol: {
    fontSize: 14,
    fontWeight: '400',
    color: tokens.neutral.n400,
  },

  // Shared
  fuelLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  priceRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  priceUnit: {
    fontSize: 11,
    color: tokens.neutral.n400,
    alignSelf: 'flex-end',
    marginBottom: 1,
  },
  priceEstimated: {
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

  // Empty state (prices object is null — no data at all)
  emptyState: {
    paddingVertical: 24,
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 14,
    color: tokens.neutral.n400,
  },

  // Navigate button
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

  // Explain modal
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
