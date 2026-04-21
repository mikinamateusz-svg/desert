import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StatusBar, ScrollView, Linking, Alert } from 'react-native';
import Mapbox, { MapView, Camera, MarkerView } from '@rnmapbox/maps';
import Supercluster from 'supercluster';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tokens } from '../../src/theme';
import type GeoJSON from 'geojson';
import type { FuelType } from '@desert/types';
import { MapFABGroup } from '../../src/components/contribution/MapFABGroup';
import { useCameraPermission } from '../../src/hooks/useCameraPermission';
import { haversineMetres } from '../../src/utils/haversine';
import { StationPin } from '../../src/components/map/StationPin';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../src/store/auth.store';
import { LoadingScreen, type LoadingStage } from '../../src/components/LoadingScreen';
import { SoftSignUpSheet } from '../../src/components/SoftSignUpSheet';
import { FuelTypePickerSheet } from '../../src/components/FuelTypePickerSheet';
import { StationDetailSheet } from '../../src/components/StationDetailSheet';
import { useFuelTypePreference, VALID_FUEL_TYPES } from '../../src/hooks/useFuelTypePreference';
import { useLocation, type LocationCoords } from '../../src/hooks/useLocation';
import { useNearbyStations } from '../../src/hooks/useNearbyStations';
import { useNearbyPrices } from '../../src/hooks/useNearbyPrices';
import { computePriceColorMap } from '../../src/utils/priceColor';
import type { StationDto } from '../../src/api/stations';

// Mapbox token must be set before any MapView renders.
// In EAS builds, the token comes from eas.json env. In CI/local builds,
// the native android string resource mapbox_access_token is used as fallback.
const mapboxToken = process.env['EXPO_PUBLIC_MAPBOX_TOKEN'];
if (mapboxToken) {
  Mapbox.setAccessToken(mapboxToken);
}

