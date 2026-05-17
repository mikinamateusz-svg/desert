import { useRef, useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Modal,
  Alert,
  AppState,
  ActivityIndicator,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import { File as FSFile, Paths } from 'expo-file-system';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
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
import type { FuelType } from '@desert/types';
import type { StationDto } from '../../src/api/stations';
import type { CaptureTelemetry } from '../../src/types/contribution';

const NEARBY_RADIUS_M = 200;
const MIN_FREE_BYTES = 5 * 1024 * 1024; // 5 MB
const BLUR_SIZE_THRESHOLD = 800; // bytes — below this → blurry proxy (JPEG file-size heuristic)

// expo-camera's `zoom` is a normalized 0..1 value whose hardware mapping
// differs by device. These three steps give discoverable, predictable jumps
// without claiming an exact optical multiplier — labels are "feel" labels,
// not precise focal-length math.
const ZOOM_LEVELS = [
  { label: '1×', value: 0 },
  { label: '2×', value: 0.3 },
  { label: '5×', value: 0.6 },
] as const;

// If onCameraReady doesn't fire within this window, kick a remount.
// expo-camera occasionally mounts to a black preview on Android (lost session
// after backgrounding, mid-flight permission grant, etc.) and silently never
// recovers. We auto-remount up to MAX_AUTO_REMOUNTS times before showing the
// manual retry overlay — most stalls clear on the second mount.
const CAMERA_READY_TIMEOUT_MS = 4000;
const MAX_AUTO_REMOUNTS = 3;
// Delay between unmount and remount so the native camera session can fully
// tear down before we re-init. Without this, back-to-back remounts often
// stay stuck on the same broken session.
const REMOUNT_GAP_MS = 250;

// Story 3.20 — soft GPS gate on the shutter. Disabled until either GPS
// acquires or this timeout elapses. Tuned for "fast enough not to feel like
// friction; long enough to catch the common cold-fix case". Median outdoor
// first-fix on modern phones is ~2-4s, so 6s clears most healthy paths
// invisibly while bounding the wait for bad-GPS environments. Tune from
// telemetry post-launch.
const GPS_GATE_TIMEOUT_MS = 6000;

type ScreenState =
  | 'camera'
  | 'quality-check'
  | 'disambiguation'
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
  // Story 3.20 — captured at shutter-press; threaded through all three
  // submit paths (happy path, use-anyway from quality check, disambiguation).
  telemetry: CaptureTelemetry;
}

