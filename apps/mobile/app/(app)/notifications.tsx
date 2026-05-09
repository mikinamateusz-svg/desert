import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  Switch,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  TextInput,
  Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { tokens } from '../../src/theme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../src/store/auth.store';
import {
  apiGetNotificationPreferences,
  apiUpdateNotificationPreferences,
  type AlertFuelType,
  type AlertRadiusKm,
  type NotificationPreferences,
  type PriceDropMode,
  type UpdateNotificationPreferencesPayload,
} from '../../src/api/notifications';
import { apiGetSubmissions } from '../../src/api/submissions';
import { useNotificationPermission } from '../../src/hooks/useNotificationPermission';
import { FeatureGateSheet } from '../../src/components/FeatureGateSheet';
import { flags } from '../../src/config/flags';

const REPROMPT_KEY = 'desert:notifRepromptShown';

const FUEL_TYPE_ORDER: AlertFuelType[] = ['PB_95', 'PB_98', 'ON', 'ON_PREMIUM', 'LPG'];
const RADIUS_OPTIONS: AlertRadiusKm[] = [5, 10, 25];

// Story 6.4 — target price guard. Mirrors the API DTO so the UI doesn't
// send clearly-bogus values; backend re-validates as defence in depth.
const TARGET_MIN = 1.0;
const TARGET_MAX = 20.0;

// Story 6.4 — locale-aware decimal display. PL/UK keyboards use `,` and
// the parser already accepts both, but the *display* must mirror the
// user's locale so they don't see a `.` they didn't type. Server returns
// Decimal as `"6.50"` (always dot) regardless of locale.
function formatTargetForDisplay(value: string | number | null | undefined, locale: string): string {
  if (value == null) return '';
  const asString = typeof value === 'number' ? value.toFixed(2) : String(value);
  return locale.startsWith('pl') || locale.startsWith('uk')
    ? asString.replace('.', ',')
    : asString;
}

