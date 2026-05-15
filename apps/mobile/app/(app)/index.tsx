import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StatusBar, Linking, Alert } from 'react-native';
import Mapbox, { MapView, Camera, MarkerView } from '@rnmapbox/maps';
import Supercluster from 'supercluster';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tokens } from '../../src/theme';
import type GeoJSON from 'geojson';
import { MapFABGroup } from '../../src/components/contribution/MapFABGroup';
import { useCameraPermission } from '../../src/hooks/useCameraPermission';
import { haversineMetres } from '../../src/utils/haversine';
import { StationPin } from '../../src/components/map/StationPin';
import { FuelFilterPill, ChainFilterPill } from '../../src/components/map/MapFilterPills';
import { ChainFilterDemoteBanner } from '../../src/components/map/ChainFilterDemoteBanner';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../src/store/auth.store';
import { LoadingScreen, type LoadingStage } from '../../src/components/LoadingScreen';
import { SoftSignUpSheet } from '../../src/components/SoftSignUpSheet';
import { GuestEngagementCard } from '../../src/components/GuestEngagementCard';
import { MarketEventBanner } from '../../src/components/MarketEventBanner';
import { useGuestSessionCounter } from '../../src/hooks/useGuestSessionCounter';
import { apiGetMarketEventNudge } from '../../src/api/guest-nudge';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FuelTypePickerSheet } from '../../src/components/FuelTypePickerSheet';
import { ChainFilterSheet } from '../../src/components/ChainFilterSheet';
import { StationDetailSheet } from '../../src/components/StationDetailSheet';
import { useFuelTypePreference } from '../../src/hooks/useFuelTypePreference';
import { useChainFilterPreference, isStationInFilter } from '../../src/hooks/useChainFilterPreference';
import { brandMonogram } from '../../src/utils/brandMonogram';
import { useLocation, type LocationCoords } from '../../src/hooks/useLocation';
import { useNearbyStations } from '../../src/hooks/useNearbyStations';
import { useNearbyPrices } from '../../src/hooks/useNearbyPrices';
import { computePriceColorMap } from '../../src/utils/priceColor';
import type { StationDto } from '../../src/api/stations';
import { flags } from '../../src/config/flags';
import { TopChrome } from '../../src/components/TopChrome';
import { BellAlertIcon } from '../../src/components/alerts/BellAlertIcon';

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
  const { accessToken, hasSeenOnboarding, isGuest } = useAuth();
  // Story 6.9 — engagement card gate. Counter is mount-once; sessionCount
  // includes this open. AC1 threshold is 3+ sessions in a rolling 7d.
  const { sessionCount: guestSessionCount } = useGuestSessionCounter();
  const [marketEventNudge, setMarketEventNudge] = useState<{
    eventId: string;
  } | null>(null);
  const [engagementCardVisible, setEngagementCardVisible] = useState(false);
  const [engagementShownFlagLoaded, setEngagementShownFlagLoaded] = useState(false);
  const [engagementShownPersisted, setEngagementShownPersisted] = useState(false);
  // Story 3.12 AC6: Activity screen pushes /(app)?stationId=<id> to open a station
  // sheet. We handle it once per id via handledStationIdRef so the effect doesn't
  // re-fire on every stations/prices re-render.
  const { stationId: incomingStationId } = useLocalSearchParams<{ stationId?: string }>();
  const handledStationIdRef = useRef<string | null>(null);
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

  // Story 2.19 — chain filter state. Loaded async from AsyncStorage;
  // until it's loaded we treat the filter as inactive (no demotion).
  // `chainFilterChangeKey` bumps every time the selection changes so
  // the demote banner re-arms. Review patch F1 — consume the hook's
  // `loaded` flag and gate the demote pass with it; otherwise pins
  // render full-colour on cold start and flash demoted once storage
  // resolves.
  const {
    selectedBrands,
    toggleBrand,
    clearFilter: clearChainFilter,
    isFilterActive: isChainFilterActive,
    loaded: chainFilterLoaded,
  } = useChainFilterPreference();
  const [chainFilterChangeKey, setChainFilterChangeKey] = useState(0);
  const [chainSheetVisible, setChainSheetVisible] = useState(false);
  const [fuelSheetFromPillVisible, setFuelSheetFromPillVisible] = useState(false);
  // Review patch F25 — extract layout constants so the banner's topOffset
  // and the pill row's static top stay in sync if either changes.
  const PILL_ROW_TOP_GAP = 16;
  const PILL_ROW_HEIGHT = 40;
  const BANNER_GAP = 8;

  // Clean up timers on unmount
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
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

  const { stations, error: stationsError, refresh: refreshStations } = useNearbyStations(
    accessToken,
    fetchCenter,
  );

  const { prices, error: pricesError, refresh: refreshPrices } = useNearbyPrices(accessToken, fetchCenter);

  // Keep the map fresh:
  // - on focus (covers user returning from capture flow with their own contribution
  //   AND backgrounding/foregrounding the app)
  // - 60s poll while map is focused (covers other contributors' updates)
  // Stations rarely change, so they're only refreshed on focus, not polled.
  useFocusEffect(
    useCallback(() => {
      refreshStations();
      refreshPrices();
      const id = setInterval(refreshPrices, 60_000);
      return () => clearInterval(id);
    }, [refreshStations, refreshPrices]),
  );

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

  // Story 2.19 — demoted station count for the banner copy. Only matters
  // when the chain filter is active; otherwise the banner is hidden and
  // the count isn't read. Counted against `stations` (all in radius), NOT
  // the clustered set, so the count is stable across zoom levels.
  // Review patch F1 — gate on chainFilterLoaded to avoid computing
  // against the initial-empty selection before storage resolves.
  const demotedStationCount = useMemo(() => {
    if (!flags.chainFilter || !chainFilterLoaded || !isChainFilterActive) return 0;
    return stations.reduce(
      (n, s) => (isStationInFilter(s.brand, selectedBrands) ? n : n + 1),
      0,
    );
  }, [stations, selectedBrands, isChainFilterActive, chainFilterLoaded]);

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

  // Story 3.12 AC6: honour ?stationId= coming from the Activity screen.
  // Hold the intent until useNearbyStations actually returns the tapped id —
  // if the user is far from that station (different city) the first fetch
  // won't include it, but a later pan/refresh might, so we re-fire then.
  // Mark handled + clear the param ONLY after the sheet actually opens, so
  // the row doesn't silently no-op when the station is briefly out of scope.
  // Splash gate: avoid pre-positioning the camera + opening the sheet
  // beneath the LoadingScreen; user would land on a sheet they didn't see open.
  useEffect(() => {
    if (splashVisible) return;
    const id = Array.isArray(incomingStationId) ? incomingStationId[0] : incomingStationId;
    if (!id) {
      handledStationIdRef.current = null;
      return;
    }
    if (handledStationIdRef.current === id) return;
    if (stations.length === 0) return;
    if (stations.some(s => s.id === id)) {
      handledStationIdRef.current = id;
      handlePinPress(id);
      router.setParams({ stationId: '' });
    }
  }, [incomingStationId, stations, handlePinPress, splashVisible]);

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

  // ── Story 6.9 — guest conversion nudges ───────────────────────────────
  //
  // Two surfaces with precedence rules:
  //   - market event banner (AC6): fires within 48h of a community-rise
  //     event when the guest didn't get the push. Takes priority.
  //   - engagement card (AC1–AC3): fires after 3+ sessions in 7 days,
  //     once per device, deferred 2s after map load. Suppressed when
  //     the market banner is present.

  // Read the engagement-card one-time flag once per mount.
  useEffect(() => {
    if (!isGuest) return;
    let cancelled = false;
    void (async () => {
      try {
        const seen = await AsyncStorage.getItem('@guest:nudge:engagement:shown');
        if (!cancelled) setEngagementShownPersisted(seen === 'true');
      } catch {
        // Default to "seen" on storage failure so we don't pester the
        // user when state is uncertain.
        if (!cancelled) setEngagementShownPersisted(true);
      } finally {
        if (!cancelled) setEngagementShownFlagLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isGuest]);

  // Fetch market-event nudge state once per mount, gated by isGuest.
  // The banner shows only when (a) the Redis dedup key is alive AND
  // (b) the guest hasn't already dismissed this exact eventId.
  useEffect(() => {
    if (!isGuest) return;
    let cancelled = false;
    void (async () => {
      try {
        const nudge = await apiGetMarketEventNudge();
        if (cancelled || !nudge.active || !nudge.eventId) return;
        const perEventKey = `@guest:nudge:market:${nudge.eventId}`;
        const seen = await AsyncStorage.getItem(perEventKey);
        if (!cancelled && seen !== 'true') {
          setMarketEventNudge({ eventId: nudge.eventId });
        }
      } catch {
        // Silent — banner just won't show.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isGuest]);

  // Engagement card timer: deferred 2s after the splash clears so the
  // card doesn't interrupt initial map load. Suppressed when a market
  // banner is showing (AC3 — banner takes precedence) or when the
  // user has already seen the card on this device (AC2 — one-time).
  useEffect(() => {
    if (!isGuest) return;
    if (splashVisible) return;
    if (!engagementShownFlagLoaded) return;
    if (engagementShownPersisted) return;
    if (marketEventNudge !== null) return;
    if (guestSessionCount < 3) return;
    const timer = setTimeout(() => setEngagementCardVisible(true), 2000);
    return () => clearTimeout(timer);
  }, [
    isGuest,
    splashVisible,
    engagementShownFlagLoaded,
    engagementShownPersisted,
    marketEventNudge,
    guestSessionCount,
  ]);

  const dismissEngagementCard = useCallback(() => {
    setEngagementCardVisible(false);
    setEngagementShownPersisted(true);
    void AsyncStorage.setItem('@guest:nudge:engagement:shown', 'true').catch(() => {});
  }, []);

  const dismissMarketBanner = useCallback(() => {
    if (!marketEventNudge) return;
    const perEventKey = `@guest:nudge:market:${marketEventNudge.eventId}`;
    setMarketEventNudge(null);
    void AsyncStorage.setItem(perEventKey, 'true').catch(() => {});
  }, [marketEventNudge]);

  const handleMarketBannerSignIn = useCallback(() => {
    // Mark this event as seen so we don't re-show on return from the
    // auth flow if the user cancels mid-signup. AsyncStorage write is
    // fire-and-forget; the in-component navigation is handled inside
    // MarketEventBanner.
    if (marketEventNudge) {
      const perEventKey = `@guest:nudge:market:${marketEventNudge.eventId}`;
      void AsyncStorage.setItem(perEventKey, 'true').catch(() => {});
    }
    setMarketEventNudge(null);
  }, [marketEventNudge]);

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
          // Story 2.17 — flag is per-fuel; for the pin we only care about
          // the currently selected fuel (which is what the label shows).
          // The detail sheet handles the multi-fuel view separately.
          const isStale = priceData?.stalenessFlags?.[selectedFuelType] === true;
          // Story 2.19 — chain monogram + demote state. Monogram is only
          // rendered when the chain filter feature is enabled; demote is
          // only computed when the filter is active (selection non-empty).
          // Review patch F1 — gate isDemoted on chainFilterLoaded so cold
          // start doesn't render full-colour and then flash demoted.
          const monogram = flags.chainFilter ? brandMonogram(station.brand) : null;
          const isDemoted = flags.chainFilter
            && chainFilterLoaded
            && isChainFilterActive
            && !isStationInFilter(station.brand, selectedBrands);
          let label: string;
          if (range) {
            label = `~${((range.low + range.high) / 2).toFixed(2)}`;
          } else if (reported !== undefined) {
            label = `${isEstimated ? '~' : ''}${reported.toFixed(2)}`;
          } else {
            label = '?';
          }
          // Review patch F6 — a11y label: "<Chain>, <Fuel> <price> zł/l"
          // for screen readers. Falls through to localised
          // "Stacja niezależna" when brand is null/unknown.
          const brandKey = (station.brand ?? 'independent').toLowerCase();
          const chainName = t([`chainNames.${brandKey}`, 'chainNames.independent']);
          const fuelLabel = t(`fuelTypes.${selectedFuelType}`);
          const a11yLabel = label === '?'
            ? `${chainName}, ${fuelLabel} ${t('stationDetail.notAvailable')}`
            : `${chainName}, ${fuelLabel} ${label} zł/l`;
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
                isStale={isStale}
                isSelected={station.id === selectedStation?.id}
                monogram={monogram}
                isDemoted={isDemoted}
                accessibilityLabel={a11yLabel}
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

      {/* Story 6.10 / 6.13 — price-alerts bell icon. Hidden when flags.alertsLoop is off. */}
      <BellAlertIcon topInset={insets.top} />

      {/* Story 2.19 — two-pill filter row. Supersedes the scrolled fuel
          chip row from Story 2.4 / UI-8. Fuel pill is always rendered;
          chain pill is gated by flags.chainFilter. */}
      <View style={[styles.filterPillRow, { top: topBarHeight + PILL_ROW_TOP_GAP }]} pointerEvents="box-none">
        <FuelFilterPill
          fuelType={selectedFuelType}
          onPress={() => setFuelSheetFromPillVisible(true)}
        />
        {flags.chainFilter && (
          <ChainFilterPill
            selectedCount={selectedBrands.length}
            onPress={() => {
              // Review patch F20 — bump triggerKey on every pill re-tap
              // so the demote banner re-summons (AC6 letter). Without
              // this, the banner only re-appears on actual selection
              // change, not on a "remind me what's filtered" tap.
              setChainFilterChangeKey((k) => k + 1);
              setChainSheetVisible(true);
            }}
          />
        )}
      </View>

      {/* Story 2.19 — demote banner. Appears below the pill row each
          time the chain filter changes; auto-dismisses after 4s.
          Review patch F27 — skip banner render when no nearby stations
          are loaded yet; "N sieci aktywne · 0 wyciszonych" reads oddly
          when the map is mid-fetch. */}
      {flags.chainFilter && stations.length > 0 && (
        <ChainFilterDemoteBanner
          activeChainCount={selectedBrands.length}
          demotedStationCount={demotedStationCount}
          triggerKey={chainFilterChangeKey}
          onClear={() => {
            clearChainFilter();
            setChainFilterChangeKey((k) => k + 1);
          }}
          onTap={() => {
            setChainFilterChangeKey((k) => k + 1);
            setChainSheetVisible(true);
          }}
          topOffset={topBarHeight + PILL_ROW_TOP_GAP + PILL_ROW_HEIGHT + BANNER_GAP}
        />
      )}

      {/* Shared TopChrome — extracted so Activity + Log get the same wordmark
          + menu without duplicating the JSX. `overlay` mode positions it
          absolutely over the map canvas; tab screens use the default
          flex-flow mode. */}
      <TopChrome overlay />

      <MapFABGroup
        onAddPrice={() => void handleAddPrice()}
        onCheapest={() => void handleFindCheapest()}
        onRecentre={handleRecentre}
        showCheapest={!selectedStation && !splashVisible}
        recentreEnabled={location != null}
        // Phase 2 only — undefined when the flag is off (production EAS
        // profile / push builds with EXPO_PUBLIC_PHASE_2=false), in which
        // case MapFABGroup drops the Log fill-up FAB and renders a 3-FAB
        // row. Keeps the build-time gate consolidated here in index.tsx.
        onLogFillup={
          flags.phase2 && !splashVisible && !selectedStation
            ? () => {
                if (!accessToken) {
                  // Guests get the same auth gate as Add price — keeps the
                  // contribution paths symmetrical for sign-up nudges.
                  setShowContributionGate(true);
                  return;
                }
                // fillup-capture handles the no-vehicles guard inline.
                router.push('/(app)/fillup-capture');
              }
            : undefined
        }
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

      {/* Story 6.9 — market-event banner. Floats above the map without
          blocking interaction; positioned below the top chrome. */}
      {marketEventNudge && (
        <View style={[styles.marketBannerHost, { top: topBarHeight + 8 }]} pointerEvents="box-none">
          <MarketEventBanner
            eventId={marketEventNudge.eventId}
            onDismiss={dismissMarketBanner}
            onSignIn={handleMarketBannerSignIn}
          />
        </View>
      )}

      {/* Story 6.9 — engagement card (AC1). Suppressed when the market
          banner is present (AC3) or the user has previously seen it. */}
      <GuestEngagementCard
        visible={engagementCardVisible}
        onDismiss={dismissEngagementCard}
      />

      <FuelTypePickerSheet
        visible={showFuelPicker}
        onSelect={handleFuelPickerSelect}
        onDismiss={handleFuelPickerDismiss}
      />

      {/* Story 2.19 — fuel sheet opened from the fuel pill (change-mode).
          Distinct from the first-launch picker above: this one persists
          the selection but does NOT default to PB_95 on dismiss; tapping
          outside simply closes without changing the current fuel.
          Review patch F15 — only render when the first-launch picker is
          NOT visible; otherwise both modals could mount simultaneously
          and Android's animation gets confused. */}
      <FuelTypePickerSheet
        visible={fuelSheetFromPillVisible && !showFuelPicker}
        onSelect={(ft) => {
          setSelectedFuelType(ft);
          setFuelSheetFromPillVisible(false);
        }}
        onDismiss={() => setFuelSheetFromPillVisible(false)}
      />

      {/* Story 2.19 — chain filter sheet. Gated by flags.chainFilter so
          the modal subtree is dead code when the flag is off. */}
      {flags.chainFilter && (
        <ChainFilterSheet
          visible={chainSheetVisible}
          selectedBrands={selectedBrands}
          onToggle={(b) => {
            toggleBrand(b);
            setChainFilterChangeKey((k) => k + 1);
          }}
          onClearAll={() => {
            clearChainFilter();
            setChainFilterChangeKey((k) => k + 1);
          }}
          onDismiss={() => setChainSheetVisible(false)}
        />
      )}

      <StationDetailSheet
        station={selectedStation}
        prices={selectedStationPrices}
        selectedFuel={selectedFuelType}
        chainFilterActive={flags.chainFilter && isChainFilterActive}
        selectedChainBrands={selectedBrands}
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
  // Story 6.9 — host for the market-event banner. Absolute-positioned
  // above the map; pointerEvents='box-none' on the host so taps pass
  // through everywhere except the banner itself.
  marketBannerHost: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 5,
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

  // Story 2.19 — two-pill filter row (fuel + chain). Replaces the
  // scrolled fuel chip row from Story 2.4 / UI-8.
  filterPillRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 16,
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
