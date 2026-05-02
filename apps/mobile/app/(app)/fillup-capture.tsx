import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import { Paths } from 'expo-file-system';
import { Redirect, router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { tokens } from '../../src/theme';
import { useLocation } from '../../src/hooks/useLocation';
import { useAuth } from '../../src/store/auth.store';
import { LocationRequiredScreen } from '../../src/components/contribution/LocationRequiredScreen';
import { apiRunFillupOcr, apiCreateFillup } from '../../src/api/fillups';
import type { FillupFuelType, FillupOcrResult } from '../../src/api/fillups';
import { apiListVehicles } from '../../src/api/vehicles';
import type { Vehicle } from '../../src/api/vehicles';
import { flags } from '../../src/config/flags';
import { SavingsDisplay } from '../../src/components/SavingsDisplay';

const MIN_FREE_BYTES = 5 * 1024 * 1024; // 5 MB — same threshold as price-board capture
const OCR_CONFIDENCE_THRESHOLD = 0.6;

const FUEL_OPTIONS: FillupFuelType[] = ['PB_95', 'PB_98', 'ON', 'ON_PREMIUM', 'LPG'];

type Step =
  | 'camera'           // viewfinder + capture button
  | 'processing'       // OCR running, spinner + copy
  | 'confirm'          // OCR succeeded — show extracted values for confirmation
  | 'manual'           // OCR failed / low confidence / user retook + chose manual
  | 'odometer'         // optional odometer reading nudge
  | 'saving'           // POST /fillups in flight
  | 'celebration'      // success — fill-up summary + community badge + nudge
  | 'location-required'
  | 'error';

interface Draft {
  photoUri?: string;
  gpsLat?: number;
  gpsLng?: number;
  totalCostPln?: number;
  litres?: number;
  pricePerLitrePln?: number;
  fuelType?: FillupFuelType;
  odometerKm?: number;
  /** Hydrated from the OCR response so we can render confidence on the
   *  confirmation screen — helps the user decide whether to trust it. */
  ocrConfidence?: number;
}

interface CelebrationData {
  litres: number;
  totalCostPln: number;
  fuelType: FillupFuelType;
  stationMatched: boolean;
  stationName: string | null;
  communityUpdated: boolean;
  /**
   * Story 5.3: pre-computed savings vs. area average. null = no comparable
   * area data (no station match AND no GPS reverse-geocode hit, OR no
   * benchmark for the resolved voivodeship × fuel_type). The
   * SavingsDisplay component renders nothing for null per AC2.
   */
  savingsPln: number | null;
}

// ── Phase 2 gate ──────────────────────────────────────────────────────────
//
// Outer entry point keeps Rules-of-Hooks clean — no hooks under a conditional
// return. flags.phase2 is build-time constant (eas.json controls it via
// EXPO_PUBLIC_PHASE_2). When off (preview / production profiles): redirect
// back to the map. The vehicle hub on the Log tab is also gated, so users
// landing on this route via deep-link in a Phase 1 build go nowhere useful.
export default function FillupCaptureScreen() {
  if (!flags.phase2) return <Redirect href="/(app)" />;
  return <FillupCaptureContent />;
}

function FillupCaptureContent() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { accessToken } = useAuth();
  const { location, permissionDenied: locationDenied } = useLocation();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);

  const [step, setStep] = useState<Step>(locationDenied ? 'location-required' : 'camera');
  const [draft, setDraft] = useState<Draft>({});
  const [isCapturing, setIsCapturing] = useState(false);
  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [celebration, setCelebration] = useState<CelebrationData | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraKey, setCameraKey] = useState(0);
  // Cancellation latch flipped by the unmount cleanup. The 10s OCR call can
  // resolve after the user has already backed out of the screen — without
  // this, applyOcrResult would call setDraft / setStep on an unmounted
  // component (React warning + leaked photo file).
  const cancelledRef = useRef(false);
  // Synchronous double-tap guard for handleSave. Reading `step === 'saving'`
  // doesn't catch back-to-back taps because React state updates are batched —
  // both taps see the closure's stale step value before the next render.
  // A ref flips synchronously, so the second tap bails immediately.
  const submittingRef = useRef(false);

  // Force a fresh camera mount on focus — same pattern as capture.tsx, mitigates
  // the black-preview Android session loss after backgrounding.
  //
  // Also resets the wizard state on focus. fillup-capture is registered as a
  // hidden Tabs.Screen, so react-navigation keeps it mounted across blur —
  // without an explicit reset, the next "Log fill-up" entry would resume on
  // the previous celebration step (or worse, a half-filled manual form from
  // a prior aborted attempt). Mirrors the same fix applied to vehicle-setup.
  useFocusEffect(
    useCallback(() => {
      cancelledRef.current = false;
      submittingRef.current = false;
      setCameraReady(false);
      setCameraKey((k) => k + 1);
      // State reset to a clean wizard start. Note we DON'T reset `vehicles` —
      // re-fetching on every focus would burn a network round-trip for a list
      // that almost never changes mid-session.
      setStep(locationDenied ? 'location-required' : 'camera');
      setDraft({});
      setCelebration(null);
      setErrorMessage(null);
      setIsCapturing(false);
      return () => {
        // Latch is flipped on blur so any in-flight OCR / save callback that
        // fires after the user has navigated away no-ops instead of writing
        // to unmounted state.
        cancelledRef.current = true;
      };
    }, [locationDenied]),
  );

  // First-launch camera permission. Pattern lifted from capture.tsx — Android
  // doesn't reliably auto-prompt, so we request manually when status is
  // 'undetermined' and `canAskAgain` is true.
  useEffect(() => {
    if (permission?.status === 'undetermined' && permission.canAskAgain) {
      void requestPermission();
    }
  }, [permission?.status, permission?.canAskAgain, requestPermission]);

  // Load the user's vehicles on mount. We need at least one vehicle to log a
  // fill-up against. The "Log fill-up" entry on the map already has a similar
  // guard, but a stale deep-link could land us here without vehicles —
  // surface a friendly message rather than crashing on save.
  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await apiListVehicles(accessToken);
        if (cancelled) return;
        setVehicles(list);
        if (list.length === 1) setSelectedVehicleId(list[0]!.id);
        else if (list.length > 1) setSelectedVehicleId(list[0]!.id);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('apiListVehicles failed', e);
        if (!cancelled) setVehicles([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  // Watch for permission changes — useLocation flips the flag asynchronously,
  // so a user denying GPS while on this screen needs to land on the gate.
  useEffect(() => {
    if (locationDenied && step === 'camera') {
      setStep('location-required');
    }
  }, [locationDenied, step]);

  // ── Capture ───────────────────────────────────────────────────────────────

  const handleCapture = useCallback(async () => {
    if (!cameraRef.current || isCapturing || !accessToken) return;
    setIsCapturing(true);
    try {
      const freeSpace = Paths.availableDiskSpace;
      if (freeSpace < MIN_FREE_BYTES) {
        Alert.alert(t('contribution.storageFull'));
        setIsCapturing(false);
        return;
      }

      const photo = await cameraRef.current.takePictureAsync({ quality: 1 });
      if (!photo) {
        setIsCapturing(false);
        return;
      }

      // Compress to 1920px / 75% JPEG — same as price-board capture so the
      // server-side image budget is consistent across the two OCR pipelines.
      const compressed = await ImageManipulator.manipulateAsync(
        photo.uri,
        [{ resize: { width: 1920 } }],
        { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG },
      );

      const photoUri = compressed.uri;
      const gpsLat = location?.lat;
      const gpsLng = location?.lng;
      if (cancelledRef.current) return;
      setDraft({ photoUri, gpsLat, gpsLng });
      setStep('processing');

      // Fire OCR. Server has a 10s timeout + always-200 contract — even on
      // failure we get { confidence: 0 } and route to manual entry. No
      // need to handle timeouts client-side beyond the network catch.
      try {
        const ocr = await apiRunFillupOcr(accessToken, photoUri);
        if (cancelledRef.current) return;
        applyOcrResult(ocr, { photoUri, gpsLat, gpsLng });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('apiRunFillupOcr failed', e);
        if (cancelledRef.current) return;
        // Network error / 4xx — go straight to manual entry per AC10.
        setDraft((prev) => ({ ...prev, photoUri, gpsLat, gpsLng }));
        setStep('manual');
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('handleCapture failed', e);
      setStep('error');
    } finally {
      setIsCapturing(false);
    }
  }, [isCapturing, accessToken, location?.lat, location?.lng, t]);

  function applyOcrResult(ocr: FillupOcrResult, ctx: { photoUri: string; gpsLat?: number; gpsLng?: number }) {
    const allRequiredPresent =
      ocr.totalCostPln !== null &&
      ocr.litres !== null &&
      ocr.pricePerLitrePln !== null;
    const goodConfidence = ocr.confidence >= OCR_CONFIDENCE_THRESHOLD;

    setDraft({
      photoUri: ctx.photoUri,
      gpsLat: ctx.gpsLat,
      gpsLng: ctx.gpsLng,
      totalCostPln: ocr.totalCostPln ?? undefined,
      litres: ocr.litres ?? undefined,
      pricePerLitrePln: ocr.pricePerLitrePln ?? undefined,
      fuelType: ocr.fuelTypeSuggestion ?? 'PB_95',
      ocrConfidence: ocr.confidence,
    });

    if (allRequiredPresent && goodConfidence) {
      setStep('confirm');
    } else {
      // Low confidence / missing values → manual entry. Pre-fill any partial
      // results so the user only re-types what's missing.
      setStep('manual');
    }
  }

  // ── Save ─────────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!accessToken) return;
    // Double-tap guard: a second tap that lands before setStep('saving')
    // paints would otherwise fire two POSTs → two FillUps + two community
    // PriceHistory writes for the same physical fill-up. Use a ref so the
    // guard works under React's batched state update model — checking
    // `step === 'saving'` doesn't catch synchronous double-taps because
    // both taps share the same closure with stale step.
    if (submittingRef.current) return;
    submittingRef.current = true;
    if (!selectedVehicleId) {
      setErrorMessage(t('fillup.errorSaving'));
      submittingRef.current = false;
      return;
    }
    if (
      draft.totalCostPln === undefined ||
      draft.litres === undefined ||
      draft.pricePerLitrePln === undefined ||
      !draft.fuelType
    ) {
      setErrorMessage(t('fillup.errorSaving'));
      submittingRef.current = false;
      return;
    }

    setStep('saving');
    setErrorMessage(null);
    try {
      const response = await apiCreateFillup(accessToken, {
        vehicleId: selectedVehicleId,
        fuelType: draft.fuelType,
        litres: draft.litres,
        totalCostPln: draft.totalCostPln,
        pricePerLitrePln: draft.pricePerLitrePln,
        gpsLat: draft.gpsLat,
        gpsLng: draft.gpsLng,
        odometerKm: draft.odometerKm,
      });
      if (cancelledRef.current) return;
      setCelebration({
        litres: draft.litres,
        totalCostPln: draft.totalCostPln,
        fuelType: draft.fuelType,
        stationMatched: response.stationMatched,
        stationName: response.stationName,
        communityUpdated: response.communityUpdated,
        savingsPln: response.savingsPln ?? null,
      });
      setStep('celebration');
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('apiCreateFillup failed', e);
      if (cancelledRef.current) return;
      setErrorMessage(t('fillup.errorSaving'));
      // Bounce back to manual entry so the user can retry without losing
      // the values they just confirmed.
      setStep('manual');
    } finally {
      // Always release the guard — without this, a save failure leaves the
      // ref true and the user can never retry.
      submittingRef.current = false;
    }
  }, [accessToken, selectedVehicleId, draft, t]);

  // ── Render: location required ─────────────────────────────────────────────

  if (step === 'location-required') {
    return <LocationRequiredScreen onBack={() => router.back()} />;
  }

  // ── Render: camera permission denied / camera error ──────────────────────

  if (step === 'error' || permission?.status === 'denied') {
    return (
      <View style={[styles.fullscreen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <Text style={styles.errorTitle}>{t('contribution.cameraUnavailable')}</Text>
        <TouchableOpacity
          style={styles.errorBack}
          onPress={() => router.back()}
          accessibilityRole="button"
        >
          <Text style={styles.errorBackText}>{t('contribution.goBack')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Render: no vehicles guard (deep-link safety net) ─────────────────────

  if (vehicles !== null && vehicles.length === 0) {
    return (
      <View style={[styles.fullscreen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <Text style={styles.errorTitle}>{t('fillup.noVehicleTitle')}</Text>
        <TouchableOpacity
          style={styles.errorBack}
          onPress={() => router.replace('/(app)/vehicle-setup')}
          accessibilityRole="button"
        >
          <Text style={styles.errorBackText}>{t('fillup.noVehicleAction')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Render: camera ───────────────────────────────────────────────────────

  if (step === 'camera') {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" />
        {permission?.granted ? (
          <CameraView
            key={cameraKey}
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing="back"
            onCameraReady={() => setCameraReady(true)}
            onMountError={() => setStep('error')}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.cameraLoading]}>
            <ActivityIndicator size="large" color={tokens.neutral.n0} />
          </View>
        )}

        <TouchableOpacity
          style={[styles.cancelButton, { top: insets.top + 12 }]}
          onPress={() => router.back()}
          accessibilityRole="button"
        >
          <Text style={styles.cancelText}>{t('contribution.cancel')}</Text>
        </TouchableOpacity>

        {/* Pump-display framing rectangle — narrower / shorter than the
            price-board overlay because pump LCDs are smaller and closer. */}
        <View style={styles.framingGuide} pointerEvents="none">
          <View style={[styles.corner, styles.cornerTL]} />
          <View style={[styles.corner, styles.cornerTR]} />
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={[styles.corner, styles.cornerBR]} />
        </View>

        <Text style={[styles.frameHint, { bottom: insets.bottom + 168 }]}>
          {t('fillup.cameraOverlay')}
        </Text>

        <TouchableOpacity
          style={[styles.captureButton, { bottom: insets.bottom + 32 }]}
          onPress={() => void handleCapture()}
          disabled={isCapturing || !cameraReady}
          accessibilityLabel={t('contribution.takePhoto')}
          accessibilityRole="button"
        />
      </View>
    );
  }

  // ── Render: processing ───────────────────────────────────────────────────

  if (step === 'processing') {
    return (
      <View style={styles.fullscreen}>
        <ActivityIndicator size="large" color={tokens.brand.accent} />
        <Text style={styles.processingText}>{t('fillup.processing')}</Text>
      </View>
    );
  }

  // ── Render: confirm / manual entry (shared form) ─────────────────────────

  if (step === 'confirm' || step === 'manual') {
    return (
      <SafeAreaForm
        title={t('fillup.confirmTitle')}
        onBack={() => router.back()}
      >
        {step === 'manual' && (
          <Text style={styles.retakeHint}>{t('fillup.retakePrompt')}</Text>
        )}

        <FieldLabel>{t('fillup.totalCost')}</FieldLabel>
        <NumericField
          value={draft.totalCostPln}
          onChange={(v) => setDraft({ ...draft, totalCostPln: v })}
          placeholder="314.50"
        />

        <FieldLabel>{t('fillup.volume')}</FieldLabel>
        <NumericField
          value={draft.litres}
          onChange={(v) => setDraft({ ...draft, litres: v })}
          placeholder="47.30"
        />

        <FieldLabel>{t('fillup.pricePerLitre')}</FieldLabel>
        <NumericField
          value={draft.pricePerLitrePln}
          onChange={(v) => setDraft({ ...draft, pricePerLitrePln: v })}
          placeholder="6.65"
        />

        <FieldLabel>{t('fillup.fuelType')}</FieldLabel>
        <View style={styles.fuelTypeRow}>
          {FUEL_OPTIONS.map((ft) => (
            <TouchableOpacity
              key={ft}
              style={[
                styles.fuelChip,
                draft.fuelType === ft && styles.fuelChipActive,
              ]}
              onPress={() => setDraft({ ...draft, fuelType: ft })}
              accessibilityRole="button"
              accessibilityState={{ selected: draft.fuelType === ft }}
            >
              <Text
                style={[
                  styles.fuelChipText,
                  draft.fuelType === ft && styles.fuelChipTextActive,
                ]}
              >
                {t(`vehicles.fuelTypes.${ft}`)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Vehicle selector — single-vehicle case is auto-selected and
            hidden; multi-vehicle case shows a chip row mirroring the fuel
            picker. Vehicle list itself is loaded on mount. */}
        {vehicles && vehicles.length > 1 && (
          <>
            <FieldLabel>{t('vehicles.edit.title')}</FieldLabel>
            <View style={styles.fuelTypeRow}>
              {vehicles.map((v) => (
                <TouchableOpacity
                  key={v.id}
                  style={[
                    styles.fuelChip,
                    selectedVehicleId === v.id && styles.fuelChipActive,
                  ]}
                  onPress={() => setSelectedVehicleId(v.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: selectedVehicleId === v.id }}
                >
                  <Text
                    style={[
                      styles.fuelChipText,
                      selectedVehicleId === v.id && styles.fuelChipTextActive,
                    ]}
                  >
                    {v.nickname?.trim() || `${v.year} ${v.make} ${v.model}`}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}

        <TouchableOpacity
          style={[
            styles.primaryButton,
            !readyToContinue(draft, selectedVehicleId) && styles.primaryButtonDisabled,
          ]}
          onPress={() => setStep('odometer')}
          disabled={!readyToContinue(draft, selectedVehicleId)}
          accessibilityRole="button"
        >
          <Text style={styles.primaryButtonText}>{t('fillup.saveButton')}</Text>
        </TouchableOpacity>

        {step === 'confirm' && (
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => setStep('manual')}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryButtonText}>{t('fillup.enterManually')}</Text>
          </TouchableOpacity>
        )}

        {/* AC9: when OCR fails the user lands on 'manual' with retake-hint
            copy at the top of the form. Retake should be the primary path
            back ("Enter manually" is the fallback per spec) — without this
            button the only way out is the X close which exits the entire
            flow and discards the photo. Retake clears OCR-derived fields
            so the next attempt starts clean. */}
        {step === 'manual' && (
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => {
              setDraft({
                photoUri: undefined,
                gpsLat: draft.gpsLat,
                gpsLng: draft.gpsLng,
                // Clear OCR-derived values + fuelType so the retake start
                // from a clean slate. Preserve gps so the camera step
                // doesn't re-roll a coord-denied gate flicker.
              });
              setErrorMessage(null);
              setStep('camera');
            }}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryButtonText}>{t('fillup.retakeButton')}</Text>
          </TouchableOpacity>
        )}
      </SafeAreaForm>
    );
  }

  // ── Render: odometer nudge ───────────────────────────────────────────────

  if (step === 'odometer') {
    return (
      <SafeAreaForm
        title={t('fillup.odometerNudgeTitle')}
        onBack={() => setStep(draft.ocrConfidence !== undefined ? 'confirm' : 'manual')}
      >
        <Text style={styles.odoSubtitle}>{t('fillup.odometerNudgeSubtitle')}</Text>

        <FieldLabel>{t('fillup.odometerLabel')}</FieldLabel>
        {/*
          Story 5.4 plan: a "Take photo" option will appear here for OCR-based
          odometer reading. Until then, plain numeric input.
        */}
        <NumericField
          value={draft.odometerKm}
          onChange={(v) =>
            setDraft({
              ...draft,
              odometerKm: v !== undefined && Number.isInteger(v) ? v : v !== undefined ? Math.round(v) : undefined,
            })
          }
          placeholder={t('fillup.odometerPlaceholder')}
          integer
        />

        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => void handleSave()}
          accessibilityRole="button"
        >
          <Text style={styles.primaryButtonText}>{t('fillup.addOdometer')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.skipButton}
          onPress={() => {
            // No explicit guard needed — handleSave's `submittingRef` catches
            // the second tap synchronously regardless of which CTA fired it.
            setDraft({ ...draft, odometerKm: undefined });
            void handleSave();
          }}
          accessibilityRole="button"
        >
          <Text style={styles.skipText}>{t('fillup.skipOdometer')}</Text>
        </TouchableOpacity>
      </SafeAreaForm>
    );
  }

  // ── Render: saving ───────────────────────────────────────────────────────

  if (step === 'saving') {
    return (
      <View style={styles.fullscreen}>
        <ActivityIndicator size="large" color={tokens.brand.accent} />
      </View>
    );
  }

  // ── Render: celebration ──────────────────────────────────────────────────

  if (step === 'celebration' && celebration) {
    return (
      <SafeAreaForm
        title={t('confirmation.thankYou')}
        onBack={() => router.replace('/(app)/log')}
      >
        <View style={styles.celebrationCard}>
          <Text style={styles.celebrationFigure}>
            {t('fillup.celebrationFillup', {
              litres: celebration.litres.toFixed(2),
              cost: celebration.totalCostPln.toFixed(2),
            })}
          </Text>
          {/* Story 5.3: savings vs area average. Renders nothing when
              savingsPln is null (no benchmark available) per AC2 — no
              placeholder, no zero, no error message. */}
          <SavingsDisplay savingsPln={celebration.savingsPln} />
          {celebration.communityUpdated && celebration.stationName && (
            <Text style={styles.celebrationCommunity}>
              {t('fillup.celebrationCommunity', {
                fuelType: t(`vehicles.fuelTypes.${celebration.fuelType}`),
                station: celebration.stationName,
              })}
            </Text>
          )}
        </View>

        {celebration.stationMatched && (
          <>
            <Text style={styles.nudgeText}>{t('fillup.nudgeOtherPrices')}</Text>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => router.replace('/(app)/capture')}
              accessibilityRole="button"
            >
              <Text style={styles.primaryButtonText}>{t('fillup.addPrice')}</Text>
            </TouchableOpacity>
          </>
        )}

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => router.replace('/(app)/log')}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryButtonText}>{t('fillup.done')}</Text>
        </TouchableOpacity>
      </SafeAreaForm>
    );
  }

  // Fallback (shouldn't reach here)
  return (
    <View style={styles.fullscreen}>
      <ActivityIndicator size="large" color={tokens.brand.accent} />
    </View>
  );
}

// ── Helpers / sub-components ───────────────────────────────────────────────

function readyToContinue(draft: Draft, selectedVehicleId: string | null): boolean {
  return (
    !!selectedVehicleId &&
    draft.totalCostPln !== undefined && draft.totalCostPln > 0 &&
    draft.litres !== undefined && draft.litres > 0 &&
    draft.pricePerLitrePln !== undefined && draft.pricePerLitrePln > 0 &&
    !!draft.fuelType
  );
}

interface SafeAreaFormProps {
  title: string;
  onBack: () => void;
  children: React.ReactNode;
}

function SafeAreaForm({ title, onBack, children }: SafeAreaFormProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.formContainer, { paddingTop: insets.top }]}>
      <View style={styles.formHeader}>
        <TouchableOpacity onPress={onBack} accessibilityRole="button" accessibilityLabel="Close">
          <Text style={styles.formClose}>✕</Text>
        </TouchableOpacity>
        <Text style={styles.formTitle}>{title}</Text>
        <View style={styles.formCloseSpacer} />
      </View>
      <KeyboardAvoidingView
        style={styles.flex1}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[styles.formContent, { paddingBottom: insets.bottom + 32 }]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <Text style={styles.fieldLabel}>{children}</Text>;
}

interface NumericFieldProps {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  placeholder?: string;
  integer?: boolean;
}

function NumericField({ value, onChange, placeholder, integer }: NumericFieldProps) {
  // Local string state so the field tolerates partial inputs ("12.", "0.")
  // without immediately resetting them when a parse fails.
  const [text, setText] = useState(value !== undefined ? String(value) : '');

  // Hydrate when an outside source (OCR pre-fill) updates the value.
  useEffect(() => {
    setText(value !== undefined ? String(value) : '');
  }, [value]);

  return (
    <TextInput
      value={text}
      onChangeText={(raw) => {
        // Allow digits + a single decimal separator (. or ,) — normalise to
        // dot before parseFloat. Polish keyboards default to comma, US to dot.
        const cleaned = integer
          ? raw.replace(/[^0-9]/g, '')
          : raw.replace(/[^0-9.,]/g, '').replace(',', '.');
        setText(cleaned);
        if (cleaned === '' || cleaned === '.') {
          onChange(undefined);
          return;
        }
        const parsed = integer ? parseInt(cleaned, 10) : parseFloat(cleaned);
        onChange(Number.isFinite(parsed) ? parsed : undefined);
      }}
      style={styles.input}
      placeholder={placeholder}
      placeholderTextColor={tokens.neutral.n400}
      keyboardType={integer ? 'number-pad' : 'decimal-pad'}
    />
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const CM = 28; // pump-display framing corner mark size (smaller than price-board capture)
const CT = 3;

const styles = StyleSheet.create({
  flex1: { flex: 1 },
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
  cameraLoading: {
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
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
  cancelButton: {
    position: 'absolute',
    left: 16,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: tokens.radius.full,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  cancelText: {
    color: tokens.neutral.n0,
    fontSize: 14,
    fontWeight: '600',
  },
  framingGuide: {
    position: 'absolute',
    top: '32%',
    left: '12%',
    right: '12%',
    bottom: '38%',
  },
  corner: {
    position: 'absolute',
    width: CM,
    height: CM,
    borderColor: tokens.brand.accent,
  },
  cornerTL: { top: 0, left: 0, borderTopWidth: CT, borderLeftWidth: CT },
  cornerTR: { top: 0, right: 0, borderTopWidth: CT, borderRightWidth: CT },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: CT, borderLeftWidth: CT },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: CT, borderRightWidth: CT },
  frameHint: {
    position: 'absolute',
    alignSelf: 'center',
    color: tokens.neutral.n0,
    fontSize: 14,
    fontWeight: '500',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: tokens.radius.full,
  },
  captureButton: {
    position: 'absolute',
    alignSelf: 'center',
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: tokens.neutral.n0,
    backgroundColor: tokens.brand.accent,
  },
  processingText: {
    fontSize: 16,
    color: tokens.neutral.n500,
    marginTop: 16,
    textAlign: 'center',
  },

  // Form
  formContainer: {
    flex: 1,
    backgroundColor: tokens.surface.page,
  },
  formHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.neutral.n200,
    backgroundColor: tokens.surface.card,
  },
  formClose: {
    fontSize: 20,
    color: tokens.neutral.n500,
    paddingHorizontal: 8,
  },
  formCloseSpacer: { width: 32 },
  formTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: tokens.brand.ink,
    flex: 1,
    textAlign: 'center',
  },
  formContent: {
    padding: 24,
  },
  retakeHint: {
    fontSize: 14,
    color: tokens.price.expensive,
    marginBottom: 16,
    lineHeight: 20,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: tokens.neutral.n500,
    marginTop: 4,
    marginBottom: 6,
  },
  input: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.neutral.n200,
    backgroundColor: tokens.surface.card,
    fontSize: 16,
    color: tokens.brand.ink,
    marginBottom: 16,
  },
  fuelTypeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  fuelChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: tokens.radius.full,
    borderWidth: 1,
    borderColor: tokens.neutral.n200,
    backgroundColor: tokens.surface.card,
  },
  fuelChipActive: {
    borderColor: tokens.brand.accent,
    backgroundColor: '#fffbeb',
  },
  fuelChipText: {
    fontSize: 13,
    color: tokens.neutral.n500,
    fontWeight: '500',
  },
  fuelChipTextActive: {
    color: tokens.brand.accent,
    fontWeight: '700',
  },
  errorText: {
    fontSize: 14,
    color: tokens.price.expensive,
    marginBottom: 12,
  },
  primaryButton: {
    paddingVertical: 16,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.brand.accent,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryButtonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: tokens.neutral.n0,
  },
  secondaryButton: {
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  secondaryButtonText: {
    fontSize: 14,
    color: tokens.neutral.n500,
    fontWeight: '500',
  },
  skipButton: {
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  skipText: {
    fontSize: 14,
    color: tokens.neutral.n400,
    fontWeight: '500',
  },
  odoSubtitle: {
    fontSize: 14,
    color: tokens.neutral.n500,
    marginBottom: 24,
    lineHeight: 20,
  },
  celebrationCard: {
    padding: 24,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.surface.card,
    borderWidth: 1,
    borderColor: tokens.neutral.n200,
    marginBottom: 24,
    alignItems: 'center',
  },
  celebrationFigure: {
    fontSize: 24,
    fontWeight: '700',
    color: tokens.brand.ink,
    marginBottom: 8,
  },
  celebrationCommunity: {
    fontSize: 14,
    color: tokens.fresh.recent,
    fontWeight: '500',
  },
  nudgeText: {
    fontSize: 14,
    color: tokens.neutral.n500,
    marginBottom: 12,
    textAlign: 'center',
    lineHeight: 20,
  },
});
