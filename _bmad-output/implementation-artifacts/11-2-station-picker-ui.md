# Story 11.2: Station Picker — Mobile UI

## Metadata
- **Epic:** 11 — Station Picker
- **Story ID:** 11.2
- **Status:** ready-for-dev
- **Date:** 2026-04-08
- **Depends on:** Story 11.1 (`POST /v1/stations/recommend` endpoint), Story 2.2 (map screen, `useLocation` hook, re-centre FAB), Story 2.5 (`StationDetailSheet`, `handleNavigate` pattern), Story 2.3 (fuel type pills, `VALID_FUEL_TYPES`)
- **Required by:** none (this story closes Epic 11)

---

## User Story

**As a driver,**
I want to tap "Pick for me" on the map and immediately see the two best stations for my fuel type,
So that I can navigate to the right station without manually comparing multiple pins.

---

## Context & Why

Story 11.1 built the recommendation engine. This story wires the mobile UI to it. The experience has three steps:

1. Driver taps the "Pick for me" FAB on the map screen.
2. If a fuel type filter is already active on the map, the request fires immediately. If not, a lightweight fuel type selector sheet appears first.
3. A result sheet shows up to two recommendation cards with price, distance, freshness, deal label (FR74), a "How we pick" disclosure (FR73), and direct navigation (FR75).

The design deliberately reuses the existing `BottomSheet` / `Modal` patterns from Story 2.5 (`StationDetailSheet`) and the fuel type selector from Story 2.3. No new third-party dependencies are required.

The FAB must be positioned so it does not overlap the existing re-centre FAB from Story 2.2. Place it immediately to the left of the re-centre FAB (same vertical row), so both are visible simultaneously in the bottom-right corner.

### Guest User Handling

Because `POST /v1/stations/recommend` is `@Public()`, the picker works for unauthenticated users. The API call is made without an `Authorization` header for guests. The mobile API client function must handle the `null` `accessToken` case by omitting the header entirely rather than sending `Bearer null`.

---

## Acceptance Criteria

**Given** the map screen is displayed
**When** the driver views the bottom-right corner
**Then** a "Pick for me" FAB is visible and does not overlap the re-centre FAB (FR72)

**Given** the driver taps the "Pick for me" FAB and no fuel type filter is active on the map
**When** the tap registers
**Then** a fuel type selector bottom sheet appears with options PB 95, PB 98, ON, LPG, ON+ and a cancel option

**Given** the driver taps the "Pick for me" FAB and a fuel type filter IS active on the map
**When** the tap registers
**Then** the fuel type selector is skipped and the API request fires immediately with the active fuel type

**Given** the API request is in progress
**When** the picker state is `loading`
**Then** a loading indicator is shown in place of the result sheet — the FAB remains visible but is disabled

**Given** the API returns 1 or 2 recommendations
**When** the result sheet opens
**Then** each station card shows: station name, address, formatted price (`X.XX zł/l`), distance (`X.X km`), freshness badge, and a "Navigate" button (FR73)

**Given** a recommendation has `has_active_deal: true`
**When** the station card renders
**Then** a "Has active offer" chip is shown on that card (FR74)

**Given** the result sheet is open
**When** the driver expands "How we pick"
**Then** the four scoring factors are listed with their weights: price 40%, distance 30%, freshness 20%, active deals 10% (FR73 — disclosed algorithm)

**Given** the driver taps "Navigate" on a recommendation card
**When** the deep-link fires
**Then** Google Maps opens with directions to that station's coordinates (FR75); Apple Maps is used as fallback on iOS if Google Maps is not installed

**Given** the driver taps "View details" on a recommendation card
**When** the tap registers
**Then** the existing `StationDetailSheet` opens for that station

**Given** the API returns `recommendations: []`
**When** the result sheet renders
**Then** an empty state message is shown: "No stations with price data found nearby" — not an error screen

**Given** the API call fails with a network error
**When** the error is caught
**Then** the picker transitions to `error` state and shows a dismissible error message; the FAB becomes active again

**Given** `tsc --noEmit` is run
**When** it completes
**Then** zero type errors

---

## Technical Specification

### `recommendStations` API client function

**File:** `apps/mobile/src/api/stations.ts` (modify existing)

Add the following types and function to the existing stations API client:

```typescript
// ── Picker types ───────────────────────────────────────────────────────────

export type FuelType = 'PB_95' | 'PB_98' | 'ON' | 'ON_PREMIUM' | 'LPG';

export interface ScoreBreakdown {
  price_score:     number;
  distance_score:  number;
  freshness_score: number;
  deal_bonus:      number;
}

export interface ActiveDealInfo {
  headline:    string;
  conditions?: string;
}

export interface RecommendationResult {
  station_id:        string;
  station_name:      string;
  address:           string | null;
  lat:               number;
  lng:               number;
  fuel_type:         string;
  price_pln:         number;
  price_recorded_at: string;
  freshness:         'fresh' | 'stale' | 'unknown';
  distance_m:        number;
  score:             number;
  score_breakdown:   ScoreBreakdown;
  has_active_deal:   boolean;
  active_deal?:      ActiveDealInfo;
}

export interface AlgorithmExplanation {
  weights: {
    price:     '40%';
    distance:  '30%';
    freshness: '20%';
    deals:     '10%';
  };
  description: string;
}

export interface RecommendResponse {
  recommendations: RecommendationResult[];
  algorithm:       AlgorithmExplanation;
  searched_at:     string;
}

// ── API function ───────────────────────────────────────────────────────────

/**
 * POST /v1/stations/recommend
 * No auth required — endpoint is @Public().
 * accessToken may be null for guests; header is omitted in that case.
 */
export async function recommendStations(
  lat:          number,
  lng:          number,
  fuelType:     FuelType,
  radiusKm?:    number,
  accessToken?: string | null,
  signal?:      AbortSignal,
): Promise<RecommendResponse> {
  return request<RecommendResponse>('/v1/stations/recommend', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({
      lat,
      lng,
      fuel_type: fuelType,
      ...(radiusKm != null ? { radius_km: radiusKm } : {}),
    }),
    signal,
  });
}
```

### `useStationPicker` hook

**File:** `apps/mobile/src/hooks/useStationPicker.ts` (new)

```typescript
import { useCallback, useRef, useState } from 'react';
import {
  FuelType,
  RecommendationResult,
  AlgorithmExplanation,
  recommendStations,
} from '../api/stations';

export type PickerState = 'idle' | 'selecting-fuel' | 'loading' | 'result' | 'error';

export interface StationPickerHook {
  pickerState:     PickerState;
  recommendations: RecommendationResult[];
  algorithm:       AlgorithmExplanation | null;
  errorMessage:    string | null;
  openPicker:      (activeFuelType?: FuelType | null) => void;
  triggerPicker:   (fuelType: FuelType, lat: number, lng: number, accessToken?: string | null) => void;
  clearPicker:     () => void;
}

export function useStationPicker(): StationPickerHook {
  const [pickerState, setPickerState]       = useState<PickerState>('idle');
  const [recommendations, setRecommendations] = useState<RecommendationResult[]>([]);
  const [algorithm, setAlgorithm]           = useState<AlgorithmExplanation | null>(null);
  const [errorMessage, setErrorMessage]     = useState<string | null>(null);
  const abortRef                            = useRef<AbortController | null>(null);

  const clearPicker = useCallback(() => {
    abortRef.current?.abort();
    setPickerState('idle');
    setRecommendations([]);
    setAlgorithm(null);
    setErrorMessage(null);
  }, []);

  /** Called when FAB is tapped. If activeFuelType provided, skip fuel selector. */
  const openPicker = useCallback((activeFuelType?: FuelType | null) => {
    if (activeFuelType) {
      // Caller will follow up with triggerPicker() once location is available
      setPickerState('loading');
    } else {
      setPickerState('selecting-fuel');
    }
  }, []);

  /** Fire the actual API call. Call this after fuel type is confirmed. */
  const triggerPicker = useCallback(
    async (
      fuelType:    FuelType,
      lat:         number,
      lng:         number,
      accessToken: string | null = null,
    ) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setPickerState('loading');
      setRecommendations([]);
      setErrorMessage(null);

      try {
        const response = await recommendStations(
          lat, lng, fuelType,
          undefined,       // default radius (5 km)
          accessToken,
          controller.signal,
        );
        setRecommendations(response.recommendations);
        setAlgorithm(response.algorithm);
        setPickerState('result');
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return; // cancelled — no state update
        setErrorMessage('Could not load recommendations. Please try again.');
        setPickerState('error');
      }
    },
    [],
  );

  return { pickerState, recommendations, algorithm, errorMessage, openPicker, triggerPicker, clearPicker };
}
```

### `PickerFuelSelectorSheet` component

**File:** `apps/mobile/src/components/picker/PickerFuelSelectorSheet.tsx` (new)