export default function AlertsScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { accessToken, isLoading: authLoading } = useAuth();
  const { status: permissionStatus, isChecking, requestPermission, getExpoPushToken } =
    useNotificationPermission();

  const [gateVisible, setGateVisible] = useState(false);
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [isLoadingPrefs, setIsLoadingPrefs] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showReprompt, setShowReprompt] = useState(false);

  // Story 6.4 — local state for the target-price text input. Decoupled
  // from `prefs.price_drop_target_pln` so the user can type partial /
  // invalid values without immediately overwriting the persisted state.
  // Validated on blur, then synced via handleUpdate.
  const [targetPriceInput, setTargetPriceInput] = useState<string>('');
  const [targetPriceError, setTargetPriceError] = useState(false);

  // Show gate as soon as auth is resolved and user is a guest.
  useEffect(() => {
    if (!authLoading && !accessToken) {
      setGateVisible(true);
    }
  }, [authLoading, accessToken]);

  // Navigate back when the gate is dismissed without a sign-in completing.
  // Using an effect (rather than an inline onDismiss callback) means we always
  // read the current accessToken value and avoid stale-closure bugs.
  const prevGateVisibleRef = useRef(false);
  useEffect(() => {
    if (prevGateVisibleRef.current && !gateVisible && !accessToken) {
      router.back();
    }
    prevGateVisibleRef.current = gateVisible;
  }, [gateVisible, accessToken, router]);

  // Load preferences when permission is granted and user is authenticated
  const loadPrefs = useCallback(async () => {
    if (!accessToken) return;
    setIsLoadingPrefs(true);
    setLoadError(null);
    try {
      const result = await apiGetNotificationPreferences(accessToken);
      setPrefs(result);
    } catch {
      setLoadError(t('notifications.errorLoading'));
    } finally {
      setIsLoadingPrefs(false);
    }
  }, [accessToken, t]);

  useEffect(() => {
    if (permissionStatus === 'granted' && accessToken) {
      void loadPrefs();
    }
  }, [permissionStatus, accessToken, loadPrefs]);

  // Hydrate the local target-price input whenever the persisted value
  // changes (initial load, optimistic revert, server clear). The handler
  // covers three runtime shapes for the field:
  //   - string  ("6.50") on read from Prisma Decimal
  //   - number  (6.5)    on optimistic-set after a successful blur
  //   - null              when the user clears it
  // The else-branch matters: when the user clears the input and saves,
  // the persisted value flips to null and we must reset the local input
  // to '' (otherwise stale text lingers).
  useEffect(() => {
    setTargetPriceInput(formatTargetForDisplay(prefs?.price_drop_target_pln, i18n.language));
  }, [prefs?.price_drop_target_pln, i18n.language]);

  // Check re-prompt condition when denied
  useEffect(() => {
    if (permissionStatus !== 'denied' || !accessToken) return;

    void (async () => {
      const alreadyShown = await AsyncStorage.getItem(REPROMPT_KEY);
      if (alreadyShown === 'true') return;

      try {
        const res = await apiGetSubmissions(accessToken, 1, 1);
        if (res.total > 0) {
          setShowReprompt(true);
        }
      } catch {
        // silently skip — re-prompt is non-critical
      }
    })();
  }, [permissionStatus, accessToken]);

  const handleEnableNotifications = useCallback(async () => {
    const result = await requestPermission();
    if (result === 'granted') {
      const token = await getExpoPushToken();
      // P4: only register token when one was actually obtained
      if (accessToken && token !== null) {
        try {
          await apiUpdateNotificationPreferences(accessToken, { expo_push_token: token });
        } catch {
          // best-effort token registration
        }
      }
    }
  }, [requestPermission, getExpoPushToken, accessToken]);

  // Story 6.4 — generic optimistic-update pattern shared by every Phase 2
  // control. Snapshot before the patch + revert on error so the UI never
  // shows stale "saved" state. Replaces the legacy single-key handleToggle.
  const handleUpdate = useCallback(
    async (patch: Partial<UpdateNotificationPreferencesPayload>) => {
      if (!accessToken || !prefs) return;
      const snapshot = prefs;
      // Cast: every key in Partial<UpdateNotificationPreferencesPayload>
      // exists on NotificationPreferences with a compatible runtime shape
      // (read-side has Decimal-as-string for target_pln vs write-side
      // number; the optimistic value matches whichever the user input had,
      // which is fine because the next refetch re-establishes the canonical
      // string form).
      setPrefs((prev) => (prev ? ({ ...prev, ...patch } as NotificationPreferences) : prev));
      setSaveError(null);
      try {
        await apiUpdateNotificationPreferences(accessToken, patch);
      } catch {
        setPrefs(snapshot);
        setSaveError(t('notifications.errorSaving'));
      }
    },
    [accessToken, prefs, t],
  );

  // Story 6.4 — target-price input is validated on blur, then either
  // persisted (valid) or surfaced as an inline error (invalid). Accepts
  // both `,` and `.` as decimal separator for PL/UK keyboards.
  const handleTargetPriceBlur = useCallback(async () => {
    const trimmed = targetPriceInput.trim();
    // Empty input clears the target — distinct from "user types invalid".
    if (trimmed === '') {
      setTargetPriceError(false);
      await handleUpdate({ price_drop_target_pln: null });
      return;
    }
    const num = parseFloat(trimmed.replace(',', '.'));
    if (Number.isNaN(num) || num < TARGET_MIN || num > TARGET_MAX) {
      setTargetPriceError(true);
      return;
    }
    setTargetPriceError(false);
    // Round to 2dp before persist — matches Decimal(5,2) at the column.
    // toFixed avoids the IEEE-754 trap that bites Math.round(num * 100) / 100
    // (e.g. 1.005 * 100 = 100.4999... rounds DOWN to 1.00 instead of 1.01).
    await handleUpdate({ price_drop_target_pln: Number(num.toFixed(2)) });
  }, [targetPriceInput, handleUpdate]);

  // Story 6.4 — switching mode back to cheaper_than_now also clears the
  // persisted target so it doesn't ghost back when the user flips again.
  // Mirrors the DTO comment: "Null clears it (used when user switches mode
  // back to cheaper_than_now)".
  const handleModeChange = useCallback(
    async (mode: PriceDropMode) => {
      if (mode === 'cheaper_than_now') {
        setTargetPriceError(false);
        await handleUpdate({ price_drop_mode: mode, price_drop_target_pln: null });
      } else {
        await handleUpdate({ price_drop_mode: mode });
      }
    },
    [handleUpdate],
  );

  const handleFuelTypeToggle = useCallback(
    async (type: AlertFuelType) => {
      if (!prefs) return;
      // ?? [] guards against stale-cache rows that predate the migration —
      // .includes() on undefined would crash the screen.
      const current = prefs.price_drop_fuel_types ?? [];
      const updated = current.includes(type)
        ? current.filter((f) => f !== type)
        : [...current, type];
      await handleUpdate({ price_drop_fuel_types: updated });
    },
    [prefs, handleUpdate],
  );

  const handleRepromptEnable = useCallback(async () => {
    await AsyncStorage.setItem(REPROMPT_KEY, 'true');
    setShowReprompt(false);
    await Linking.openSettings();
  }, []);

  const handleRepromptDismiss = useCallback(async () => {
    await AsyncStorage.setItem(REPROMPT_KEY, 'true');
    setShowReprompt(false);
  }, []);

  // P3 pattern: wait for auth restore before deciding what to show
  if (authLoading || isChecking) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={tokens.brand.accent} />
      </View>
    );
  }

  if (!accessToken) {
    return (
      <View style={styles.center}>
        <FeatureGateSheet
          visible={gateVisible}
          onDismiss={() => setGateVisible(false)}
          featureKey="alerts"
          returnTo="/(app)/notifications"
        />
      </View>
    );
  }

  // Undetermined: show value-prop screen
  if (permissionStatus === 'undetermined') {
    return (
      <View style={styles.center}>
        <Text style={styles.valuePropTitle}>{t('notifications.valuePropTitle')}</Text>
        <View style={styles.featureList}>
          <Text style={styles.featureItem}>• {t('notifications.feature1')}</Text>
          <Text style={styles.featureItem}>• {t('notifications.feature2')}</Text>
          <Text style={styles.featureItem}>• {t('notifications.feature3')}</Text>
        </View>
        <TouchableOpacity style={styles.enableButton} onPress={() => void handleEnableNotifications()}>
          <Text style={styles.enableButtonText}>{t('notifications.enableButton')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Denied: show instructions + optional re-prompt
  if (permissionStatus === 'denied') {
    return (
      <View style={styles.container}>
        {showReprompt && (
          <View style={styles.repromptBanner}>
            <Text style={styles.repromptTitle}>{t('notifications.repromptTitle')}</Text>
            <Text style={styles.repromptSubtitle}>{t('notifications.repromptSubtitle')}</Text>
            <View style={styles.repromptActions}>
              <TouchableOpacity
                style={styles.repromptEnableButton}
                onPress={() => void handleRepromptEnable()}
              >
                <Text style={styles.repromptEnableText}>{t('notifications.repromptEnable')}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => void handleRepromptDismiss()}>
                <Text style={styles.repromptDismissText}>{t('notifications.repromptDismiss')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        <View style={styles.center}>
          <Text style={styles.deniedTitle}>{t('notifications.permissionDeniedTitle')}</Text>
          <Text style={styles.deniedBody}>{t('notifications.permissionDeniedBody')}</Text>
          <TouchableOpacity
            style={styles.openSettingsButton}
            onPress={() => void Linking.openSettings()}
          >
            <Text style={styles.openSettingsText}>{t('notifications.openSettings')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Granted: show toggles
  if (isLoadingPrefs) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={tokens.brand.accent} />
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{loadError}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => void loadPrefs()}>
          <Text style={styles.retryText}>{t('notifications.retry')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Story 6.4 — granted-state rebuild. 3 sections, each in its own card,
  // optimistic updates everywhere.
  //
  // Story 6.12 — Phase 1 cut. Section 1 (Price Drop Alerts) ships in
  // production via 6.1's promotion. Section 2 (rich rise controls backed
  // by 6.2 / 6.3-full) and Section 3 (Monthly Summary backed by 6.5) are
  // flag-gated until those alerts ship. A minimal Phase 1 sharp_rise
  // toggle replaces Section 2 in non-phase2 builds so users can opt out
  // of 6.3-lite predictive rises without exposing dead Phase 2 toggles.
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      {saveError && (
        <View style={styles.saveErrorBanner}>
          <Text style={styles.saveErrorText}>{saveError}</Text>
        </View>
      )}

      {/* ── Section 1: Price Drop Alerts ──────────────────────────────── */}
      <SectionCard title={t('notifications.sections.priceDrop')}>
        <ToggleRow
          label={t('notifications.priceDropEnabled')}
          value={prefs?.price_drop_enabled ?? false}
          onChange={(v) => void handleUpdate({ price_drop_enabled: v })}
        />
        {prefs?.price_drop_enabled && (
          <>
            <Divider />
            <LabelRow label={t('notifications.mode')}>
              <PillGroup
                options={[
                  { value: 'cheaper_than_now' as PriceDropMode, label: t('notifications.modeCheaperThanNow') },
                  { value: 'target_price' as PriceDropMode, label: t('notifications.modeTargetPrice') },
                ]}
                // ?? default guards against stale-cache rows that predate the migration.
                selected={prefs.price_drop_mode ?? 'cheaper_than_now'}
                onSelect={(v) => void handleModeChange(v)}
              />
            </LabelRow>

            {prefs.price_drop_mode === 'target_price' && (
              <>
                <Divider />
                <LabelRow label={t('notifications.targetPricePln')}>
                  <TextInput
                    keyboardType="decimal-pad"
                    value={targetPriceInput}
                    onChangeText={(v) => {
                      setTargetPriceInput(v);
                      // Reset error as soon as user starts editing — they
                      // get fresh feedback on the next blur.
                      if (targetPriceError) setTargetPriceError(false);
                    }}
                    onBlur={() => void handleTargetPriceBlur()}
                    placeholder={t('notifications.targetPricePlaceholder')}
                    placeholderTextColor={tokens.neutral.n400}
                    style={[styles.priceInput, targetPriceError && styles.priceInputError]}
                  />
                </LabelRow>
                {targetPriceError && (
                  <Text style={styles.fieldError}>{t('notifications.invalidTargetPrice')}</Text>
                )}
              </>
            )}

            <Divider />
            <LabelRow label={t('notifications.fuelTypes')}>
              <FuelTypeChips
                selected={prefs.price_drop_fuel_types ?? []}
                onToggle={(type) => void handleFuelTypeToggle(type)}
                t={t}
              />
            </LabelRow>
            {(prefs.price_drop_fuel_types ?? []).length === 0 && (
              <Text style={styles.fieldHint}>{t('notifications.fuelTypesEmptyHint')}</Text>
            )}
          </>
        )}

        {/* Radius lives in Section 1 but is shared with Rise alerts (AC3),
            so it must be reachable when ANY alert family is enabled — not
            gated on price_drop_enabled. */}
        {(prefs?.price_drop_enabled || prefs?.rise_community_enabled || prefs?.rise_predictive_enabled) && (
          <>
            <Divider />
            <LabelRow label={t('notifications.alertRadiusShared')}>
              <PillGroup
                options={RADIUS_OPTIONS.map((km) => ({ value: km, label: `${km} km` }))}
                selected={(prefs?.alert_radius_km ?? 10) as AlertRadiusKm}
                onSelect={(v) => void handleUpdate({ alert_radius_km: v })}
              />
            </LabelRow>
          </>
        )}
      </SectionCard>

      {/* ── Section 2: Price Rise Alerts ──────────────────────────────── */}
      {/* Story 6.12 — Phase 2 only. The community + predictive toggles map
          to Stories 6.2 and 6.3-full, neither of which has shipped. In
          non-phase2 builds we render the minimal sharp_rise toggle below
          instead so users can still opt out of 6.3-lite. */}
      {flags.phase2 && (
        <SectionCard title={t('notifications.sections.priceRise')}>
          <ToggleRow
            label={t('notifications.riseCommunity')}
            subLabel={t('notifications.riseCommunityDesc')}
            value={prefs?.rise_community_enabled ?? false}
            onChange={(v) => void handleUpdate({ rise_community_enabled: v })}
          />
          <Divider />
          <ToggleRow
            label={t('notifications.risePredictive')}
            subLabel={t('notifications.risePredictiveDesc')}
            value={prefs?.rise_predictive_enabled ?? false}
            onChange={(v) => void handleUpdate({ rise_predictive_enabled: v })}
          />
          {(prefs?.rise_community_enabled || prefs?.rise_predictive_enabled) && (
            <Text style={styles.fieldHint}>
              {t('notifications.riseRadiusSharedNote', { km: prefs?.alert_radius_km ?? 10 })}
            </Text>
          )}
        </SectionCard>
      )}

      {/* ── Phase 1 sharp_rise toggle (replaces Section 2 in non-phase2) ── */}
      {/* Story 6.12 — single-toggle control over 6.3-lite (predictive rise
          via ORLEN rack signal). Bound to the legacy `sharp_rise` column
          which the existing alert.service.ts pipeline reads. Hidden when
          flags.phase2 is true since the rich Section 2 above takes over. */}
      {!flags.phase2 && (
        <SectionCard title={t('notifications.sections.priceRiseSimple')}>
          <ToggleRow
            label={t('notifications.sharpRiseLabel')}
            subLabel={t('notifications.sharpRiseSubLabel')}
            value={prefs?.sharp_rise ?? true}
            onChange={(v) => void handleUpdate({ sharp_rise: v })}
          />
        </SectionCard>
      )}

      {/* ── Section 3: Monthly Summary ────────────────────────────────── */}
      {/* Story 6.12 — toggle backs 6.5 which hasn't shipped; hide in
          non-phase2 builds rather than surface a dead control. */}
      {flags.phase2 && (
        <SectionCard title={t('notifications.sections.monthlySummary')}>
          <ToggleRow
            label={t('notifications.monthlySummary')}
            value={prefs?.monthly_summary ?? true}
            onChange={(v) => void handleUpdate({ monthly_summary: v })}
          />
        </SectionCard>
      )}
    </ScrollView>
  );
}

// ── Inline subcomponents ────────────────────────────────────────────────
//
// Per Story 6.4 spec: keep these LOCAL to this file. Resist the urge to
// extract — the panel is the only consumer and pattern-uniqueness here
// helps the next reader understand the screen end-to-end.

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function ToggleRow({
  label,
  subLabel,
  value,
  onChange,
}: {
  label: string;
  subLabel?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleLabelWrap}>
        <Text style={styles.toggleLabel}>{label}</Text>
        {subLabel && <Text style={styles.toggleSubLabel}>{subLabel}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: tokens.brand.accent }}
        thumbColor={tokens.neutral.n0}
      />
    </View>
  );
}

function LabelRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.labelRow}>
      <Text style={styles.labelRowLabel}>{label}</Text>
      <View style={styles.labelRowControl}>{children}</View>
    </View>
  );
}

function PillGroup<T extends string | number>({
  options,
  selected,
  onSelect,
}: {
  options: Array<{ value: T; label: string }>;
  selected: T;
  onSelect: (v: T) => void;
}) {
  return (
    <View style={styles.pillGroup}>
      {options.map((opt) => {
        const active = opt.value === selected;
        return (
          <TouchableOpacity
            key={String(opt.value)}
            style={[styles.pill, active && styles.pillActive]}
            onPress={() => onSelect(opt.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.pillText, active && styles.pillTextActive]}>{opt.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function FuelTypeChips({
  selected,
  onToggle,
  t,
}: {
  selected: AlertFuelType[];
  onToggle: (type: AlertFuelType) => void;
  t: (key: string) => string;
}) {
  // Display order is fixed (FUEL_TYPE_ORDER) so the visual layout doesn't
  // shuffle as the user toggles chips on/off.
  const labelMap: Record<AlertFuelType, string> = {
    PB_95: t('notifications.fuelPb95'),
    PB_98: t('notifications.fuelPb98'),
    ON: t('notifications.fuelOn'),
    ON_PREMIUM: t('notifications.fuelOnPremium'),
    LPG: t('notifications.fuelLpg'),
  };
  return (
    <View style={styles.chipRow}>
      {FUEL_TYPE_ORDER.map((type) => {
        const active = selected.includes(type);
        return (
          <TouchableOpacity
            key={type}
            style={[styles.chip, active && styles.chipActive]}
            onPress={() => onToggle(type)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{labelMap[type]}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: tokens.surface.page },
  scrollContent: { padding: 16, paddingBottom: 32 },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: tokens.surface.page,
  },
  valuePropTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: tokens.brand.ink,
    marginBottom: 20,
    textAlign: 'center',
  },
  featureList: { marginBottom: 32, alignSelf: 'flex-start' },
  featureItem: { fontSize: 15, color: tokens.neutral.n500, marginBottom: 10, lineHeight: 22 },
  enableButton: {
    backgroundColor: tokens.brand.accent,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 10,
  },
  enableButtonText: { color: tokens.neutral.n0, fontSize: 16, fontWeight: '600' },
  deniedTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: tokens.brand.ink,
    marginBottom: 8,
    textAlign: 'center',
  },
  deniedBody: { fontSize: 14, color: tokens.neutral.n500, textAlign: 'center', marginBottom: 20, lineHeight: 20 },
  openSettingsButton: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.brand.accent,
  },
  openSettingsText: { color: tokens.brand.accent, fontSize: 14, fontWeight: '500' },
  repromptBanner: {
    backgroundColor: '#fffbeb',
    borderBottomWidth: 1,
    borderBottomColor: '#fde68a',
    padding: 16,
  },
  repromptTitle: { fontSize: 15, fontWeight: '600', color: tokens.brand.ink, marginBottom: 4 },
  repromptSubtitle: { fontSize: 13, color: tokens.neutral.n500, marginBottom: 12 },
  repromptActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  repromptEnableButton: {
    backgroundColor: tokens.brand.accent,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  repromptEnableText: { color: tokens.neutral.n0, fontSize: 13, fontWeight: '600' },
  repromptDismissText: { color: tokens.neutral.n400, fontSize: 13 },

  // Story 6.4 — section panel styles
  sectionCard: {
    backgroundColor: tokens.surface.card,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.neutral.n200,
    marginBottom: 16,
    overflow: 'hidden',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: tokens.neutral.n500,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionBody: {},
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    minHeight: 56,
  },
  toggleLabelWrap: { flex: 1, marginRight: 12 },
  toggleLabel: { fontSize: 15, color: tokens.brand.ink },
  toggleSubLabel: { fontSize: 12, color: tokens.neutral.n500, marginTop: 4, lineHeight: 16 },
  labelRow: {
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  labelRowLabel: { fontSize: 13, color: tokens.neutral.n500, marginBottom: 8, fontWeight: '500' },
  labelRowControl: {},
  pillGroup: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, rowGap: 8 },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: tokens.radius.full,
    borderWidth: 1,
    borderColor: tokens.neutral.n200,
    backgroundColor: tokens.surface.card,
  },
  pillActive: {
    borderColor: tokens.brand.accent,
    backgroundColor: '#fffbeb',
  },
  pillText: { fontSize: 13, color: tokens.neutral.n500, fontWeight: '500' },
  pillTextActive: { color: tokens.brand.accent, fontWeight: '700' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: tokens.radius.full,
    borderWidth: 1,
    borderColor: tokens.neutral.n200,
    backgroundColor: tokens.surface.card,
  },
  chipActive: {
    borderColor: tokens.brand.accent,
    backgroundColor: '#fffbeb',
  },
  chipText: { fontSize: 13, color: tokens.neutral.n500, fontWeight: '500' },
  chipTextActive: { color: tokens.brand.accent, fontWeight: '700' },
  priceInput: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.neutral.n200,
    backgroundColor: tokens.surface.card,
    fontSize: 16,
    color: tokens.brand.ink,
    minWidth: 120,
  },
  priceInputError: {
    borderColor: tokens.price.expensive,
  },
  fieldError: {
    fontSize: 12,
    color: tokens.price.expensive,
    paddingHorizontal: 20,
    paddingTop: 4,
  },
  fieldHint: {
    fontSize: 12,
    color: tokens.neutral.n500,
    paddingHorizontal: 20,
    paddingBottom: 14,
  },

  divider: { height: StyleSheet.hairlineWidth, backgroundColor: tokens.neutral.n200, marginHorizontal: 20 },
  saveErrorBanner: {
    backgroundColor: '#fef2f2',
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: '#fecaca',
    padding: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  saveErrorText: { color: tokens.price.expensive, fontSize: 13 },
  errorText: { fontSize: 14, color: tokens.price.expensive, marginBottom: 16, textAlign: 'center' },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: tokens.brand.accent,
  },
  retryText: { color: tokens.brand.accent, fontSize: 14, fontWeight: '500' },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: tokens.neutral.n800, textAlign: 'center' },
});