const WARSAW: LocationCoords = { lat: 52.2297, lng: 21.0122 };

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
  const [viewportRadiusM, setViewportRadiusM] = useState(20_000);
  const [mapZoom, setMapZoom] = useState(13);
  const [mapBbox, setMapBbox] = useState<[number, number, number, number]>([-180, -90, 180, 90]);

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapViewRef = useRef<any>(null);
  const [noneInView, setNoneInView] = useState(false);

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

  // Compute relative price colours using stations within max(20km, viewport radius)
  // of the relevant anchor. Prefer the panned-to fetchCenter so the visible
  // viewport drives the comparison; fall back to GPS only before any pan happens.
  // (Previously anchored on GPS, which caused all visible pins to fall outside
  // the radius and render as 'nodata' when panning >20km from the user.)
  const MIN_COLOR_RADIUS_M = 20_000;
  const priceColorMap = useMemo(() => {
    const anchor = fetchCenter ?? location;
    if (!anchor) return computePriceColorMap(stations.map(s => s.id), prices, selectedFuelType);
    const radius = Math.max(MIN_COLOR_RADIUS_M, viewportRadiusM);
    const inRange = stations.filter(
      s => haversineMetres(anchor.lat, anchor.lng, s.lat, s.lng) <= radius,
    );
    return computePriceColorMap(inRange.map(s => s.id), prices, selectedFuelType);
  }, [stations, prices, selectedFuelType, location, fetchCenter, viewportRadiusM]);

  // Quick price lookup by stationId for pin labels
  const priceMap = useMemo(
    () => new Map(prices.map(p => [p.stationId, p])),
    [prices],
  );

  // Build cluster index from stations — recomputes when station list changes
  const clusterIndex = useMemo(() => {
    const index = new Supercluster<{ station: StationDto }>({
      radius: 35, // pixel radius for clustering — aligned with web
      maxZoom: 9, // above this zoom every station is an individual pin (country view only clusters)
    });
    index.load(
      stations.map(s => ({
        type: 'Feature' as const,
        properties: { station: s },
        geometry: { type: 'Point' as const, coordinates: [s.lng, s.lat] },
      })),
    );
    return index;
  }, [stations]);

  // Get visible clusters/points for the current viewport + zoom
  const clusters = useMemo(
    () => clusterIndex.getClusters(mapBbox, Math.floor(mapZoom)),
    [clusterIndex, mapBbox, mapZoom],
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

    // Track viewport radius, bbox, and zoom for clustering + price color population
    const props = feature.properties as { visibleBounds?: [[number, number], [number, number]]; zoomLevel?: number } | null;
    if (props?.visibleBounds) {
      const [[neLng, neLat], [swLng, swLat]] = props.visibleBounds;
      const centerLat = (neLat + swLat) / 2;
      const centerLng = (neLng + swLng) / 2;
      const radiusM = haversineMetres(centerLat, centerLng, neLat, neLng);
      setViewportRadiusM(radiusM);
      setMapBbox([swLng, swLat, neLng, neLat]);
    }
    if (typeof props?.zoomLevel === 'number') {
      setMapZoom(props.zoomLevel);
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const [lng, lat] = feature.geometry.coordinates;
      setFetchCenter({ lat, lng });
    }, 250);
  };

  const handleClusterPress = useCallback((clusterId: number, lng: number, lat: number) => {
    const expansionZoom = Math.min(clusterIndex.getClusterExpansionZoom(clusterId), 16);
    programmaticMoveRef.current = true;
    setCameraCenter([lng, lat]);
    cameraRef.current?.setCamera({
      centerCoordinate: [lng, lat],
      zoomLevel: expansionZoom,
      animationMode: 'flyTo',
      animationDuration: 500,
    });
  }, [clusterIndex]);

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

  // ── Contribution FAB ─────────────────────────────────────────────────────
  const { permissionGranted: cameraGranted, requestPermission: requestCamera } = useCameraPermission();
  // Separate gate for contribution flow — distinct from first-launch onboarding sheet
  const [showContributionGate, setShowContributionGate] = useState(false);

  const handleAddPrice = useCallback(async () => {
    if (!accessToken) {
      // AC2: guest — show sign-up sheet regardless of hasSeenOnboarding
      setShowContributionGate(true);
      return;
    }
    if (permissionDenied) {
      // AC3: location denied — navigate to LocationRequiredScreen via capture route
      router.push('/(app)/capture?locationDenied=1');
      return;
    }
    if (cameraGranted !== true) {
      // AC4: camera denied or status not yet loaded — request permission first
      const granted = await requestCamera();
      if (!granted) {
        Alert.alert(
          t('contribution.cameraPermissionDenied'),
          '',
          [
            { text: t('contribution.goToSettings'), onPress: () => void Linking.openSettings() },
            { text: t('contribution.cancel'), style: 'cancel' },
          ],
        );
        return;
      }
    }
    router.push('/(app)/capture');
  }, [accessToken, permissionDenied, cameraGranted, requestCamera, t]);

  const [selectedStation, setSelectedStation] = useState<StationDto | null>(null);

  const selectedStationPrices = useMemo(
    () => selectedStation
      ? (prices.find(p => p.stationId === selectedStation.id) ?? null)
      : null,
    [selectedStation, prices],
  );

  const handlePinPress = useCallback((stationId: string) => {
    const station = stations.find(s => s.id === stationId) ?? null;
    setSelectedStation(station);
    if (station) {
      programmaticMoveRef.current = true;
      cameraRef.current?.setCamera({
        centerCoordinate: [station.lng, station.lat],
        zoomLevel: 15,
        // paddingBottom shifts the effective viewport centre above the bottom sheet (~300px)
        padding: { paddingBottom: 320, paddingTop: 0, paddingLeft: 0, paddingRight: 0 },
        animationMode: 'flyTo',
        animationDuration: 600,
      });
    }
  }, [stations]);

  const handleFindCheapest = useCallback(async () => {
    const bounds = await mapViewRef.current?.getVisibleBounds();
    if (!bounds) return;
    // bounds = [[neLng, neLat], [swLng, swLat]]
    const [ne, sw] = bounds;
    const [east, north] = ne;
    const [west, south] = sw;

    const inView = stations.filter(s => {
      if (s.lat < south || s.lat > north || s.lng < west || s.lng > east) return false;
      const p = priceMap.get(s.id);
      const exact = p?.prices[selectedFuelType];
      const range = p?.priceRanges?.[selectedFuelType];
      return exact !== undefined || range !== undefined;
    });

    if (inView.length === 0) {
      setNoneInView(true);
      setTimeout(() => setNoneInView(false), 2500);
      return;
    }

    const getPrice = (s: StationDto): number => {
      const p = priceMap.get(s.id);
      const exact = p?.prices[selectedFuelType];
      if (exact !== undefined) return exact;
      const range = p?.priceRanges?.[selectedFuelType];
      return range ? (range.low + range.high) / 2 : Infinity;
    };

    const cheapest = inView.reduce((best, s) => getPrice(s) < getPrice(best) ? s : best);
    handlePinPress(cheapest.id);
  }, [stations, priceMap, selectedFuelType, handlePinPress]);

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
        ref={mapViewRef}
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

        {clusters.map(feature => {
          const [lng, lat] = feature.geometry.coordinates;
          const isCluster = (feature.properties as { cluster?: boolean }).cluster === true;

          if (isCluster) {
            const { cluster_id, point_count } = feature.properties as unknown as { cluster_id: number; point_count: number };
            const size = point_count < 10 ? 36 : point_count < 50 ? 44 : point_count < 200 ? 52 : 60;
            return (
              <MarkerView
                key={`cluster-${cluster_id}`}
                coordinate={[lng, lat]}
                anchor={{ x: 0.5, y: 0.5 }}
              >
                <TouchableOpacity
                  onPress={() => handleClusterPress(cluster_id, lng, lat)}
                  style={[styles.clusterBubble, { width: size, height: size, borderRadius: size / 2 }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Cluster of ${point_count} stations`}
                >
                  <Text style={[styles.clusterText, point_count >= 100 && styles.clusterTextSmall]}>
                    {point_count}
                  </Text>
                </TouchableOpacity>
              </MarkerView>
            );
          }

          const station = (feature.properties as { station: StationDto }).station;
          const priceData = priceMap.get(station.id);
          const priceColor = priceColorMap.get(station.id) ?? 'nodata';
          const range = priceData?.priceRanges?.[selectedFuelType];
          const reported = priceData?.prices[selectedFuelType];
          const isEstimated = range !== undefined || priceData?.estimateLabel?.[selectedFuelType] !== undefined;
          let label: string;
          if (range) {
            label = `~${((range.low + range.high) / 2).toFixed(2)}`;
          } else if (reported !== undefined) {
            label = `${isEstimated ? '~' : ''}${reported.toFixed(2)}`;
          } else {
            label = '?';
          }
          return (
            <MarkerView
              key={station.id}
              coordinate={[station.lng, station.lat]}
              anchor={{ x: 0.5, y: 1 }}
            >
              <StationPin
                priceColor={priceColor}
                label={label}
                isEstimated={isEstimated}
                isSelected={station.id === selectedStation?.id}
                onPress={() => handlePinPress(station.id)}
              />
            </MarkerView>
          );
        })}
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
          {/* Bell icon hidden for Phase 1 — alerts are Epic 6 (Phase 2).
              Re-enable when alert preferences and push notifications are implemented. */}
          <TouchableOpacity
            style={styles.topBarButton}
            onPress={() => router.push('/(app)/account')}
            accessibilityLabel={t('map.openMenu')}
          >
            <Ionicons name="menu" size={22} color={tokens.brand.ink} />
          </TouchableOpacity>
        </View>
      </View>

      <MapFABGroup
        onAddPrice={() => void handleAddPrice()}
        onCheapest={() => void handleFindCheapest()}
        onRecentre={handleRecentre}
        showCheapest={!selectedStation && !splashVisible}
        recentreEnabled={location != null}
      />

      {/* "None in view" toast */}
      {noneInView && (
        <View style={styles.cheapestToast} pointerEvents="none">
          <Text style={styles.cheapestToastText}>{t('map.cheapestNone')}</Text>
        </View>
      )}

      <SoftSignUpSheet
        visible={showSheet}
        onDismiss={() => setSheetDismissed(true)}
      />
      {/* AC2: contribution auth gate — shown for guests regardless of onboarding state */}
      <SoftSignUpSheet
        visible={showContributionGate}
        onDismiss={() => setShowContributionGate(false)}
        context="contribution"
      />

      <FuelTypePickerSheet
        visible={showFuelPicker}
        onSelect={handleFuelPickerSelect}
        onDismiss={handleFuelPickerDismiss}
      />

      <StationDetailSheet
        station={selectedStation}
        prices={selectedStationPrices}
        selectedFuel={selectedFuelType}
        onDismiss={() => setSelectedStation(null)}
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

  // Cluster bubble — amber brand-matching style
  clusterBubble: {
    backgroundColor: tokens.brand.accent,
    borderWidth: 3,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 6,
  },
  clusterText: {
    color: tokens.brand.ink,
    fontWeight: '700' as const,
    fontSize: 14,
  },
  clusterTextSmall: {
    fontSize: 12,
  },

  // Top bar
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 40,
    paddingBottom: 6,
    paddingHorizontal: 16,
    backgroundColor: tokens.surface.card,
    flexDirection: 'row',
    alignItems: 'center',
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

  cheapestToast: {
    position: 'absolute',
    bottom: 130,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: tokens.radius.full,
    backgroundColor: 'rgba(26,26,26,0.9)',
  },
  cheapestToastText: {
    color: tokens.neutral.n0,
    fontSize: 13,
  },
});
