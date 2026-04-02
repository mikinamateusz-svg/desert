import { useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Modal,
  Alert,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import { File as FSFile, Paths } from 'expo-file-system';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { tokens } from '../../src/theme';
import { useLocation } from '../../src/hooks/useLocation';
import { useNearbyStations } from '../../src/hooks/useNearbyStations';
import { useAuth } from '../../src/store/auth.store';
import { useFuelTypePreference } from '../../src/hooks/useFuelTypePreference';
import { haversineMetres } from '../../src/utils/haversine';
import { enqueueSubmission } from '../../src/services/captureQueue';
import { LocationRequiredScreen } from '../../src/components/contribution/LocationRequiredScreen';
import { StationDisambiguationSheet } from '../../src/components/contribution/StationDisambiguationSheet';
import { PriceConfirmationCard } from '../../src/components/contribution/PriceConfirmationCard';
import type { FuelType } from '@desert/types';
import type { StationDto } from '../../src/api/stations';

const NEARBY_RADIUS_M = 200;
const MIN_FREE_BYTES = 5 * 1024 * 1024; // 5 MB
const BLUR_SIZE_THRESHOLD = 800; // bytes — below this → blurry proxy (JPEG file-size heuristic)

type ScreenState =
  | 'camera'
  | 'quality-check'
  | 'disambiguation'
  | 'confirm'
  | 'location-required'
  | 'error';

interface QualityFlag {
  blurry: boolean;
  dark: boolean;
}

interface CapturedPhoto {
  uri: string;
  gpsLat?: number;
  gpsLng?: number;
  capturedAt: string;
}

export default function CaptureScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { accessToken } = useAuth();
  const { location, permissionDenied } = useLocation();
  const { fuelType: storedFuelType } = useFuelTypePreference();
  const [permission] = useCameraPermissions();

  const params = useLocalSearchParams<{ locationDenied?: string }>();
  const locationDeniedParam = params.locationDenied === '1';

  const cameraRef = useRef<CameraView | null>(null);

  const [screenState, setScreenState] = useState<ScreenState>(
    locationDeniedParam || permissionDenied ? 'location-required' : 'camera',
  );
  const [cameraError, setCameraError] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);

  const [capturedPhoto, setCapturedPhoto] = useState<CapturedPhoto | null>(null);
  const [qualityFlag, setQualityFlag] = useState<QualityFlag | null>(null);

  const [selectedFuelType, setSelectedFuelType] = useState<FuelType>(storedFuelType);
  const [preselectedStationId, setPreselectedStationId] = useState<string | undefined>(undefined);

  // Reuse nearby stations hook — centre on current GPS while on camera screen
  const { stations } = useNearbyStations(accessToken, location);

  // Stations within NEARBY_RADIUS_M of current GPS
  const nearbyStations = location
    ? stations.filter(s =>
        haversineMetres(location.lat, location.lng, s.lat, s.lng) <= NEARBY_RADIUS_M,
      )
    : [];

  // GPS indicator text
  const gpsIndicator: string | null = (() => {
    if (!location) return t('contribution.gpsLocating');
    if (nearbyStations.length === 1) {
      const s = nearbyStations[0]!;
      const dist = Math.round(haversineMetres(location.lat, location.lng, s.lat, s.lng));
      return `📍 ${s.name} · ${dist}m`;
    }
    if (nearbyStations.length === 0) return t('contribution.gpsLocating');
    return null; // multiple — show nothing until post-capture disambiguation
  })();

  // Post-capture stations — filtered from the same hook output at capture time
  const [captureNearbyStations, setCaptureNearbyStations] = useState<StationDto[]>([]);


  const resolvedStation = preselectedStationId
    ? (stations.find(s => s.id === preselectedStationId) ?? null)
    : nearbyStations.length === 1
      ? nearbyStations[0] ?? null
      : null;

  const handleBack = useCallback(() => {
    router.back();
  }, []);

  const runQualityCheck = useCallback(async (uri: string): Promise<QualityFlag> => {
    try {
      // Downsample to 64×64 JPEG and use file size as a blur proxy:
      // sharp images have more high-frequency content → larger JPEG at compress:1.
      // NOTE: darkness check (AC7) is deferred — reading JPEG-encoded bytes does not
      // yield pixel luminance values. Requires pixel-level access not available via
      // expo-image-manipulator alone. Tracked as D5 in sprint-status.
      const sample = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 64, height: 64 } }],
        { format: ImageManipulator.SaveFormat.JPEG, compress: 1 },
      );
      const fileSize = new FSFile(sample.uri).size;

      return {
        blurry: fileSize < BLUR_SIZE_THRESHOLD,
        dark: false, // deferred — see D5
      };
    } catch {
      // Quality check failure is non-blocking — proceed as normal
      return { blurry: false, dark: false };
    }
  }, []);

  const handleCapture = useCallback(async () => {
    if (!cameraRef.current || isCapturing) return;
    setIsCapturing(true);

    try {
      // Storage check before writing
      const freeSpace = Paths.availableDiskSpace;
      if (freeSpace < MIN_FREE_BYTES) {
        Alert.alert(t('contribution.storageFull'));
        setIsCapturing(false);
        return;
      }

      const photo = await cameraRef.current.takePictureAsync({ quality: 1 });
      if (!photo) { setIsCapturing(false); return; }

      // Compress: max 1920px width, 75% JPEG quality
      const compressed = await ImageManipulator.manipulateAsync(
        photo.uri,
        [{ resize: { width: 1920 } }],
        { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG },
      );

      const gpsLat = location?.lat;
      const gpsLng = location?.lng;
      const capturedAt = new Date().toISOString();

      setCapturedPhoto({ uri: compressed.uri, gpsLat, gpsLng, capturedAt });
      // Compute post-capture nearby stations
      const nearbyAtCapture = location
        ? stations.filter(s =>
            haversineMetres(location.lat, location.lng, s.lat, s.lng) <= NEARBY_RADIUS_M,
          )
        : [];
      setCaptureNearbyStations(nearbyAtCapture);

      // Quality check
      const flag = await runQualityCheck(compressed.uri);
      if (flag.blurry || flag.dark) {
        setQualityFlag(flag);
        setScreenState('quality-check');
      } else if (nearbyAtCapture.length >= 2) {
        setScreenState('disambiguation');
      } else {
        if (nearbyAtCapture.length === 1) {
          setPreselectedStationId(nearbyAtCapture[0]!.id);
        }
        setScreenState('confirm');
      }
    } catch {
      setCameraError(true);
      setScreenState('error');
    } finally {
      setIsCapturing(false);
    }
  }, [cameraRef, isCapturing, location, stations, runQualityCheck, t]);

  const handleUseAnyway = useCallback(() => {
    if (captureNearbyStations.length >= 2) {
      setScreenState('disambiguation');
    } else {
      if (captureNearbyStations.length === 1) {
        setPreselectedStationId(captureNearbyStations[0]!.id);
      }
      setScreenState('confirm');
    }
  }, [captureNearbyStations]);

  const handleRetake = useCallback(() => {
    setCapturedPhoto(null);
    setQualityFlag(null);
    setPreselectedStationId(undefined);
    setScreenState('camera');
  }, []);

  const handleDisambiguationSelect = useCallback((stationId: string) => {
    setPreselectedStationId(stationId);
    setScreenState('confirm');
  }, []);

  const handleDisambiguationDismiss = useCallback(() => {
    setPreselectedStationId(undefined);
    setScreenState('confirm');
  }, []);

  const handleConfirm = useCallback(async (manualPrice: number | undefined) => {
    if (!capturedPhoto) return;
    try {
      await enqueueSubmission({
        photoUri: capturedPhoto.uri,
        fuelType: selectedFuelType,
        manualPrice,
        preselectedStationId,
        gpsLat: capturedPhoto.gpsLat,
        gpsLng: capturedPhoto.gpsLng,
        capturedAt: capturedPhoto.capturedAt,
      });
      router.replace('/(app)/confirm');
    } catch {
      // SQLite write failed (device storage full or DB error)
      Alert.alert(t('contribution.storageFull'));
    }
  }, [capturedPhoto, selectedFuelType, preselectedStationId, t]);

  // ── Location required ────────────────────────────────────────────────────
  if (screenState === 'location-required') {
    return (
      <LocationRequiredScreen onBack={handleBack} />
    );
  }

  // ── Camera hardware error ────────────────────────────────────────────────
  if (screenState === 'error' || cameraError || permission?.status === 'denied') {
    return (
      <View style={[styles.fullscreen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <Text style={styles.errorTitle}>{t('contribution.cameraUnavailable')}</Text>
        <TouchableOpacity style={styles.errorBack} onPress={handleBack} accessibilityRole="button">
          <Text style={styles.errorBackText}>{t('contribution.goBack')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* ── Camera viewfinder ─────────────────────────────────────────── */}
      {screenState === 'camera' && (
        <>
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing="back"
            onCameraReady={() => setCameraError(false)}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onMountError={() => { setCameraError(true); setScreenState('error'); }}
          />

          {/* GPS station indicator — top center */}
          {gpsIndicator && (
            <View style={[styles.gpsIndicator, { top: insets.top + 56 }]}>
              <Text style={styles.gpsIndicatorText}>{gpsIndicator}</Text>
            </View>
          )}

          {/* Cancel button — top left */}
          <TouchableOpacity
            style={[styles.cancelButton, { top: insets.top + 12 }]}
            onPress={handleBack}
            accessibilityRole="button"
          >
            <Text style={styles.cancelText}>{t('contribution.cancel')}</Text>
          </TouchableOpacity>

          {/* Framing guide — corner marks only */}
          <View style={styles.framingGuide} pointerEvents="none">
            <View style={[styles.corner, styles.cornerTL]} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />
          </View>

          {/* Frame hint */}
          <Text style={[styles.frameHint, { bottom: insets.bottom + 110 }]}>
            {t('contribution.frameHint')}
          </Text>

          {/* Capture button — bottom center */}
          <TouchableOpacity
            style={[styles.captureButton, { bottom: insets.bottom + 32 }]}
            onPress={() => void handleCapture()}
            disabled={isCapturing}
            accessibilityLabel={t('contribution.takePhoto')}
            accessibilityRole="button"
          />
        </>
      )}

      {/* ── Quality check modal ──────────────────────────────────────── */}
      <Modal
        transparent
        visible={screenState === 'quality-check'}
        animationType="fade"
      >
        <View style={styles.modalOverlay}>
          <View style={styles.qualityCard}>
            <Text style={styles.qualityMessage}>
              {qualityFlag?.blurry
                ? t('contribution.retakePrompt.blurry')
                : t('contribution.retakePrompt.dark')}
            </Text>
            <TouchableOpacity style={styles.retakeButton} onPress={handleRetake} accessibilityRole="button">
              <Text style={styles.retakeButtonText}>{t('contribution.retakePrompt.retake')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.useAnywayButton} onPress={handleUseAnyway} accessibilityRole="button">
              <Text style={styles.useAnywayText}>{t('contribution.retakePrompt.useAnyway')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Station disambiguation sheet ─────────────────────────────── */}
      <StationDisambiguationSheet
        visible={screenState === 'disambiguation'}
        stations={captureNearbyStations}
        onSelect={handleDisambiguationSelect}
        onDismiss={handleDisambiguationDismiss}
      />

      {/* ── Price confirmation card ───────────────────────────────────── */}
      {screenState === 'confirm' && (
        <View style={[StyleSheet.absoluteFill, styles.confirmOverlay]}>
          {/* Blurred photo thumbnail hint area */}
          <TouchableOpacity style={styles.confirmBackdrop} onPress={handleRetake} />
          <PriceConfirmationCard
            fuelType={selectedFuelType}
            stationName={resolvedStation?.name ?? null}
            onFuelTypeChange={setSelectedFuelType}
            onConfirm={(price) => void handleConfirm(price)}
            onWrongStation={() => {
              setPreselectedStationId(undefined);
              if (captureNearbyStations.length >= 2) {
                setScreenState('disambiguation');
              }
            }}
          />
        </View>
      )}
    </View>
  );
}

// Corner mark size and thickness
const CM = 24;
const CT = 3;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  fullscreen: {
    flex: 1,
    backgroundColor: tokens.surface.card,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: tokens.brand.ink,
    marginBottom: 24,
    textAlign: 'center',
  },
  errorBack: {
    backgroundColor: tokens.brand.accent,
    borderRadius: tokens.radius.full,
    paddingVertical: 12,
    paddingHorizontal: 28,
  },
  errorBackText: {
    color: tokens.brand.ink,
    fontSize: 16,
    fontWeight: '600',
  },

  // GPS indicator
  gpsIndicator: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: tokens.radius.full,
    paddingVertical: 6,
    paddingHorizontal: 14,
    zIndex: 10,
  },
  gpsIndicatorText: {
    color: tokens.neutral.n0,
    fontSize: 13,
    fontWeight: '500',
  },

  // Cancel button
  cancelButton: {
    position: 'absolute',
    left: 16,
    zIndex: 10,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  cancelText: {
    color: tokens.neutral.n0,
    fontSize: 16,
    fontWeight: '500',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },

  // Framing guide
  framingGuide: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  corner: {
    position: 'absolute',
    width: CM,
    height: CM,
    borderColor: tokens.neutral.n0,
  },
  cornerTL: {
    top: '25%',
    left: '10%',
    borderTopWidth: CT,
    borderLeftWidth: CT,
  },
  cornerTR: {
    top: '25%',
    right: '10%',
    borderTopWidth: CT,
    borderRightWidth: CT,
  },
  cornerBL: {
    bottom: '25%',
    left: '10%',
    borderBottomWidth: CT,
    borderLeftWidth: CT,
  },
  cornerBR: {
    bottom: '25%',
    right: '10%',
    borderBottomWidth: CT,
    borderRightWidth: CT,
  },

  // Frame hint
  frameHint: {
    position: 'absolute',
    alignSelf: 'center',
    color: 'rgba(255,255,255,0.75)',
    fontSize: 13,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },

  // Capture button
  captureButton: {
    position: 'absolute',
    alignSelf: 'center',
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: tokens.neutral.n0,
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.5)',
  },

  // Quality check modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  qualityCard: {
    backgroundColor: tokens.surface.card,
    borderRadius: tokens.radius.lg,
    padding: 24,
  },
  qualityMessage: {
    fontSize: 16,
    color: tokens.brand.ink,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 22,
  },
  retakeButton: {
    backgroundColor: tokens.brand.ink,
    borderRadius: tokens.radius.full,
    paddingVertical: 13,
    alignItems: 'center',
    marginBottom: 10,
  },
  retakeButtonText: {
    color: tokens.neutral.n0,
    fontSize: 16,
    fontWeight: '600',
  },
  useAnywayButton: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  useAnywayText: {
    color: tokens.neutral.n500,
    fontSize: 15,
  },

  // Confirmation overlay
  confirmOverlay: {
    justifyContent: 'flex-end',
  },
  confirmBackdrop: {
    flex: 1,
  },
});