```typescript
import React from 'react';
import {
  Modal, View, Text, Pressable, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { tokens } from '../../design/tokens';
import { FuelType } from '../../api/stations';

const FUEL_OPTIONS: { value: FuelType; labelKey: string }[] = [
  { value: 'PB_95',      labelKey: 'fuelTypes.PB_95' },
  { value: 'PB_98',      labelKey: 'fuelTypes.PB_98' },
  { value: 'ON',         labelKey: 'fuelTypes.ON' },
  { value: 'ON_PREMIUM', labelKey: 'fuelTypes.ON_PREMIUM' },
  { value: 'LPG',        labelKey: 'fuelTypes.LPG' },
];

interface Props {
  visible:    boolean;
  onSelect:   (fuelType: FuelType) => void;
  onCancel:   () => void;
}

export function PickerFuelSelectorSheet({ visible, onSelect, onCancel }: Props) {
  const insets = useSafeAreaInsets();
  const { t }  = useTranslation();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
    >
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 24) }]}>
          {/* Handle bar */}
          <View style={styles.handle} />

          <Text style={styles.title}>{t('picker.selectFuelType')}</Text>

          {FUEL_OPTIONS.map((opt) => (
            <Pressable
              key={opt.value}
              style={styles.option}
              onPress={() => onSelect(opt.value)}
            >
              <Text style={styles.optionText}>{t(opt.labelKey)}</Text>
            </Pressable>
          ))}

          <Pressable style={styles.cancelOption} onPress={onCancel}>
            <Text style={styles.cancelText}>{t('picker.cancel')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: tokens.neutral.n200,
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: tokens.brand.ink,
    marginBottom: 8,
  },
  option: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: tokens.neutral.n100,
  },
  optionText: {
    fontSize: 15,
    color: tokens.brand.ink,
  },
  cancelOption: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelText: {
    fontSize: 15,
    color: tokens.neutral.n500,
  },
});
```

### `PickerResultSheet` component

**File:** `apps/mobile/src/components/picker/PickerResultSheet.tsx` (new)

