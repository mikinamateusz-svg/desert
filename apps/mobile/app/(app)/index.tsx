import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StatusBar, ScrollView } from 'react-native';
import Mapbox, { MapView, Camera, ShapeSource, CircleLayer } from '@rnmapbox/maps';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tokens } from '../../src/theme';
import type GeoJSON from 'geojson';
import type { FuelType } from '@desert/types';

type OnPressEvent = {
  features: GeoJSON.Feature[];
  coordinates: { latitude: number; longitude: number };
  point: { x: number; y: number };
};
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../src/store/auth.store';
import { LoadingScreen, type LoadingStage } from '../../src/components/LoadingScreen';
import { SoftSignUpSheet } from '../../src/components/SoftSignUpSheet';
import { FuelTypePickerSheet } from '../../src/components/FuelTypePickerSheet';
import { useFuelTypePreference, VALID_FUEL_TYPES } from '../../src/hooks/useFuelTypePreference';
import { useLocation, type LocationCoords } from '../../src/hooks/useLocation';
import { useNearbyStations } from '../../src/hooks/useNearbyStations';
import { useNearbyPrices } from '../../src/hooks/useNearbyPrices';
import { computePriceColorMap, PRICE_COLORS } from '../../src/utils/priceColor';
import type { PriceColor } from '../../src/utils/priceColor';

// Mapbox token must be set before any MapView renders
Mapbox.setAccessToken(process.env['EXPO_PUBLIC_MAPBOX_TOKEN'] ?? '');

const WARSAW: LocationCoords = { lat: 52.2297, lng: 21.0122 };

function buildGeoJSON(
  stations: { id: string; name: string; lat: number; lng: number }[],
  colorMap: Map<string, PriceColor>,
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: stations.map(s => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
      properties: { id: s.id, name: s.name, priceColor: colorMap.get(s.id) ?? 'nodata' },
    })),
  };
}