export default function CaptureScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { accessToken } = useAuth();
  const { location, permissionDenied, firstFixAtMs, resetFirstFix } = useLocation();
  const { fuelType: storedFuelType } = useFuelTypePreference();
  const [permission, requestPermission] = useCameraPermissions();

  const params = useLocalSearchParams<{ locationDenied?: string }>();
  const locationDeniedParam = params.locationDenied === '1';

  const cameraRef = useRef<CameraView | null>(null);

  const [screenState, setScreenState] = useState<ScreenState>(
    locationDeniedParam || permissionDenied ? 'location-required' : 'camera',
  );
  const [cameraError, setCameraError] = useState(false);
  // Captures the underlying error string from onMountError + watchdog timeout.
  // Surfaced on the error screen so we can collect actual failure reasons via
  // user screenshots while there's no remote telemetry wired up.
  const [cameraErrorDetail, setCameraErrorDetail] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);

  // Camera lifecycle plumbing for the black-preview fix:
  //   cameraKey forces a fresh mount of <CameraView/> when bumped.
  //   cameraReady flips on onCameraReady; armed false on every remount so the
  //     watchdog re-triggers if the new mount also stalls.
  //   showRetry surfaces the tap-to-retry overlay after CAMERA_READY_TIMEOUT_MS.
  const [cameraKey, setCameraKey] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [showRetry, setShowRetry] = useState(false);
  const [cameraMounted, setCameraMounted] = useState(true);
  const [zoomLevel, setZoomLevel] = useState<number>(0);
  const autoRemountCountRef = useRef(0);

  const remountCamera = useCallback(() => {
    setCameraReady(false);
    setShowRetry(false);
    setCameraError(false);
    // Unmount → wait → remount with a fresh key. The unmount step is what
    // makes auto-recovery actually work; bumping the React key while keeping
    // the component mounted often leaves the broken native session attached.
    setCameraMounted(false);
    setTimeout(() => {
      setCameraKey(k => k + 1);
      setCameraMounted(true);
    }, REMOUNT_GAP_MS);
  }, []);

  const [capturedPhoto, setCapturedPhoto] = useState<CapturedPhoto | null>(null);
  const [qualityFlag, setQualityFlag] = useState<QualityFlag | null>(null);

  const [selectedFuelType] = useState<FuelType>(storedFuelType);

  // Story 3.20 — GPS gate. The shutter is disabled until either GPS acquires
  // (`location != null`) or the override timer fires GPS_GATE_TIMEOUT_MS
  // after the screen mounts/remounts. `gateMountedAtRef` is the screen-mount
  // timestamp used to compute both the override fire moment and the
  // `gps_acquisition_ms` telemetry. `overrideActive` flips true when the
  // timer elapses without a GPS lock; flips back false on subsequent GPS
  // acquisition or screen remount.
  const gateMountedAtRef = useRef<number>(Date.now());
  const [overrideActive, setOverrideActive] = useState(false);

  // Reuse nearby stations hook — centre on current GPS while on camera screen
  const { stations } = useNearbyStations(accessToken, location);

  // Stations within NEARBY_RADIUS_M of current GPS
  const nearbyStations = location
    ? stations.filter(s =>
        haversineMetres(location.lat, location.lng, s.lat, s.lng) <= NEARBY_RADIUS_M,
      )
    : [];

  // GPS indicator text. Five rendering states:
  //   - no GPS, gate active        → "Locating..." (with caller adding spinner)
  //   - no GPS, override fired     → "No GPS — review will be manual"
  //   - GPS, exactly 1 nearby      → "📍 Station · Xm"
  //   - GPS, 0 nearby              → "No station nearby"
  //   - GPS, ≥2 nearby             → "📍 N stations nearby — pick after the photo"
  //
  // The multi-nearby branch used to render nothing (silent). Field feedback:
  // user can't tell whether "no indicator" means "still locating" or
  // "ambiguous match". The count tells them how much disambiguation work
  // is coming after the shutter; copy sets the expectation that they
  // pick the right station post-capture (which the existing
  // StationDisambiguationSheet already handles).
  const gpsIndicator: string | null = (() => {
    if (!location) {
      return overrideActive ? t('contribution.gpsOverride') : t('contribution.gpsLocating');
    }
    if (nearbyStations.length === 1) {
      const s = nearbyStations[0]!;
      const dist = Math.round(haversineMetres(location.lat, location.lng, s.lat, s.lng));
      return `📍 ${s.name} · ${dist}m`;
    }
    if (nearbyStations.length === 0) return t('contribution.gpsNoNearby');
    return t('contribution.gpsMultiNearby', { count: nearbyStations.length });
  })();

  // Post-capture stations — filtered from the same hook output at capture time
  const [captureNearbyStations, setCaptureNearbyStations] = useState<StationDto[]>([]);

  const handleBack = useCallback(() => {
    router.back();
  }, []);

  // First-launch camera permission: when status is 'undetermined' the OS hasn't
  // shown the prompt yet. expo-camera doesn't auto-prompt reliably on Android,
  // so we kick the request manually. canAskAgain guards a re-prompt loop after
  // the user denies — that path falls through to the existing 'denied' UI.
  useEffect(() => {
    if (permission?.status === 'undetermined' && permission.canAskAgain) {
      void requestPermission();
    }
  }, [permission?.status, permission?.canAskAgain, requestPermission]);

  // Force a fresh camera mount when the screen regains focus or the app
  // returns from background. expo-camera's native session is fragile across
  // these transitions and can leave the preview black. Bumping cameraKey is
  // cheap (sub-100ms remount) and reliably restores the live preview.
  // Also reset capture-flow state so a previous session's disambiguation
  // modal or captured photo doesn't bleed into a fresh capture attempt.
  useFocusEffect(
    useCallback(() => {
      setCapturedPhoto(null);
      setQualityFlag(null);
      setCaptureNearbyStations([]);
      setScreenState(prev => (prev === 'location-required' || prev === 'error' ? prev : 'camera'));
      remountCamera();
      // Story 3.20 — reset the GPS gate timer + override state + first-fix
      // timestamp on every focus. A user who switched apps and came back
      // gets a fresh 6s window AND a fresh acquisition-time measurement,
      // measured from this moment — not from the original mount or the
      // useLocation hook's first-ever fix (which could be minutes earlier
      // and produce a negative gps_acquisition_ms).
      gateMountedAtRef.current = Date.now();
      setOverrideActive(false);
      resetFirstFix();
    }, [remountCamera, resetFirstFix]),
  );

  // Story 3.20 — GPS gate timer. Fires GPS_GATE_TIMEOUT_MS after the screen
  // mount/focus and unlocks the shutter via `overrideActive`. Cleared on
  // GPS acquisition (effect dep on `location`), on override-already-active
  // (no-op), and on unmount. Re-arms whenever the screen regains focus.
  useEffect(() => {
    if (location) {
      // GPS acquired — clear any prior override state and skip arming the timer.
      if (overrideActive) setOverrideActive(false);
      return;
    }
    if (overrideActive) return; // already fired — nothing to arm
    const id = setTimeout(() => {
      setOverrideActive(true);
    }, GPS_GATE_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [location, overrideActive]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') remountCamera();
    });
    return () => sub.remove();
  }, [remountCamera]);

  // Reset auto-remount counter when the preview goes live — next stall
  // gets a fresh allowance.
  useEffect(() => {
    if (cameraReady) autoRemountCountRef.current = 0;
  }, [cameraReady]);

  // Watchdog: if onCameraReady doesn't fire within CAMERA_READY_TIMEOUT_MS,
  // auto-remount up to MAX_AUTO_REMOUNTS times before surfacing the retry
  // overlay so the user sees something instead of a frozen black preview.
  useEffect(() => {
    if (screenState !== 'camera') return;
    if (!permission?.granted) return;
    if (cameraReady) return;
    if (!cameraMounted) return;
    const id = setTimeout(() => {
      if (autoRemountCountRef.current < MAX_AUTO_REMOUNTS) {
        autoRemountCountRef.current += 1;
        remountCamera();
      } else {
        setShowRetry(true);
        setCameraErrorDetail(
          `onCameraReady did not fire within ${CAMERA_READY_TIMEOUT_MS}ms after ${MAX_AUTO_REMOUNTS} auto-remounts (mount #${cameraKey})`,
        );
      }
    }, CAMERA_READY_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [screenState, permission?.granted, cameraReady, cameraKey, cameraMounted, remountCamera]);

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
    // Story 3.20 — gate guard: shutter is disabled in JSX when !location &&
    // !overrideActive, but defend the handler too against any code path that
    // bypasses the disabled state (e.g. programmatic trigger).
    if (!location && !overrideActive) return;
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

      // Compute post-capture nearby stations
      const nearbyAtCapture = location
        ? stations.filter(s =>
            haversineMetres(location.lat, location.lng, s.lat, s.lng) <= NEARBY_RADIUS_M,
          )
        : [];
      setCaptureNearbyStations(nearbyAtCapture);

      // Story 3.20 — capture-screen telemetry. Computed at the moment the
      // user pressed the shutter; the queue helper threads it through to
      // the multipart payload. `gpsAcquisitionMs` is null when GPS never
      // acquired (override-fired path); `overrideUsed` is the inverse.
      const telemetry: CaptureTelemetry = {
        gpsAcquiredAtCapture: location != null,
        // Defensive Math.max(0, ...) — resetFirstFix() should make negatives
        // unreachable, but device-clock skew or a race between the focus
        // reset and an in-flight watch callback could still produce one.
        // Clamping to 0 preserves "GPS was instantly available" semantics
        // rather than letting the server filter reject as null.
        gpsAcquisitionMs:
          firstFixAtMs != null
            ? Math.max(0, firstFixAtMs - gateMountedAtRef.current)
            : null,
        overrideUsed: overrideActive,
        nearbyStationsCount: Math.min(nearbyAtCapture.length, 99),
      };

      setCapturedPhoto({ uri: compressed.uri, gpsLat, gpsLng, capturedAt, telemetry });

      // Quality check
      const flag = await runQualityCheck(compressed.uri);
      if (flag.blurry || flag.dark) {
        setQualityFlag(flag);
        setScreenState('quality-check');
      } else if (nearbyAtCapture.length >= 2) {
        setScreenState('disambiguation');
      } else {
        // Exactly 0 or 1 station — fire-and-forget, skip confirmation card
        const matchedId = nearbyAtCapture.length === 1 ? nearbyAtCapture[0]!.id : undefined;
        const matchedName = nearbyAtCapture.length === 1 ? nearbyAtCapture[0]!.name : undefined;
        try {
          await enqueueSubmission({
            photoUri: compressed.uri,
            fuelType: selectedFuelType,
            manualPrice: undefined,
            preselectedStationId: matchedId,
            gpsLat,
            gpsLng,
            capturedAt,
            telemetry,
          });
          router.replace({ pathname: '/(app)/confirm', params: { stationName: matchedName } });
        } catch {
          Alert.alert(t('contribution.storageFull'));
        }
      }
    } catch {
      setCameraError(true);
      setScreenState('error');
    } finally {
      setIsCapturing(false);
    }
  }, [cameraRef, isCapturing, location, stations, runQualityCheck, t, overrideActive, firstFixAtMs, selectedFuelType]);

  const handleUseAnyway = useCallback(async () => {
    if (captureNearbyStations.length >= 2) {
      setScreenState('disambiguation');
      return;
    }
    // 0 or 1 station — fire-and-forget like the happy path
    if (!capturedPhoto) return;
    const matchedId = captureNearbyStations.length === 1 ? captureNearbyStations[0]!.id : undefined;
    const matchedName = captureNearbyStations.length === 1 ? captureNearbyStations[0]!.name : undefined;
    try {
      await enqueueSubmission({
        photoUri: capturedPhoto.uri,
        fuelType: selectedFuelType,
        manualPrice: undefined,
        preselectedStationId: matchedId,
        gpsLat: capturedPhoto.gpsLat,
        gpsLng: capturedPhoto.gpsLng,
        capturedAt: capturedPhoto.capturedAt,
        telemetry: capturedPhoto.telemetry,
      });
      router.replace({ pathname: '/(app)/confirm', params: { stationName: matchedName } });
    } catch {
      Alert.alert(t('contribution.storageFull'));
    }
  }, [captureNearbyStations, capturedPhoto, selectedFuelType, t]);

  const handleRetake = useCallback(() => {
    setCapturedPhoto(null);
    setQualityFlag(null);
    setScreenState('camera');
  }, []);

  const handleDisambiguationSelect = useCallback(async (stationId: string) => {
    if (!capturedPhoto) return;
    const matchedStation = stations.find(s => s.id === stationId);
    try {
      await enqueueSubmission({
        photoUri: capturedPhoto.uri,
        fuelType: selectedFuelType,
        manualPrice: undefined,
        preselectedStationId: stationId,
        gpsLat: capturedPhoto.gpsLat,
        gpsLng: capturedPhoto.gpsLng,
        capturedAt: capturedPhoto.capturedAt,
        telemetry: capturedPhoto.telemetry,
      });
      router.replace({ pathname: '/(app)/confirm', params: { stationName: matchedStation?.name } });
    } catch {
      Alert.alert(t('contribution.storageFull'));
    }
  }, [capturedPhoto, stations, selectedFuelType, t]);

  // Dismissing disambiguation = "none of these is the right station" — there's
  // no reasonable submission to make in that case (backend would reject for
  // no_station_match), so retake the photo at the right place instead.
  const handleDisambiguationDismiss = useCallback(() => {
    setCapturedPhoto(null);
    setQualityFlag(null);
    setScreenState('camera');
  }, []);

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
        {cameraErrorDetail && (
          <Text style={styles.errorDetail} selectable>
            {cameraErrorDetail}
          </Text>
        )}
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
          {permission?.granted ? (
            cameraMounted ? (
              <CameraView
                key={cameraKey}
                ref={cameraRef}
                style={StyleSheet.absoluteFill}
                facing="back"
                zoom={zoomLevel}
                onCameraReady={() => { setCameraError(false); setCameraErrorDetail(null); setCameraReady(true); }}
                onMountError={(e: { message?: string } | undefined) => {
                  setCameraErrorDetail(e?.message ?? 'onMountError fired without a message');
                  setCameraError(true);
                  setScreenState('error');
                }}
              />
            ) : (
              // Brief gap between unmount and remount so the native session can
              // fully tear down. Without this, repeated remounts often stay
              // stuck on the same broken session.
              <View style={[StyleSheet.absoluteFill, styles.cameraLoading]} />
            )
          ) : (
            // Permission still loading or being requested — placeholder spinner
            // so the user doesn't see a black void while the OS prompt resolves.
            <View style={[StyleSheet.absoluteFill, styles.cameraLoading]}>
              <ActivityIndicator size="large" color={tokens.neutral.n0} />
            </View>
          )}

          {/* GPS station indicator — top center.
              Story 3.20 — adds a small spinner while GPS is acquiring (gate
              active, neither location nor override) so the user sees progress
              on a disabled shutter. Override-active state shows a ⚠ glyph
              instead, complementing the amber shutter border. */}
          {gpsIndicator && (
            <View style={[styles.gpsIndicator, { top: insets.top + 56 }]}>
              {!location && !overrideActive && (
                <ActivityIndicator
                  size="small"
                  color={tokens.neutral.n0}
                  style={styles.gpsIndicatorSpinner}
                />
              )}
              {overrideActive && !location && (
                <Text style={styles.gpsIndicatorWarning}>⚠ </Text>
              )}
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
          <Text style={[styles.frameHint, { bottom: insets.bottom + 168 }]}>
            {t('contribution.frameHint')}
          </Text>

          {/* Zoom selector — sits between the frame hint and the capture button */}
          <View style={[styles.zoomRow, { bottom: insets.bottom + 110 }]}>
            {ZOOM_LEVELS.map(({ label, value }) => {
              const active = value === zoomLevel;
              return (
                <TouchableOpacity
                  key={label}
                  style={[styles.zoomButton, active && styles.zoomButtonActive]}
                  onPress={() => setZoomLevel(value)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Zoom ${label}`}
                >
                  <Text style={[styles.zoomLabel, active && styles.zoomLabelActive]}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Capture button — bottom center.
              Story 3.20 — gated until GPS acquires OR the 6s override timer
              fires. When override is active, render a subtly-different
              warning style so the user notices they're proceeding without
              GPS (the indicator copy reinforces this). */}
          <TouchableOpacity
            style={[
              styles.captureButton,
              { bottom: insets.bottom + 32 },
              !location && !overrideActive && styles.captureButtonDisabled,
              overrideActive && !location && styles.captureButtonOverride,
            ]}
            onPress={() => void handleCapture()}
            disabled={isCapturing || !cameraReady || (!location && !overrideActive)}
            accessibilityLabel={t('contribution.takePhoto')}
            accessibilityState={{ disabled: !location && !overrideActive }}
            accessibilityRole="button"
          />

          {/* Watchdog overlay — shown if onCameraReady never fires. Whole
              surface is the tap target so retry doesn't depend on hitting a
              small button at distance from the user's thumb. */}
          {permission?.granted && !cameraReady && showRetry && (
            <TouchableOpacity
              style={styles.retryOverlay}
              onPress={remountCamera}
              activeOpacity={0.7}
              accessibilityRole="button"
            >
              <Text style={styles.retryText}>{t('contribution.cameraStuck')}</Text>
            </TouchableOpacity>
          )}
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
    marginBottom: 12,
    textAlign: 'center',
  },
  errorDetail: {
    fontSize: 12,
    fontFamily: 'monospace',
    color: tokens.neutral.n400,
    marginBottom: 24,
    textAlign: 'center',
    paddingHorizontal: 8,
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
    flexDirection: 'row',
    alignItems: 'center',
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
  // Story 3.20 — spinner alongside the indicator while GPS is acquiring.
  gpsIndicatorSpinner: {
    marginRight: 6,
    transform: [{ scale: 0.8 }], // visual size ~13px
  },
  // Story 3.20 — amber warning glyph when override is active.
  gpsIndicatorWarning: {
    color: 'rgb(245, 158, 11)',
    fontSize: 13,
    fontWeight: '600',
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
  // Story 3.20 — visual states for the GPS gate.
  captureButtonDisabled: {
    opacity: 0.4,
  },
  captureButtonOverride: {
    borderColor: 'rgba(245, 158, 11, 0.85)', // amber to telegraph "no GPS"
  },

  // Zoom selector
  zoomRow: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  zoomButton: {
    minWidth: 40,
    height: 32,
    borderRadius: 16,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  zoomButtonActive: {
    backgroundColor: tokens.neutral.n0,
  },
  zoomLabel: {
    color: tokens.neutral.n0,
    fontSize: 13,
    fontWeight: '600',
  },
  zoomLabelActive: {
    color: tokens.brand.ink,
  },

  // Camera-loading placeholder (permission still resolving)
  cameraLoading: {
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Watchdog retry overlay (preview never went live)
  retryOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  retryText: {
    color: tokens.neutral.n0,
    fontSize: 16,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 22,
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

});