```typescript
import React, { useState, useCallback } from 'react';
import {
  Modal, View, Text, Pressable, StyleSheet,
  ScrollView, ActivityIndicator, Platform, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { tokens } from '../../design/tokens';
import { RecommendationResult, AlgorithmExplanation } from '../../api/stations';
import { StationDto } from '../../api/stations';

interface Props {
  visible:         boolean;
  loading:         boolean;
  recommendations: RecommendationResult[];
  algorithm:       AlgorithmExplanation | null;
  errorMessage:    string | null;
  onDismiss:       () => void;
  onViewDetails:   (station: StationDto) => void;
}

export function PickerResultSheet({
  visible, loading, recommendations, algorithm, errorMessage, onDismiss, onViewDetails,
}: Props) {
  const insets                            = useSafeAreaInsets();
  const { t }                             = useTranslation();
  const [algorithmExpanded, setAlgorithmExpanded] = useState(false);

  const handleNavigate = useCallback(async (lat: number, lng: number) => {
    const googleUrl = `https://maps.google.com/?daddr=${lat},${lng}&travelmode=driving`;
    const iosUrl    = `maps://?daddr=${lat},${lng}`;
    const androidUrl = `geo:${lat},${lng}?q=${lat},${lng}`;

    if (Platform.OS === 'ios') {
      const canOpenApple = await Linking.canOpenURL(iosUrl);
      await Linking.openURL(canOpenApple ? iosUrl : googleUrl);
    } else {
      const canOpenAndroid = await Linking.canOpenURL(androidUrl);
      await Linking.openURL(canOpenAndroid ? androidUrl : googleUrl);
    }
  }, []);

  const handleViewDetails = useCallback((rec: RecommendationResult) => {
    // Map RecommendationResult to the StationDto shape expected by StationDetailSheet
    const station: StationDto = {
      id:               rec.station_id,
      name:             rec.station_name,
      address:          rec.address,
      google_places_id: null,
      lat:              rec.lat,
      lng:              rec.lng,
    };
    onViewDetails(station);
  }, [onViewDetails]);

  const formatDistance = (m: number): string => {
    if (m < 1000) return `${m} m`;
    return `${(m / 1000).toFixed(1)} km`;
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onDismiss}
    >
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} />
        <View
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 24) }]}
          accessibilityViewIsModal
        >
          {/* Handle */}
          <View style={styles.handle} />

          {/* Loading state */}
          {loading && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={tokens.brand.accent} />
              <Text style={styles.loadingText}>{t('picker.loading')}</Text>
            </View>
          )}

          {/* Error state */}
          {!loading && errorMessage != null && (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>{errorMessage}</Text>
              <Pressable style={styles.dismissButton} onPress={onDismiss}>
                <Text style={styles.dismissButtonText}>{t('picker.close')}</Text>
              </Pressable>
            </View>
          )}

          {/* Results */}
          {!loading && errorMessage == null && (
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.sheetTitle}>{t('picker.resultsTitle')}</Text>

              {recommendations.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyText}>{t('picker.noResults')}</Text>
                </View>
              ) : (
                recommendations.map((rec, index) => (
                  <View key={rec.station_id} style={styles.card}>
                    {/* Rank badge */}
                    <View style={styles.rankBadge}>
                      <Text style={styles.rankText}>
                        {index === 0 ? t('picker.bestMatch') : t('picker.goodMatch')}
                      </Text>
                    </View>

                    {/* Station name + address */}
                    <Text style={styles.stationName}>{rec.station_name}</Text>
                    {rec.address != null && (
                      <Text style={styles.stationAddress}>{rec.address}</Text>
                    )}

                    {/* Price row */}
                    <View style={styles.priceRow}>
                      <Text style={styles.priceText}>
                        {rec.price_pln.toFixed(2)} zł/l
                      </Text>
                      <View style={[
                        styles.freshnessBadge,
                        rec.freshness === 'fresh' ? styles.freshBadge
                          : rec.freshness === 'stale' ? styles.staleBadge
                          : styles.unknownBadge,
                      ]}>
                        <Text style={styles.freshnessText}>
                          {rec.freshness === 'fresh'   ? t('picker.fresh')
                            : rec.freshness === 'stale' ? t('picker.stale')
                            : t('picker.unknown')}
                        </Text>
                      </View>
                    </View>

                    {/* Distance */}
                    <Text style={styles.distanceText}>
                      {formatDistance(rec.distance_m)}
                    </Text>

                    {/* Active offer chip (FR74) */}
                    {rec.has_active_deal && (
                      <View style={styles.dealChip}>
                        <Text style={styles.dealChipText}>{t('picker.hasActiveDeal')}</Text>
                      </View>
                    )}

                    {/* Action buttons */}
                    <View style={styles.cardActions}>
                      <Pressable
                        style={styles.navigateButton}
                        onPress={() => handleNavigate(rec.lat, rec.lng)}
                      >
                        <Text style={styles.navigateButtonText}>{t('picker.navigate')}</Text>
                      </Pressable>
                      <Pressable
                        style={styles.detailsButton}
                        onPress={() => handleViewDetails(rec)}
                      >
                        <Text style={styles.detailsButtonText}>{t('picker.viewDetails')}</Text>
                      </Pressable>
                    </View>
                  </View>
                ))
              )}

              {/* Algorithm disclosure (FR73) */}
              {algorithm != null && (
                <Pressable
                  style={styles.algorithmToggle}
                  onPress={() => setAlgorithmExpanded((v) => !v)}
                >
                  <Text style={styles.algorithmToggleText}>
                    {algorithmExpanded ? t('picker.howWePickHide') : t('picker.howWePickShow')}
                  </Text>
                </Pressable>
              )}

              {algorithmExpanded && algorithm != null && (
                <View style={styles.algorithmBox}>
                  <Text style={styles.algorithmTitle}>{t('picker.algorithmTitle')}</Text>
                  <Text style={styles.algorithmRow}>
                    {t('picker.algorithmPrice', { weight: algorithm.weights.price })}
                  </Text>
                  <Text style={styles.algorithmRow}>
                    {t('picker.algorithmDistance', { weight: algorithm.weights.distance })}
                  </Text>
                  <Text style={styles.algorithmRow}>
                    {t('picker.algorithmFreshness', { weight: algorithm.weights.freshness })}
                  </Text>
                  <Text style={styles.algorithmRow}>
                    {t('picker.algorithmDeals', { weight: algorithm.weights.deals })}
                  </Text>
                </View>
              )}

              {/* Close */}
              <Pressable style={styles.closeButton} onPress={onDismiss}>
                <Text style={styles.closeButtonText}>{t('picker.close')}</Text>
              </Pressable>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 12,
    maxHeight: '80%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: tokens.neutral.n200,
    alignSelf: 'center',
    marginBottom: 12,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: tokens.brand.ink,
    marginBottom: 12,
  },
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: tokens.neutral.n500,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  emptyText: {
    fontSize: 14,
    color: tokens.neutral.n500,
    textAlign: 'center',
  },
  card: {
    borderWidth: 1,
    borderColor: tokens.neutral.n200,
    borderRadius: tokens.radius.md,
    padding: 12,
    marginBottom: 12,
  },
  rankBadge: {
    alignSelf: 'flex-start',
    backgroundColor: tokens.brand.accent,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginBottom: 8,
  },
  rankText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#ffffff',
    textTransform: 'uppercase',
  },
  stationName: {
    fontSize: 16,
    fontWeight: '700',
    color: tokens.brand.ink,
    marginBottom: 2,
  },
  stationAddress: {
    fontSize: 13,
    color: tokens.neutral.n500,
    marginBottom: 8,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  priceText: {
    fontSize: 18,
    fontWeight: '700',
    color: tokens.brand.ink,
  },
  freshnessBadge: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  freshBadge:   { backgroundColor: '#dcfce7' },
  staleBadge:   { backgroundColor: '#fef9c3' },
  unknownBadge: { backgroundColor: tokens.neutral.n100 },
  freshnessText: {
    fontSize: 11,
    fontWeight: '600',
  },
  distanceText: {
    fontSize: 13,
    color: tokens.neutral.n500,
    marginBottom: 8,
  },
  dealChip: {
    alignSelf: 'flex-start',
    backgroundColor: '#fef3c7',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginBottom: 10,
  },
  dealChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#92400e',
  },
  cardActions: {
    flexDirection: 'row',
    gap: 8,
  },
  navigateButton: {
    flex: 1,
    backgroundColor: tokens.brand.accent,
    borderRadius: tokens.radius.md,
    paddingVertical: 10,
    alignItems: 'center',
  },
  navigateButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#ffffff',
  },
  detailsButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: tokens.neutral.n300,
    borderRadius: tokens.radius.md,
    paddingVertical: 10,
    alignItems: 'center',
  },
  detailsButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: tokens.brand.ink,
  },
  algorithmToggle: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  algorithmToggleText: {
    fontSize: 13,
    color: tokens.brand.accent,
    textDecorationLine: 'underline',
  },
  algorithmBox: {
    backgroundColor: tokens.neutral.n50,
    borderRadius: tokens.radius.md,
    padding: 12,
    marginBottom: 12,
  },
  algorithmTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: tokens.brand.ink,
    marginBottom: 6,
  },
  algorithmRow: {
    fontSize: 13,
    color: tokens.neutral.n600,
    lineHeight: 20,
  },
  closeButton: {
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 4,
  },
  closeButtonText: {
    fontSize: 14,
    color: tokens.neutral.n500,
  },
  dismissButton: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: tokens.neutral.n300,
    borderRadius: tokens.radius.md,
  },
  dismissButtonText: {
    fontSize: 14,
    color: tokens.brand.ink,
  },
});
```

### "Pick for me" FAB

**File:** `apps/mobile/src/components/map/PickerFab.tsx` (new)

```typescript
import React from 'react';
import { Pressable, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { tokens } from '../../design/tokens';

interface Props {
  onPress:  () => void;
  loading:  boolean;
  disabled?: boolean;
}

export function PickerFab({ onPress, loading, disabled }: Props) {
  return (
    <Pressable
      style={[styles.fab, (disabled || loading) && styles.fabDisabled]}
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityLabel="Pick for me"
      accessibilityRole="button"
    >
      {loading
        ? <ActivityIndicator size="small" color="#ffffff" />
        : <Text style={styles.label}>✦</Text>
      }
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: tokens.brand.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 4,
  },
  fabDisabled: {
    opacity: 0.5,
  },
  label: {
    fontSize: 20,
    color: '#ffffff',
  },
});
```

### Wiring into `index.tsx` (map screen)

**File:** `apps/mobile/app/(app)/index.tsx` (modify existing)

Add the following to the map screen. Keep all existing logic intact.

**Imports to add:**
```typescript
import { useStationPicker, PickerState } from '../../src/hooks/useStationPicker';
import { PickerFab } from '../../src/components/map/PickerFab';
import { PickerFuelSelectorSheet } from '../../src/components/picker/PickerFuelSelectorSheet';
import { PickerResultSheet } from '../../src/components/picker/PickerResultSheet';
import { FuelType } from '../../src/api/stations';
```

**State additions inside `MapScreen`:**
```typescript
// Existing: activeFuelTypeFilter (from Story 2.3 fuel pill filter, or null if none)
// If no fuel pill filter state exists yet, add: const [activeFuelTypeFilter, setActiveFuelTypeFilter] = useState<FuelType | null>(null);

