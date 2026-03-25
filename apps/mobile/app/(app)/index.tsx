import { useEffect, useRef, useState } from 'react';
import { View, ActivityIndicator, Text, TouchableOpacity, StyleSheet, StatusBar } from 'react-native';
import Mapbox, { MapView, Camera, ShapeSource, CircleLayer } from '@rnmapbox/maps';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tokens } from '../../src/theme';
import type GeoJSON from 'geojson';

type OnPressEvent = {
  features: GeoJSON.Feature[];
  coordinates: { latitude: number; longitude: number };
  point: { x: number; y: number };
};
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../src/store/auth.store';
import { SoftSignUpSheet } from '../../src/components/SoftSignUpSheet';
import { useLocation, type LocationCoords } from '../../src/hooks/useLocation';
import { useNearbyStations } from '../../src/hooks/useNearbyStations';

// Mapbox token must be set before any MapView renders
Mapbox.setAccessToken(process.env['EXPO_PUBLIC_MAPBOX_TOKEN'] ?? '');

const WARSAW: LocationCoords = { lat: 52.2297, lng: 21.0122 };

function buildGeoJSON(stations: { id: string; name: string; lat: number; lng: number }[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: stations.map(s => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
      properties: { id: s.id, name: s.name },
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

  // Error banner state
  const [errorBannerVisible, setErrorBannerVisible] = useState(false);
  const errorDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce ref for region change
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const { stations, loading: loadingStations, error: stationsError } = useNearbyStations(
    accessToken,
    fetchCenter,
  );

  // Auto-dismiss error banner after 4s
  useEffect(() => {
    if (stationsError) {
      setErrorBannerVisible(true);
      if (errorDismissRef.current) clearTimeout(errorDismissRef.current);
      errorDismissRef.current = setTimeout(() => setErrorBannerVisible(false), 4000);
    }
    return () => { if (errorDismissRef.current) clearTimeout(errorDismissRef.current); };
  }, [stationsError]);

  const geojson = buildGeoJSON(stations);

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
    setCameraCenter([location.lng, location.lat]);
  };

  const handlePinPress = (event: OnPressEvent) => {
    const name = event.features[0]?.properties?.['name'] ?? 'Unknown';
    console.log('Station tapped:', name); // Story 2.5 opens station detail sheet
  };

  const showLoadingOverlay = loadingGPS || (loadingStations && stations.length === 0);
  const showSheet = !accessToken && !hasSeenOnboarding && !sheetDismissed;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />

      <MapView
        style={styles.map}
        onRegionDidChange={handleRegionChange}
      >
        <Camera
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
              circleColor: tokens.price.noData,  // price-tier colour added in Story 2.3
              circleRadius: 8,
              circleStrokeColor: tokens.neutral.n0,
              circleStrokeWidth: 1.5,
            }}
          />
        </ShapeSource>
      </MapView>

      {/* Loading overlay — starts below top bar */}
      {showLoadingOverlay && (
        <View
          style={[styles.loadingOverlay, { top: topBarHeight }]}
          pointerEvents="none"
        >
          <ActivityIndicator size="large" color={tokens.brand.accent} />
          <Text style={styles.loadingText}>{t('map.loadingMap')}</Text>
        </View>
      )}

      {/* Stations error banner — auto-dismisses after 4s */}
      {errorBannerVisible && (
        <View style={styles.errorBanner} pointerEvents="none">
          <Text style={styles.errorBannerText}>{t('map.stationsLoadError')}</Text>
        </View>
      )}

      {/* Location denied banner — dynamic offset below top bar */}
      {locationDeniedVisible && (
        <View style={[styles.locationDeniedBanner, { top: topBarHeight + 8 }]}>
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
        <Ionicons name="navigate" size={22} color={tokens.neutral.n0} />
      </TouchableOpacity>

      <SoftSignUpSheet
        visible={showSheet}
        onDismiss={() => setSheetDismissed(true)}
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

  // Loading overlay
  loadingOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    // top is set dynamically via topBarHeight in JSX
    backgroundColor: 'rgba(253,246,238,0.93)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    color: tokens.brand.ink,
    fontSize: 14,
    fontWeight: '500',
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

  // Location denied banner (card, below top bar)
  locationDeniedBanner: {
    position: 'absolute',
    // top is set dynamically via topBarHeight + 8 in JSX
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
