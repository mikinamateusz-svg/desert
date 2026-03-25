import { useEffect, useRef, useState } from 'react';
import { View, ActivityIndicator, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Mapbox, { MapView, Camera, ShapeSource, CircleLayer } from '@rnmapbox/maps';
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

  // Camera center: GPS location once resolved, Warsaw fallback if denied/error
  const [cameraCenter, setCameraCenter] = useState<[number, number]>([WARSAW.lng, WARSAW.lat]);
  // Fetch center: drives the station API calls; separate from camera so user can pan freely
  const [fetchCenter, setFetchCenter] = useState<LocationCoords | null>(null);
  const gpsCenteredRef = useRef(false);
  const [locationDeniedVisible, setLocationDeniedVisible] = useState(false);
  const [sheetDismissed, setSheetDismissed] = useState(false);

  // Debounce ref for region change
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up debounce timer on unmount
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  // Once GPS resolves (or is denied), initialise camera and fetch center
  useEffect(() => {
    if (gpsCenteredRef.current) return;

    if (location) {
      gpsCenteredRef.current = true;
      setCameraCenter([location.lng, location.lat]);
      setFetchCenter(location);
    } else if (permissionDenied) {
      gpsCenteredRef.current = true;
      setFetchCenter(WARSAW);
      setLocationDeniedVisible(true);
    } else if (!loadingGPS) {
      // GPS failed without explicit denial (e.g. timeout)
      gpsCenteredRef.current = true;
      setFetchCenter(WARSAW);
    }
  }, [location, permissionDenied, loadingGPS]);

  const { stations, loading: loadingStations, error: stationsError } = useNearbyStations(
    accessToken,
    fetchCenter,
  );

  const geojson = buildGeoJSON(stations);

  const handleRegionChange = (feature: GeoJSON.Feature<GeoJSON.Point>) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const [lng, lat] = feature.geometry.coordinates;
      setFetchCenter({ lat, lng });
    }, 500);
  };

  const handlePinPress = (event: OnPressEvent) => {
    const name = event.features[0]?.properties?.['name'] ?? 'Unknown';
    console.log('Station tapped:', name); // Story 2.5 opens station detail sheet
  };

  const showLoadingOverlay = loadingGPS || (loadingStations && stations.length === 0);
  const showSheet = !accessToken && !hasSeenOnboarding && !sheetDismissed;

  return (
    <View style={styles.container}>
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
              circleColor: '#94a3b8',       // slate-400 — price-tier colour added in Story 2.3
              circleRadius: 8,
              circleStrokeColor: '#ffffff',
              circleStrokeWidth: 1.5,
            }}
          />
        </ShapeSource>
      </MapView>

      {/* Loading overlay */}
      {showLoadingOverlay && (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color="#f59e0b" />
          <Text style={styles.loadingText}>{t('map.loadingMap')}</Text>
        </View>
      )}

      {/* Stations error banner */}
      {stationsError && !showLoadingOverlay && (
        <View style={styles.errorBanner} pointerEvents="none">
          <Text style={styles.errorBannerText}>{t('map.stationsLoadError')}</Text>
        </View>
      )}

      {/* Location denied banner */}
      {locationDeniedVisible && (
        <View style={styles.locationDeniedBanner}>
          <Text style={styles.locationDeniedText}>{t('map.locationDenied')}</Text>
          <TouchableOpacity onPress={() => setLocationDeniedVisible(false)} style={styles.locationDeniedDismiss}>
            <Text style={styles.locationDeniedDismissText}>{t('map.locationDeniedDismiss')}</Text>
          </TouchableOpacity>
        </View>
      )}

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
    backgroundColor: '#1a1a1a',
  },
  map: {
    flex: 1,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(26,26,26,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    color: '#f9fafb',
    fontSize: 14,
  },
  errorBanner: {
    position: 'absolute',
    bottom: 80,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(239,68,68,0.9)',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  errorBannerText: {
    color: '#fff',
    fontSize: 13,
    textAlign: 'center',
  },
  locationDeniedBanner: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(26,26,26,0.9)',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  locationDeniedText: {
    color: '#d1d5db',
    fontSize: 13,
    flex: 1,
  },
  locationDeniedDismiss: {
    paddingLeft: 12,
  },
  locationDeniedDismissText: {
    color: '#f59e0b',
    fontSize: 13,
    fontWeight: '600',
  },
});