const {
  pickerState,
  recommendations,
  algorithm,
  errorMessage,
  openPicker,
  triggerPicker,
  clearPicker,
} = useStationPicker();
```

**FAB handler:**
```typescript
const handlePickerFabPress = useCallback(() => {
  if (activeFuelTypeFilter) {
    // Fuel type already selected from map filter — skip selector
    openPicker(activeFuelTypeFilter);
    const pos = location ?? { lat: 52.2297, lng: 21.0122 }; // Warsaw fallback
    triggerPicker(activeFuelTypeFilter, pos.lat, pos.lng, accessToken ?? null);
  } else {
    openPicker(null);  // Show fuel type selector
  }
}, [activeFuelTypeFilter, location, accessToken, openPicker, triggerPicker]);

const handleFuelTypeSelected = useCallback((fuelType: FuelType) => {
  const pos = location ?? { lat: 52.2297, lng: 21.0122 };
  triggerPicker(fuelType, pos.lat, pos.lng, accessToken ?? null);
}, [location, accessToken, triggerPicker]);
```

**FAB placement in JSX — add in the FAB container alongside the existing re-centre FAB:**
```tsx
{/* FAB row — bottom right corner above safe area */}
<View style={styles.fabRow}>
  <PickerFab
    onPress={handlePickerFabPress}
    loading={pickerState === 'loading'}
    disabled={pickerState === 'loading'}
  />
  {/* Existing re-centre FAB remains here */}
  {/* <RecentreFab ... /> */}