export default function MapScreen() {
  const { t } = useTranslation();
  const { accessToken, hasSeenOnboarding } = useAuth();
  const { location, permissionDenied, loading: loadingGPS } = useLocation();
  const insets = useSafeAreaInsets();
  const topBarHeight = insets.top + 44;

  // Camera center: GPS location once resolved, Warsaw fallback if denied/error
  const [cameraCenter, setCameraCenter] = useState<[number, number]>([WARSAW.lng, WARSAW.lat]);
  // Fetch center: drives the station API calls; separate from camera so user can pan freely
  const [fetchCenter, setFetchCenter] = useState<LocationCoords | null>(null);
  const gpsCenteredRef = useRef(false);
  const [locationDeniedVisible, setLocationDeniedVisible] = useState(false);
  const [sheetDismissed, setSheetDismissed] = useState(false);
  const programmaticMoveRef = useRef(false);

  // Loading screen stage
  const [loadingStage, setLoadingStage] = useState<LoadingStage>('gps');
  const [splashVisible, setSplashVisible] = useState(true);
  const handleSplashHidden = useCallback(() => setSplashVisible(false), []);

  // Error banner state
  const [errorBannerVisible, setErrorBannerVisible] = useState(false);
  const errorDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce ref for region change
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // any: CameraRef not exported from @rnmapbox/maps package root (moduleResolution:bundler)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cameraRef = useRef<any>(null);

  const {
    fuelType: selectedFuelType,
    setFuelType: setSelectedFuelType,
    hasSeenPrompt: hasSeenFuelPrompt,
    markPromptSeen,
    loaded: fuelTypeLoaded,
  } = useFuelTypePreference();

  // Clean up timers on unmount
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (errorDismissRef.current) clearTimeout(errorDismissRef.current);
  }, []);

  // Once GPS resolves (or is denied), initialise camera and fetch center
  useEffect(() => {
    if (gpsCenteredRef.current) return;

    if (location) {
      gpsCenteredRef.current = true;
      programmaticMoveRef.current = true;
      setCameraCenter([location.lng, location.lat]);
      setFetchCenter(location);
    } else if (permissionDenied) {
      gpsCenteredRef.current = true;
      programmaticMoveRef.current = true;
      setFetchCenter(WARSAW);
      setLocationDeniedVisible(true);
    } else if (!loadingGPS) {
      // GPS failed without explicit denial (e.g. timeout)
      gpsCenteredRef.current = true;
      programmaticMoveRef.current = true;
      setFetchCenter(WARSAW);
    }
  }, [location, permissionDenied, loadingGPS]);

  const { stations, error: stationsError } = useNearbyStations(
    accessToken,
    fetchCenter,
  );

  const { prices, error: pricesError } = useNearbyPrices(accessToken, fetchCenter);

  // Advance loading splash stage as data arrives.
  // P2: guests (no token) and error states must still dismiss the splash.
  // D3: handle prices-before-stations independently.
  useEffect(() => {
    if (!splashVisible) return;
    // Guest or auth error — no data will ever arrive; dismiss immediately
    if (!accessToken) { setLoadingStage('done'); return; }
    // Network errors — don't leave the splash up indefinitely
    if (stationsError || pricesError) { setLoadingStage('done'); return; }
    // Normal data arrival
    if (stations.length > 0 && prices.length > 0) {
      setLoadingStage('done');
    } else if (stations.length > 0) {
      setLoadingStage('prices');
    } else if (prices.length > 0 && fetchCenter) {
      // Prices arrived before stations — show 'prices' stage, not 'stations'
      setLoadingStage('prices');
    } else if (fetchCenter) {
      setLoadingStage('stations');
    }
  }, [accessToken, fetchCenter, stations.length, prices.length, stationsError, pricesError, splashVisible]);

  // P2 timeout backstop — dismiss splash after 8s regardless of data state
  useEffect(() => {
    if (!splashVisible) return;
    const t = setTimeout(() => setLoadingStage('done'), 8000);
    return () => clearTimeout(t);
  }, [splashVisible]);

  // Compute relative price colour map for current viewport
  const priceColorMap = useMemo(
    () => computePriceColorMap(stations.map(s => s.id), prices, selectedFuelType),
    [stations, prices, selectedFuelType],
  );

  // Build GeoJSON with colour property baked in
  const geojson = useMemo(
    () => buildGeoJSON(stations, priceColorMap),
    [stations, priceColorMap],
  );

  // Auto-dismiss error banner after 4s (stations or prices failure)
  useEffect(() => {
    if (stationsError || pricesError) {
      setErrorBannerVisible(true);
      if (errorDismissRef.current) clearTimeout(errorDismissRef.current);
      errorDismissRef.current = setTimeout(() => setErrorBannerVisible(false), 4000);
    }
    return () => { if (errorDismissRef.current) clearTimeout(errorDismissRef.current); };
  }, [stationsError, pricesError]);

  const handleRegionChange = (feature: GeoJSON.Feature<GeoJSON.Point>) => {
    if (programmaticMoveRef.current) {
      programmaticMoveRef.current = false;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const [lng, lat] = feature.geometry.coordinates;
      setFetchCenter({ lat, lng });
    }, 500);
  };

  const handleRecentre = () => {
    if (!location) return;
    programmaticMoveRef.current = true;
    // P3: keep cameraCenter state in sync so Camera controlled prop doesn't snap back on re-render
    setCameraCenter([location.lng, location.lat]);
    // D1: setCamera fires a fresh animation even when coordinates haven't changed since last tap
    cameraRef.current?.setCamera({
      centerCoordinate: [location.lng, location.lat],
      animationMode: 'flyTo',
      animationDuration: 800,
    });
  };

  const handlePinPress = (event: OnPressEvent) => {
    const name = event.features[0]?.properties?.['name'] ?? 'Unknown';
    console.log('Station tapped:', name); // Story 2.5 opens station detail sheet
  };

  const showSheet = !accessToken && !hasSeenOnboarding && !sheetDismissed;
  // Show first-launch fuel picker once splash is gone, preference loaded, and prompt not yet seen
  const showFuelPicker = fuelTypeLoaded && !hasSeenFuelPrompt && !splashVisible && !showSheet;

  const handleFuelPickerSelect = useCallback((ft: typeof selectedFuelType) => {
    setSelectedFuelType(ft);
    markPromptSeen();
  }, [setSelectedFuelType, markPromptSeen]);

  const handleFuelPickerDismiss = useCallback(() => {
    // Explicitly persist PB_95 (AC3) and mark seen so prompt never shows again
    setSelectedFuelType('PB_95');
    markPromptSeen();
  }, [setSelectedFuelType, markPromptSeen]);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />

      <MapView
        style={styles.map}
        onRegionDidChange={handleRegionChange}
      >
        <Camera
          ref={cameraRef}
          defaultSettings={{ centerCoordinate: cameraCenter, zoomLevel: 13 }}
          centerCoordinate={cameraCenter}
          animationMode="flyTo"
          animationDuration={800}
        />

        <ShapeSource
          id="stations"
          shape={geojson}
          onPress={handlePinPress}
        >
          <CircleLayer
            id="station-pins"
            style={{
              circleColor: [
                'match', ['get', 'priceColor'],
                'cheap',     PRICE_COLORS.cheap,
                'mid',       PRICE_COLORS.mid,
                'expensive', PRICE_COLORS.expensive,
                PRICE_COLORS.nodata, // default fallback = nodata
              ] as unknown as string,
              circleRadius: 8,
              circleStrokeColor: tokens.neutral.n0,
              circleStrokeWidth: 1.5,
            }}
          />
        </ShapeSource>
      </MapView>

      {/* Fuel-drop loading splash */}
      {splashVisible && (
        <LoadingScreen stage={loadingStage} onHidden={handleSplashHidden} />
      )}

      {/* Stations error banner — auto-dismisses after 4s */}
      {errorBannerVisible && (
        <View style={styles.errorBanner} pointerEvents="none">
          <Text style={styles.errorBannerText}>{t('map.stationsLoadError')}</Text>
        </View>
      )}

      {/* Location denied banner — below top bar + fuel selector */}
      {locationDeniedVisible && (
        <View style={[styles.locationDeniedBanner, { top: topBarHeight + 64 }]}>
          <Text style={styles.locationDeniedText}>{t('map.locationDenied')}</Text>
          <TouchableOpacity
            onPress={() => setLocationDeniedVisible(false)}
            style={styles.locationDeniedDismiss}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="close" size={18} color={tokens.neutral.n400} />
          </TouchableOpacity>
        </View>
      )}

      {/* Fuel type selector — below top bar */}
      <View style={[styles.fuelSelector, { top: topBarHeight + 16 }]} pointerEvents="box-none">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.fuelSelectorContent}>
          {(VALID_FUEL_TYPES as FuelType[]).map(ft => (
            <TouchableOpacity
              key={ft}
              style={[styles.fuelPill, selectedFuelType === ft && styles.fuelPillActive]}
              onPress={() => setSelectedFuelType(ft)}
            >
              <Text style={[styles.fuelPillText, selectedFuelType === ft && styles.fuelPillTextActive]}>
                {t(`fuelTypes.${ft}`)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Top bar */}
      <View style={[styles.topBar, { paddingTop: insets.top }]}>
        <Text style={styles.wordmark}>
          litr<Text style={styles.wordmarkAccent}>o</Text>
        </Text>
        <View style={styles.topBarActions}>
          <TouchableOpacity
            style={styles.topBarButton}
            onPress={() => router.push('/(app)/alerts')}
            accessibilityLabel={t('map.openAlerts')}
          >
            <Ionicons name="notifications-outline" size={22} color={tokens.brand.ink} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.topBarButton}
            onPress={() => router.push('/(app)/account')}
            accessibilityLabel={t('map.openMenu')}
          >
            <Ionicons name="menu" size={22} color={tokens.brand.ink} />
          </TouchableOpacity>
        </View>
      </View>

      {/* GPS re-centre FAB */}
      <TouchableOpacity
        style={[styles.recentreFab, !location && styles.recentreFabDisabled]}
        onPress={handleRecentre}
        disabled={!location}
        accessibilityLabel={t('map.recentre')}
      >
        <Ionicons name="locate" size={22} color={tokens.neutral.n0} />
      </TouchableOpacity>

      <SoftSignUpSheet
        visible={showSheet}
        onDismiss={() => setSheetDismissed(true)}
      />

      <FuelTypePickerSheet
        visible={showFuelPicker}
        onSelect={handleFuelPickerSelect}
        onDismiss={handleFuelPickerDismiss}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: tokens.surface.warmPage,
  },
  map: {
    flex: 1,
  },

  // Top bar
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 40,
    paddingBottom: 10,
    paddingHorizontal: 16,
    backgroundColor: tokens.surface.card,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
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
  topBarActions: {
    flexDirection: 'row',
  },
  topBarButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Fuel type selector
  fuelSelector: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 10,
  },
  fuelSelectorContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 16,
    gap: 8,
    flexDirection: 'row',
  },
  fuelPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: tokens.radius.full,
    backgroundColor: 'rgba(26,26,26,0.85)', // semi-transparent ink — no token equivalent for rgba
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',   // semi-transparent white — no token equivalent for rgba
  },
  fuelPillActive: {
    backgroundColor: tokens.brand.accent,
    borderColor: tokens.brand.accent,
  },
  fuelPillText: {
    color: tokens.neutral.n200,
    fontSize: 13,
    fontWeight: '600',
  },
  fuelPillTextActive: {
    color: tokens.brand.ink,
  },

  // Error banner (auto-dismiss card)
  errorBanner: {
    position: 'absolute',
    bottom: 130,
    left: 14,
    right: 14,
    backgroundColor: tokens.surface.card,
    borderRadius: tokens.radius.md,
    borderLeftWidth: 4,
    borderLeftColor: tokens.price.expensive,
    paddingVertical: 12,
    paddingHorizontal: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.10,
    shadowRadius: 4,
    elevation: 3,
  },
  errorBannerText: {
    color: tokens.brand.ink,
    fontSize: 13,
  },

  // Location denied banner (card, below top bar + fuel selector)
  locationDeniedBanner: {
    position: 'absolute',
    // top is set dynamically via topBarHeight + 64 in JSX
    left: 14,
    right: 14,
    backgroundColor: tokens.surface.card,
    borderRadius: tokens.radius.md,
    borderLeftWidth: 4,
    borderLeftColor: tokens.brand.accent,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.10,
    shadowRadius: 4,
    elevation: 3,
  },
  locationDeniedText: {
    color: tokens.brand.ink,
    fontSize: 13,
    flex: 1,
    marginRight: 8,
  },
  locationDeniedDismiss: {
    padding: 2,
  },

  // GPS re-centre FAB
  recentreFab: {
    position: 'absolute',
    bottom: 70,
    right: 14,
    width: 48,
    height: 48,
    borderRadius: 24,
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
