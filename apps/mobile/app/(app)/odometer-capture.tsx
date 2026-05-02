import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { Redirect, router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { tokens } from '../../src/theme';
import { useAuth } from '../../src/store/auth.store';
import { apiListVehicles, type Vehicle } from '../../src/api/vehicles';
import {
  apiRunOdometerOcr,
  apiCreateOdometer,
  OdometerApiError,
  type ConsumptionResult,
} from '../../src/api/odometer';
import { flags } from '../../src/config/flags';

const OCR_CONFIDENCE_THRESHOLD = 0.6;

type Step =
  | 'select-vehicle'
  | 'choose'         // OCR or manual entry chooser
  | 'camera'
  | 'ocr'            // OCR processing spinner
  | 'confirm'        // post-OCR confirm screen
  | 'manual'         // pure manual entry path
  | 'saving'
  | 'result'         // success — show baseline / consumption / error
  | 'error';

interface ResultData {
  km: number;
  consumption: ConsumptionResult | null;
  /** Friendly text from a 422 NEGATIVE_DELTA — null for success. */
  errorText: string | null;
}

// Phase 2 gate. Mirrors fillup-capture: outer entry point so the inner
// component (with hooks) is never mounted in production builds.
export default function OdometerCaptureScreen() {
  if (!flags.phase2) return <Redirect href="/(app)" />;
  return <OdometerCaptureContent />;
}

function OdometerCaptureContent() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { accessToken } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);

  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('choose');
  const [km, setKm] = useState<number | undefined>(undefined);
  const [isCapturing, setIsCapturing] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraKey, setCameraKey] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ResultData | null>(null);

  const cancelledRef = useRef(false);
  const submittingRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      cancelledRef.current = false;
      submittingRef.current = false;
      setCameraReady(false);
      setCameraKey((k) => k + 1);
      setKm(undefined);
      setErrorMessage(null);
      setResult(null);
      // Step decision waits on vehicle list — see vehicles effect below.
      return () => {
        cancelledRef.current = true;
      };
    }, []),
  );

  useEffect(() => {
    if (permission?.status === 'undetermined' && permission.canAskAgain) {
      void requestPermission();
    }
  }, [permission?.status, permission?.canAskAgain, requestPermission]);

  // Load vehicles on mount. Single vehicle → auto-select + skip the picker
  // step. Multiple → show picker first. Empty → show "no vehicle" hint.
  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await apiListVehicles(accessToken);
        if (cancelled) return;
        setVehicles(list);
        if (list.length === 1) {
          setSelectedVehicleId(list[0]!.id);
          setStep('choose');
        } else if (list.length > 1) {
          setStep('select-vehicle');
        }
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

  // ── Capture ──────────────────────────────────────────────────────────────

  const handleCapture = useCallback(async () => {
    if (!cameraRef.current || isCapturing || !accessToken) return;
    setIsCapturing(true);
    setErrorMessage(null);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 1 });
      if (!photo) {
        setIsCapturing(false);
        return;
      }
      const compressed = await ImageManipulator.manipulateAsync(
        photo.uri,
        [{ resize: { width: 1920 } }],
        { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG },
      );
      if (cancelledRef.current) return;
      setStep('ocr');

      try {
        const ocr = await apiRunOdometerOcr(accessToken, compressed.uri);
        if (cancelledRef.current) return;
        const goodConfidence = ocr.km !== null && ocr.confidence >= OCR_CONFIDENCE_THRESHOLD;
        if (goodConfidence) {
          setKm(ocr.km ?? undefined);
          setStep('confirm');
        } else {
          // Pre-fill the manual field with whatever the OCR returned (even
          // sub-threshold) so the user only re-types if they need to.
          if (ocr.km !== null) setKm(ocr.km);
          setErrorMessage(t('odometer.ocrFailed'));
          setStep('manual');
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('apiRunOdometerOcr failed', e);
        if (cancelledRef.current) return;
        setErrorMessage(t('odometer.ocrFailed'));
        setStep('manual');
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('handleCapture failed', e);
      if (!cancelledRef.current) setStep('error');
    } finally {
      setIsCapturing(false);
    }
  }, [isCapturing, accessToken, t]);

  // ── Save ─────────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!accessToken || !selectedVehicleId) return;
    if (km === undefined || km <= 0) {
      setErrorMessage(t('odometer.errorSaving'));
      return;
    }
    if (submittingRef.current) return;
    submittingRef.current = true;
    setStep('saving');
    setErrorMessage(null);
    try {
      const response = await apiCreateOdometer(accessToken, {
        vehicleId: selectedVehicleId,
        km,
        // No fillupId — service auto-links to a fill-up within 30 minutes
        // for the same vehicle if one exists. Standalone capture flow.
      });
      if (cancelledRef.current) return;
      setResult({ km, consumption: response.consumption, errorText: null });
      setStep('result');
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('apiCreateOdometer failed', e);
      if (cancelledRef.current) return;
      // 422 NEGATIVE_DELTA is the targeted user-facing error — show the
      // boundary value so they know what to enter. Anything else gets the
      // generic save-failed message and bounces back to manual entry.
      if (e instanceof OdometerApiError && e.error === 'NEGATIVE_DELTA' && e.previousKm !== undefined) {
        setErrorMessage(t('odometer.negativeDelta', { previousKm: e.previousKm }));
        setStep('manual');
      } else {
        setErrorMessage(t('odometer.errorSaving'));
        setStep('manual');
      }
    } finally {
      submittingRef.current = false;
    }
  }, [accessToken, selectedVehicleId, km, t]);

  // ── Render: vehicles loading ─────────────────────────────────────────────

  if (vehicles === null) {
    return (
      <View style={styles.fullscreen}>
        <ActivityIndicator size="large" color={tokens.brand.accent} />
      </View>
    );
  }

  // ── Render: no vehicles ──────────────────────────────────────────────────

  if (vehicles.length === 0) {
    return (
      <View style={[styles.fullscreen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <Text style={styles.errorTitle}>{t('odometer.noVehicleTitle')}</Text>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => router.replace('/(app)/vehicle-setup')}
          accessibilityRole="button"
        >
          <Text style={styles.primaryButtonText}>{t('odometer.noVehicleAction')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Render: vehicle picker ───────────────────────────────────────────────

  if (step === 'select-vehicle') {
    return (
      <SafeAreaForm
        title={t('odometer.selectVehicleTitle')}
        onBack={() => router.back()}
      >
        <Text style={styles.subtitle}>{t('odometer.selectVehicleSubtitle')}</Text>
        {vehicles.map((v) => {
          const nickname = v.nickname?.trim();
          const identity = `${v.year} ${v.make} ${v.model}`;
          return (
            <TouchableOpacity
              key={v.id}
              style={[
                styles.vehicleCard,
                selectedVehicleId === v.id && styles.vehicleCardActive,
              ]}
              onPress={() => {
                setSelectedVehicleId(v.id);
                setStep('choose');
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: selectedVehicleId === v.id }}
            >
              <Text style={styles.vehicleNickname}>{nickname || identity}</Text>
              <Text style={styles.vehicleSubtitle}>
                {identity}{v.engine_variant ? ` · ${v.engine_variant}` : ''}
              </Text>
            </TouchableOpacity>
          );
        })}
      </SafeAreaForm>
    );
  }

  // ── Render: choose method (photo vs manual) ─────────────────────────────

  if (step === 'choose') {
    return (
      <SafeAreaForm title={t('odometer.title')} onBack={() => router.back()}>
        <Text style={styles.subtitle}>{t('odometer.chooseSubtitle')}</Text>

        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => {
            setCameraReady(false);
            setCameraKey((k) => k + 1);
            setErrorMessage(null);
            setStep('camera');
          }}
          accessibilityRole="button"
        >
          <Text style={styles.primaryButtonText}>{t('odometer.takePhoto')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => {
            setErrorMessage(null);
            setStep('manual');
          }}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryButtonText}>{t('odometer.enterManually')}</Text>
        </TouchableOpacity>
      </SafeAreaForm>
    );
  }

  // ── Render: camera ───────────────────────────────────────────────────────

  if (step === 'camera') {
    if (permission?.status === 'denied') {
      return (
        <View style={[styles.fullscreen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <Text style={styles.errorTitle}>{t('contribution.cameraPermissionDenied')}</Text>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => setStep('manual')}
            accessibilityRole="button"
          >
            <Text style={styles.primaryButtonText}>{t('odometer.enterManually')}</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View style={styles.cameraContainer}>
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
          onPress={() => setStep('choose')}
          accessibilityRole="button"
        >
          <Text style={styles.cancelText}>{t('contribution.cancel')}</Text>
        </TouchableOpacity>

        <View style={styles.framingGuide} pointerEvents="none">
          <View style={[styles.corner, styles.cornerTL]} />
          <View style={[styles.corner, styles.cornerTR]} />
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={[styles.corner, styles.cornerBR]} />
        </View>

        <Text style={[styles.frameHint, { bottom: insets.bottom + 168 }]}>
          {t('odometer.cameraOverlay')}
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

  // ── Render: OCR processing ───────────────────────────────────────────────

  if (step === 'ocr') {
    return (
      <View style={styles.fullscreen}>
        <ActivityIndicator size="large" color={tokens.brand.accent} />
        <Text style={styles.processingText}>{t('odometer.processing')}</Text>
      </View>
    );
  }

  // ── Render: confirm (post-OCR) or manual entry — shared form ─────────────

  if (step === 'confirm' || step === 'manual') {
    return (
      <SafeAreaForm
        title={step === 'confirm' ? t('odometer.confirmTitle') : t('odometer.manualTitle')}
        onBack={() => setStep('choose')}
      >
        {step === 'confirm' && (
          <Text style={styles.subtitle}>{t('odometer.confirmSubtitle')}</Text>
        )}

        <FieldLabel>{t('odometer.kmLabel')}</FieldLabel>
        <NumericField
          value={km}
          onChange={setKm}
          placeholder={t('odometer.kmPlaceholder')}
        />

        {errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}

        <TouchableOpacity
          style={[
            styles.primaryButton,
            (km === undefined || km <= 0) && styles.primaryButtonDisabled,
          ]}
          onPress={() => void handleSave()}
          disabled={km === undefined || km <= 0}
          accessibilityRole="button"
        >
          <Text style={styles.primaryButtonText}>{t('odometer.saveButton')}</Text>
        </TouchableOpacity>

        {step === 'confirm' && (
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => {
              setKm(undefined);
              setCameraReady(false);
              setCameraKey((k) => k + 1);
              setStep('camera');
            }}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryButtonText}>{t('odometer.retake')}</Text>
          </TouchableOpacity>
        )}
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

  // ── Render: result ───────────────────────────────────────────────────────

  if (step === 'result' && result) {
    return (
      <SafeAreaForm
        title={t('odometer.savedTitle')}
        onBack={() => router.replace('/(app)/log')}
      >
        <View style={styles.resultCard}>
          <Text style={styles.resultKm}>
            {t('odometer.savedKm', { km: result.km.toLocaleString() })}
          </Text>
          {result.consumption === null ? (
            <Text style={styles.resultBaseline}>{t('odometer.savedBaseline')}</Text>
          ) : result.consumption.consumptionL100km !== null ? (
            <Text style={styles.resultConsumption}>
              {t('odometer.savedConsumption', {
                value: result.consumption.consumptionL100km.toFixed(1),
              })}
            </Text>
          ) : (
            <Text style={styles.resultBaseline}>{t('odometer.savedNoFillups')}</Text>
          )}
        </View>

        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => router.replace('/(app)/log')}
          accessibilityRole="button"
        >
          <Text style={styles.primaryButtonText}>{t('odometer.done')}</Text>
        </TouchableOpacity>
      </SafeAreaForm>
    );
  }

  // ── Render: camera error fallback ────────────────────────────────────────

  return (
    <View style={[styles.fullscreen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <Text style={styles.errorTitle}>{t('contribution.cameraUnavailable')}</Text>
      <TouchableOpacity
        style={styles.primaryButton}
        onPress={() => setStep('manual')}
        accessibilityRole="button"
      >
        <Text style={styles.primaryButtonText}>{t('odometer.enterManually')}</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

interface SafeAreaFormProps {
  title: string;
  onBack: () => void;
  children: React.ReactNode;
}

function SafeAreaForm({ title, onBack, children }: SafeAreaFormProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.formContainer, { paddingTop: insets.top }]}>
      <View style={styles.formHeader}>
        <TouchableOpacity onPress={onBack} accessibilityRole="button" accessibilityLabel={t('common.close')}>
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
}

function NumericField({ value, onChange, placeholder }: NumericFieldProps) {
  const [text, setText] = useState(value !== undefined ? String(value) : '');
  useEffect(() => {
    setText(value !== undefined ? String(value) : '');
  }, [value]);
  return (
    <TextInput
      value={text}
      onChangeText={(raw) => {
        const cleaned = raw.replace(/[^0-9]/g, '');
        setText(cleaned);
        if (cleaned === '') {
          onChange(undefined);
          return;
        }
        const parsed = parseInt(cleaned, 10);
        onChange(Number.isFinite(parsed) ? parsed : undefined);
      }}
      style={styles.input}
      placeholder={placeholder}
      placeholderTextColor={tokens.neutral.n400}
      keyboardType="number-pad"
    />
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const CM = 28;
const CT = 3;

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  cameraContainer: { flex: 1, backgroundColor: '#000' },
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
  formContainer: { flex: 1, backgroundColor: tokens.surface.page },
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
  subtitle: {
    fontSize: 14,
    color: tokens.neutral.n500,
    marginBottom: 24,
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
  vehicleCard: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.neutral.n200,
    backgroundColor: tokens.surface.card,
    marginBottom: 12,
  },
  vehicleCardActive: {
    borderColor: tokens.brand.accent,
  },
  vehicleNickname: {
    fontSize: 16,
    fontWeight: '600',
    color: tokens.brand.ink,
    marginBottom: 2,
  },
  vehicleSubtitle: {
    fontSize: 13,
    color: tokens.neutral.n500,
  },
  resultCard: {
    padding: 24,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.surface.card,
    borderWidth: 1,
    borderColor: tokens.neutral.n200,
    marginBottom: 24,
    alignItems: 'center',
  },
  resultKm: {
    fontSize: 24,
    fontWeight: '700',
    color: tokens.brand.ink,
    marginBottom: 8,
  },
  resultConsumption: {
    fontSize: 16,
    color: tokens.brand.ink,
    fontWeight: '600',
  },
  resultBaseline: {
    fontSize: 13,
    color: tokens.neutral.n500,
    textAlign: 'center',
    lineHeight: 18,
  },
});