</View>
```

**Add `fabRow` to the map screen `StyleSheet`:**
```typescript
fabRow: {
  position: 'absolute',
  bottom: 24 + insets.bottom,
  right: 16,
  flexDirection: 'row',
  gap: 10,
  alignItems: 'center',
},
```

**Sheets in JSX (after existing sheets):**
```tsx
<PickerFuelSelectorSheet
  visible={pickerState === 'selecting-fuel'}
  onSelect={handleFuelTypeSelected}
  onCancel={clearPicker}
/>

<PickerResultSheet
  visible={pickerState === 'result' || pickerState === 'loading' || pickerState === 'error'}
  loading={pickerState === 'loading'}
  recommendations={recommendations}
  algorithm={algorithm}
  errorMessage={errorMessage}
  onDismiss={clearPicker}
  onViewDetails={(station) => setSelectedStation(station)}
/>
```

### i18n keys

**Add to `picker` namespace in `en.ts`, `pl.ts`, `uk.ts`:**

**`apps/mobile/src/i18n/locales/en.ts`:**
```typescript
picker: {
  selectFuelType:    'Select fuel type',
  cancel:            'Cancel',
  loading:           'Finding best stations…',
  resultsTitle:      'Recommended stations',
  bestMatch:         'Best match',
  goodMatch:         'Good match',
  fresh:             'Fresh',
  stale:             'Stale',
  unknown:           'Old data',
  hasActiveDeal:     'Has active offer',
  navigate:          'Navigate →',
  viewDetails:       'View details',
  howWePickShow:     'How we pick ▾',
  howWePickHide:     'How we pick ▴',
  algorithmTitle:    'Ranking factors',
  algorithmPrice:    'Price — {{weight}} (lower is better)',
  algorithmDistance: 'Distance — {{weight}} (closer is better)',
  algorithmFreshness:'Data freshness — {{weight}}',
  algorithmDeals:    'Active deals — {{weight}}',
  noResults:         'No stations with price data found nearby. Try a larger radius.',
  close:             'Close',
},
```

**`apps/mobile/src/i18n/locales/pl.ts`:**
```typescript
picker: {
  selectFuelType:    'Wybierz rodzaj paliwa',
  cancel:            'Anuluj',
  loading:           'Szukam najlepszych stacji…',
  resultsTitle:      'Polecane stacje',
  bestMatch:         'Najlepsza',
  goodMatch:         'Dobra opcja',
  fresh:             'Aktualna',
  stale:             'Stara',
  unknown:           'Przestarzała',
  hasActiveDeal:     'Ma aktywną ofertę',
  navigate:          'Nawiguj →',
  viewDetails:       'Szczegóły',
  howWePickShow:     'Jak wybieramy ▾',
  howWePickHide:     'Jak wybieramy ▴',
  algorithmTitle:    'Czynniki rankingu',
  algorithmPrice:    'Cena — {{weight}} (niższa = lepsza)',
  algorithmDistance: 'Odległość — {{weight}} (bliżej = lepiej)',
  algorithmFreshness:'Aktualność danych — {{weight}}',
  algorithmDeals:    'Aktywne oferty — {{weight}}',
  noResults:         'Nie znaleziono stacji z danymi cenowymi w pobliżu. Spróbuj większego promienia.',
  close:             'Zamknij',
},
```

**`apps/mobile/src/i18n/locales/uk.ts`:**
```typescript
picker: {
  selectFuelType:    'Оберіть тип пального',
  cancel:            'Скасувати',
  loading:           'Шукаю найкращі станції…',
  resultsTitle:      'Рекомендовані станції',
  bestMatch:         'Найкраща',
  goodMatch:         'Хороший варіант',
  fresh:             'Свіжа',
  stale:             'Стара',
  unknown:           'Застаріла',
  hasActiveDeal:     'Є активна пропозиція',
  navigate:          'Навігація →',
  viewDetails:       'Деталі',
  howWePickShow:     'Як ми обираємо ▾',
  howWePickHide:     'Як ми обираємо ▴',
  algorithmTitle:    'Фактори рейтингу',
  algorithmPrice:    'Ціна — {{weight}} (нижча = краще)',
  algorithmDistance: 'Відстань — {{weight}} (ближче = краще)',
  algorithmFreshness:'Актуальність даних — {{weight}}',
  algorithmDeals:    'Активні пропозиції — {{weight}}',
  noResults:         'Поруч не знайдено станцій з даними про ціни. Спробуйте більший радіус.',
  close:             'Закрити',
},
```

---

## Migration

No migration required. This story is entirely mobile-side and adds no new backend models.

---

## Tasks / Subtasks

- [ ] Mobile: `recommendStations()` added to `apps/mobile/src/api/stations.ts` with all picker types (AC: 12)
  - [ ] `RecommendationResult`, `AlgorithmExplanation`, `RecommendResponse` types exported
  - [ ] Omit `Authorization` header when `accessToken` is null/undefined

- [ ] Mobile: `useStationPicker` hook — `pickerState` FSM, `triggerPicker()`, `clearPicker()`, `openPicker()` (AC: 4, 9, 11)
  - [ ] `AbortController` cleanup on new trigger or unmount
  - [ ] `AbortError` caught silently — no error state set
  - [ ] File: `apps/mobile/src/hooks/useStationPicker.ts`

- [ ] Mobile: `PickerFab` component — 48×48 circle FAB, loading state, disabled state (AC: 1)
  - [ ] File: `apps/mobile/src/components/map/PickerFab.tsx`

- [ ] Mobile: `PickerFuelSelectorSheet` component — Modal with 5 fuel type options + cancel (AC: 2)
  - [ ] File: `apps/mobile/src/components/picker/PickerFuelSelectorSheet.tsx`

- [ ] Mobile: `PickerResultSheet` component (AC: 3–10)
  - [ ] Up to 2 station cards with name, address, price, freshness badge, distance
  - [ ] "Has active offer" deal chip when `has_active_deal: true` (AC: 6, FR74)
  - [ ] "Best match" / "Good match" rank badges
  - [ ] "Navigate" button — `Linking.openURL` with platform-appropriate URL (AC: 8, FR75)
  - [ ] "View details" button — calls `onViewDetails` to open `StationDetailSheet` (AC: 9)
  - [ ] "How we pick" expandable section listing all 4 factors + weights (AC: 7, FR73)
  - [ ] Loading state with `ActivityIndicator`
  - [ ] Empty state copy when `recommendations.length === 0` (AC: 10)
  - [ ] Error state with dismiss (AC: 11)
  - [ ] File: `apps/mobile/src/components/picker/PickerResultSheet.tsx`

- [ ] Mobile: Wire into `apps/mobile/app/(app)/index.tsx` (AC: 1, 2, 3)
  - [ ] FAB row with `PickerFab` placed to the left of re-centre FAB (AC: 1)
  - [ ] `handlePickerFabPress` — skips fuel selector when `activeFuelTypeFilter` is set (AC: 3)
  - [ ] `handleFuelTypeSelected` — calls `triggerPicker` with location fallback
  - [ ] `PickerFuelSelectorSheet` mounted conditionally on `pickerState === 'selecting-fuel'`
  - [ ] `PickerResultSheet` mounted for `result | loading | error` states
  - [ ] `onViewDetails` mapped to set `selectedStation` → opens `StationDetailSheet`

- [ ] Mobile: i18n — `picker.*` keys in `en.ts`, `pl.ts`, `uk.ts` (all ACs with text)

- [ ] Mobile: `tsc --noEmit` — zero errors (AC: 12)

---

## Dev Notes

### FAB Placement

The existing re-centre FAB from Story 2.2 is positioned `bottom: 24 + insets.bottom, right: 16` (or similar). Place the `PickerFab` in the same `View` container using `flexDirection: 'row'` with a gap. The PickerFab should be to the LEFT of the re-centre button. Both FABs should be the same height so they align vertically. If the existing re-centre FAB is sized differently (e.g. 44px), set `PickerFab` to match.

### Accessing `activeFuelTypeFilter` from Map Context

Story 2.3 introduced fuel type filter pills on the map screen. The selected fuel type is likely stored as `useState` in `index.tsx` or in a map context/store. Before calling `triggerPicker`, read the currently active filter. If it is `null` (all fuels visible), show the fuel type selector. If a specific fuel type is active (e.g. `'PB_95'`), skip the selector and fire immediately.

If the map screen uses a different variable name for the active fuel type filter, adapt the integration accordingly — the principle is the same.

### `StationDto` shape for `onViewDetails`

`StationDetailSheet` (Story 2.5) expects a `StationDto` with `{ id, name, address, google_places_id, lat, lng }`. The `RecommendationResult` from the API contains all these fields except `google_places_id` (which can be `null`). The `handleViewDetails` function in `PickerResultSheet` performs this mapping inline. If `StationDto` gains new required fields in a future story, update the mapping.

### GPS Location Fallback

`useLocation` from Story 2.2 provides the current GPS position. If `location` is `null` (GPS not yet resolved or permission denied), use the Warsaw fallback `{ lat: 52.2297, lng: 21.0122 }`. This matches the existing fallback pattern in the map screen's Camera component.

### No New Packages Required

This story uses only:
- `react-native` core (`Modal`, `Pressable`, `Linking`, `Platform`)
- `react-native-safe-area-context` (already installed for Story 2.5)
- `react-i18next` (already installed)
- Existing `tokens` design system

Do NOT add `@gorhom/bottom-sheet` or any new third-party sheet library. The `Modal`-based sheet pattern from `StationDetailSheet` and `FuelTypePickerSheet` is sufficient and keeps the bundle size flat.

### Score Bar — Deferred

The `score_breakdown` and `score` fields are returned by the API but are not surfaced in the result card UI for MVP. The rank badges ("Best match" / "Good match") convey the relative ranking without needing a numeric score bar. The score bar can be added in a follow-up polish story if UX testing shows users want it.

### Algorithm Disclosure — Always Present

The "How we pick" section must always be rendered when `algorithm !== null` (i.e. whenever there are any results or an empty result). Do not hide this section even on empty state — FR73 requires that the declared factors are always disclosed when the picker is used.

### `tokens.neutral.n50` / `tokens.neutral.n600`

The `PickerResultSheet` styles reference `tokens.neutral.n50` and `tokens.neutral.n600`. Verify these token keys exist in the design tokens file. If not, substitute the nearest available token (e.g. `n100` for background, `n500` for text). Do not hardcode hex values — always use tokens.

---

## Dev Agent Record

### Agent Model Used

_to be filled by implementing agent_

### Debug Log References

_to be filled by implementing agent_

### Completion Notes List

_to be filled by implementing agent_

### File List

**Mobile (new):**
- `apps/mobile/src/hooks/useStationPicker.ts`
- `apps/mobile/src/components/map/PickerFab.tsx`
- `apps/mobile/src/components/picker/PickerFuelSelectorSheet.tsx`
- `apps/mobile/src/components/picker/PickerResultSheet.tsx`

**Mobile (modified):**
- `apps/mobile/src/api/stations.ts`
- `apps/mobile/app/(app)/index.tsx`
- `apps/mobile/src/i18n/locales/en.ts`
- `apps/mobile/src/i18n/locales/pl.ts`
- `apps/mobile/src/i18n/locales/uk.ts`

**Artifacts:**
- `_bmad-output/implementation-artifacts/11-2-station-picker-ui.md`

### Change Log

_to be filled by implementing agent_
