import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  getMakes,
  getModels,
  getModelDisplayName,
  getYearsForModel,
  getEnginesForYear,
  type CatalogModel,
  type CatalogEngine,
  type VehicleFuelType,
} from '@desert/types';
import { tokens } from '../../src/theme';
import { useAuth } from '../../src/store/auth.store';
import { apiCreateVehicle } from '../../src/api/vehicles';
import { flags } from '../../src/config/flags';

const VEHICLE_FUEL_TYPES: VehicleFuelType[] = [
  'PB_95',
  'PB_98',
  'ON',
  'ON_PREMIUM',
  'LPG',
  'CNG',
  'EV',
  'PHEV',
];

type DraftField = 'make' | 'model' | 'year' | 'engine';

const MIN_YEAR = 1970;
const MAX_YEAR = new Date().getFullYear() + 1;

interface Draft {
  make: string;
  /** Display name shown in the StepCard (e.g. "Golf"). */
  model: string;
  /**
   * Stable catalog key for catalog-picked models (e.g. "Volkswagen Golf").
   * Null when free-texted; matched against `CatalogModel.key` so two models
   * with identical display names but different wikidata IDs don't collide.
   */
  modelKey: string | null;
  year: number | null;
  engine: CatalogEngine | null;
  /** Free-text engine label when no catalog engine matches. */
  engineFreeText: string;
  /** Set independently of engine when a free-text path is taken. */
  fuelType: VehicleFuelType | null;
  nickname: string;
  manualFlags: Record<DraftField, boolean>;
}

const EMPTY_DRAFT: Draft = {
  make: '',
  model: '',
  modelKey: null,
  year: null,
  engine: null,
  engineFreeText: '',
  fuelType: null,
  nickname: '',
  manualFlags: { make: false, model: false, year: false, engine: false },
};

/**
 * Diacritic-insensitive normalization so users searching "skoda" find "Škoda"
 * and "citroen" finds "Citroën". NFD splits combining marks; the regex strips
 * U+0300..U+036F (Combining Diacritical Marks block).
 */
function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Phase 2 gate at the entry point keeps Rules-of-Hooks clean — no hooks under
// a conditional return — and prevents prod users from deep-linking into the
// wizard even if the route stays registered.
export default function VehicleSetupScreen() {
  if (!flags.phase2) return <Redirect href="/(app)/log" />;
  return <VehicleSetupScreenContent />;
}

function VehicleSetupScreenContent() {
  const { t } = useTranslation();
  const { accessToken } = useAuth();

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [picker, setPicker] = useState<DraftField | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const makes = useMemo(() => getMakes(), []);
  const models = useMemo<CatalogModel[]>(
    () => (draft.make && !draft.manualFlags.make ? getModels(draft.make) : []),
    [draft.make, draft.manualFlags.make],
  );
  // Match on `modelKey` (catalog-stable) rather than display name, which can
  // collide between models that share a generation label across regions.
  const selectedModel = useMemo<CatalogModel | null>(
    () => (draft.modelKey ? models.find((m) => m.key === draft.modelKey) ?? null : null),
    [models, draft.modelKey],
  );
  const years = useMemo<number[]>(
    () => (selectedModel && !draft.manualFlags.model ? getYearsForModel(selectedModel) : []),
    [selectedModel, draft.manualFlags.model],
  );
  const engines = useMemo<CatalogEngine[]>(
    () =>
      selectedModel && draft.year !== null && !draft.manualFlags.year
        ? getEnginesForYear(selectedModel, draft.year)
        : [],
    [selectedModel, draft.year, draft.manualFlags.year],
  );

  // Once any step is free-texted, downstream catalog filters can't apply.
  const downstreamManual = (field: DraftField): boolean => {
    if (field === 'model') return draft.manualFlags.make;
    if (field === 'year') return draft.manualFlags.make || draft.manualFlags.model;
    if (field === 'engine')
      return (
        draft.manualFlags.make || draft.manualFlags.model || draft.manualFlags.year
      );
    return false;
  };

  const isStepComplete = (field: DraftField): boolean => {
    if (field === 'make') return draft.make.trim().length > 0;
    if (field === 'model') return draft.model.trim().length > 0;
    // Year must be in the API-accepted range. Mobile-side gate prevents
    // submissions like 0/19/1899 that would only fail server-side @Min/@Max.
    if (field === 'year')
      return (
        draft.year !== null && draft.year >= MIN_YEAR && draft.year <= MAX_YEAR
      );
    if (field === 'engine')
      return draft.engine !== null || draft.engineFreeText.trim().length > 0;
    return false;
  };

  const canSave =
    isStepComplete('make') &&
    isStepComplete('model') &&
    isStepComplete('year') &&
    isStepComplete('engine') &&
    draft.fuelType !== null;

  function pickMake(make: string) {
    setDraft((prev) => ({
      ...EMPTY_DRAFT,
      make,
      // Preserve the user's nickname when the make is changed late in the flow —
      // they shouldn't have to retype it just because they corrected the brand.
      nickname: prev.nickname,
      manualFlags: { ...EMPTY_DRAFT.manualFlags, make: false },
    }));
    setPicker(null);
  }

  function pickModel(model: CatalogModel) {
    const displayName = getModelDisplayName(draft.make, model);
    setDraft({
      ...draft,
      model: displayName,
      modelKey: model.key,
      year: null,
      engine: null,
      engineFreeText: '',
      fuelType: null,
      manualFlags: { ...draft.manualFlags, model: false },
    });
    setPicker(null);
  }

  function pickYear(year: number) {
    setDraft({
      ...draft,
      year,
      engine: null,
      engineFreeText: '',
      fuelType: null,
      manualFlags: { ...draft.manualFlags, year: false },
    });
    setPicker(null);
  }

  function pickEngine(engine: CatalogEngine) {
    setDraft({
      ...draft,
      engine,
      engineFreeText: '',
      fuelType: engine.fuel_type,
      manualFlags: { ...draft.manualFlags, engine: false },
    });
    setPicker(null);
  }

  function switchToManual(field: DraftField) {
    setDraft((prev) => {
      const next = { ...prev, manualFlags: { ...prev.manualFlags, [field]: true } };
      if (field === 'make') {
        next.make = '';
        next.model = '';
        next.modelKey = null;
        next.year = null;
        next.engine = null;
        next.engineFreeText = '';
        next.fuelType = null;
      } else if (field === 'model') {
        next.model = '';
        next.modelKey = null;
        next.year = null;
        next.engine = null;
        next.engineFreeText = '';
        next.fuelType = null;
      } else if (field === 'year') {
        next.year = null;
        next.engine = null;
        next.engineFreeText = '';
        next.fuelType = null;
      } else {
        next.engine = null;
        next.engineFreeText = '';
        next.fuelType = null;
      }
      return next;
    });
    setPicker(null);
  }

  async function handleSave() {
    if (!canSave || !accessToken) return;
    setError(null);
    setSubmitting(true);
    try {
      const userEntered = Object.values(draft.manualFlags).some(Boolean);
      const trimmedFreeEngine = draft.engineFreeText.trim();
      const payload = {
        make: draft.make.trim(),
        model: draft.model.trim(),
        year: draft.year!,
        engine_variant: draft.engine?.name ?? (trimmedFreeEngine || undefined),
        displacement_cc: draft.engine?.displacement_cc ?? undefined,
        power_kw: draft.engine?.power_kw ?? undefined,
        fuel_type: draft.fuelType!,
        nickname: draft.nickname.trim() || undefined,
        user_entered: userEntered,
      };
      await apiCreateVehicle(accessToken, payload);
      router.replace('/(app)/log');
    } catch (e) {
      setError(t('vehicles.setup.saveError'));
      // eslint-disable-next-line no-console
      console.warn('vehicle create failed', e);
    } finally {
      // Always reset submitting — without `finally` a non-throwing navigation
      // hiccup would leave the button permanently disabled.
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.closeButton}
          accessibilityLabel={t('common.close')}
          accessibilityRole="button"
        >
          <Text style={styles.closeText}>✕</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('vehicles.setup.title')}</Text>
      </View>

      <KeyboardAvoidingView
        style={styles.flex1}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.subtitle}>{t('vehicles.setup.subtitle')}</Text>

        {/* ── Make ── */}
        <StepCard
          label={t('vehicles.setup.makeLabel')}
          value={draft.make || t('vehicles.setup.makePlaceholder')}
          onPress={() => setPicker('make')}
          manual={draft.manualFlags.make}
          done={isStepComplete('make')}
        />
        {draft.manualFlags.make && (
          <TextInput
            value={draft.make}
            onChangeText={(text) => setDraft({ ...draft, make: text })}
            style={styles.manualInput}
            placeholder={t('vehicles.setup.makeManualPlaceholder')}
            placeholderTextColor={tokens.neutral.n400}
            autoCapitalize="words"
          />
        )}

        {/* ── Model ── */}
        <StepCard
          label={t('vehicles.setup.modelLabel')}
          value={draft.model || t('vehicles.setup.modelPlaceholder')}
          onPress={() => setPicker('model')}
          disabled={!isStepComplete('make')}
          manual={draft.manualFlags.model || downstreamManual('model')}
          done={isStepComplete('model')}
        />
        {(draft.manualFlags.model || downstreamManual('model')) &&
          isStepComplete('make') && (
            <TextInput
              value={draft.model}
              onChangeText={(text) => setDraft({ ...draft, model: text })}
              style={styles.manualInput}
              placeholder={t('vehicles.setup.modelManualPlaceholder')}
              placeholderTextColor={tokens.neutral.n400}
              autoCapitalize="words"
            />
          )}

        {/* ── Year ── */}
        <StepCard
          label={t('vehicles.setup.yearLabel')}
          value={
            draft.year !== null
              ? String(draft.year)
              : t('vehicles.setup.yearPlaceholder')
          }
          onPress={() => setPicker('year')}
          disabled={!isStepComplete('model')}
          manual={draft.manualFlags.year || downstreamManual('year')}
          done={isStepComplete('year')}
        />
        {(draft.manualFlags.year || downstreamManual('year')) &&
          isStepComplete('model') && (
            <TextInput
              value={draft.year !== null ? String(draft.year) : ''}
              onChangeText={(text) => {
                const parsed = parseInt(text.replace(/[^0-9]/g, ''), 10);
                setDraft({
                  ...draft,
                  year: Number.isFinite(parsed) ? parsed : null,
                });
              }}
              style={styles.manualInput}
              placeholder={t('vehicles.setup.yearManualPlaceholder')}
              placeholderTextColor={tokens.neutral.n400}
              keyboardType="number-pad"
              maxLength={4}
            />
          )}

        {/* ── Engine ── */}
        <StepCard
          label={t('vehicles.setup.engineLabel')}
          value={
            draft.engine
              ? formatEngineLabel(draft.engine)
              : draft.engineFreeText || t('vehicles.setup.enginePlaceholder')
          }
          onPress={() => setPicker('engine')}
          disabled={!isStepComplete('year')}
          manual={draft.manualFlags.engine || downstreamManual('engine')}
          done={isStepComplete('engine')}
        />
        {(draft.manualFlags.engine || downstreamManual('engine')) &&
          isStepComplete('year') && (
            <View>
              <TextInput
                value={draft.engineFreeText}
                onChangeText={(text) =>
                  setDraft({ ...draft, engineFreeText: text, engine: null })
                }
                style={styles.manualInput}
                placeholder={t('vehicles.setup.engineManualPlaceholder')}
                placeholderTextColor={tokens.neutral.n400}
              />
              <Text style={styles.fuelTypeLabel}>
                {t('vehicles.setup.fuelTypeLabel')}
              </Text>
              <View style={styles.fuelTypeRow}>
                {VEHICLE_FUEL_TYPES.map((ft) => (
                  <TouchableOpacity
                    key={ft}
                    style={[
                      styles.fuelTypeChip,
                      draft.fuelType === ft && styles.fuelTypeChipActive,
                    ]}
                    onPress={() => setDraft({ ...draft, fuelType: ft })}
                    accessibilityRole="button"
                    accessibilityState={{ selected: draft.fuelType === ft }}
                  >
                    <Text
                      style={[
                        styles.fuelTypeChipText,
                        draft.fuelType === ft && styles.fuelTypeChipTextActive,
                      ]}
                    >
                      {t(`vehicles.fuelTypes.${ft}`)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

        {/* ── Nickname ── */}
        <Text style={styles.nicknameLabel}>
          {t('vehicles.setup.nicknameLabel')}
        </Text>
        <TextInput
          value={draft.nickname}
          onChangeText={(text) => setDraft({ ...draft, nickname: text })}
          style={styles.manualInput}
          placeholder={t('vehicles.setup.nicknamePlaceholder')}
          placeholderTextColor={tokens.neutral.n400}
          maxLength={50}
        />
        <Text style={styles.nicknameHint}>
          {t('vehicles.setup.nicknameHint')}
        </Text>

        {error && <Text style={styles.errorText}>{error}</Text>}

        <TouchableOpacity
          style={[
            styles.saveButton,
            (!canSave || submitting) && styles.saveButtonDisabled,
          ]}
          onPress={handleSave}
          disabled={!canSave || submitting}
          accessibilityRole="button"
        >
          {submitting ? (
            <ActivityIndicator color={tokens.neutral.n0} />
          ) : (
            <Text style={styles.saveButtonText}>
              {t('vehicles.setup.saveButton')}
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>
      </KeyboardAvoidingView>

      {/* ── Picker modal ── */}
      <PickerModal
        visible={picker !== null}
        onClose={() => setPicker(null)}
        title={
          picker === 'make'
            ? t('vehicles.setup.makeLabel')
            : picker === 'model'
              ? t('vehicles.setup.modelLabel')
              : picker === 'year'
                ? t('vehicles.setup.yearLabel')
                : t('vehicles.setup.engineLabel')
        }
        items={
          picker === 'make'
            ? makes.map((m) => ({ key: m, label: m, raw: m }))
            : picker === 'model'
              ? models.map((m) => ({
                  key: m.key,
                  label: getModelDisplayName(draft.make, m),
                  raw: m,
                }))
              : picker === 'year'
                ? years.map((y) => ({ key: String(y), label: String(y), raw: y }))
                : engines.map((e) => ({
                    key: e.name,
                    label: formatEngineLabel(e),
                    sublabel: formatEngineSublabel(e),
                    raw: e,
                  }))
        }
        searchable={picker === 'make' || picker === 'model' || picker === 'engine'}
        manualLabel={
          picker === 'make'
            ? t('vehicles.setup.manualMake')
            : picker === 'model'
              ? t('vehicles.setup.manualModel')
              : picker === 'year'
                ? t('vehicles.setup.manualYear')
                : t('vehicles.setup.manualEngine')
        }
        // Engine picker can return an empty list when the catalog has no engines
        // covering the selected year — surface a hint pointing to manual fallback
        // so users aren't trapped staring at an empty list.
        emptyHint={picker === 'engine' ? t('vehicles.setup.engineEmptyHint') : undefined}
        onSelect={(item) => {
          if (picker === 'make') pickMake(item.raw as string);
          else if (picker === 'model') pickModel(item.raw as CatalogModel);
          else if (picker === 'year') pickYear(item.raw as number);
          else if (picker === 'engine') pickEngine(item.raw as CatalogEngine);
        }}
        onManual={() => picker && switchToManual(picker)}
      />
    </SafeAreaView>
  );
}

function formatEngineLabel(engine: CatalogEngine): string {
  return engine.name;
}

function formatEngineSublabel(engine: CatalogEngine): string {
  const parts: string[] = [];
  if (engine.displacement_cc !== null) parts.push(`${engine.displacement_cc} cc`);
  if (engine.power_kw !== null && engine.power_hp !== null) {
    parts.push(`${engine.power_kw} kW / ${engine.power_hp} HP`);
  }
  parts.push(engine.fuel_type);
  return parts.join(' • ');
}

interface StepCardProps {
  label: string;
  value: string;
  onPress: () => void;
  disabled?: boolean;
  manual?: boolean;
  done?: boolean;
}

function StepCard({ label, value, onPress, disabled, manual, done }: StepCardProps) {
  return (
    <View style={styles.stepWrapper}>
      <Text style={styles.stepLabel}>{label}</Text>
      <TouchableOpacity
        style={[
          styles.stepCard,
          disabled && styles.stepCardDisabled,
          done && styles.stepCardDone,
        ]}
        onPress={onPress}
        disabled={disabled || manual}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value}`}
      >
        <Text
          style={[
            styles.stepValue,
            !done && styles.stepValuePlaceholder,
            disabled && styles.stepValueDisabled,
          ]}
          numberOfLines={1}
        >
          {value}
        </Text>
        {!manual && !disabled && <Text style={styles.stepChevron}>›</Text>}
      </TouchableOpacity>
    </View>
  );
}

interface PickerItem {
  key: string;
  label: string;
  sublabel?: string;
  raw: unknown;
}

interface PickerModalProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  items: PickerItem[];
  searchable: boolean;
  manualLabel: string;
  /** Shown when items is empty for a non-searched picker (e.g. catalog gap). */
  emptyHint?: string;
  onSelect: (item: PickerItem) => void;
  onManual: () => void;
}

function PickerModal({
  visible,
  onClose,
  title,
  items,
  searchable,
  manualLabel,
  emptyHint,
  onSelect,
  onManual,
}: PickerModalProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');

  // Reset the search field whenever the modal becomes visible. Without this,
  // reopening the picker for a different field (e.g. make → model) shows the
  // previous query filtering an entirely different list.
  useEffect(() => {
    if (visible) setSearch('');
  }, [visible]);

  const filtered = useMemo(() => {
    if (!searchable || !search.trim()) return items;
    const needle = normalize(search.trim());
    return items.filter((it) => normalize(it.label).includes(needle));
  }, [items, search, searchable]);

  return (
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.modalContainer}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
        <View style={styles.modalSheet} accessibilityViewIsModal>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>{title}</Text>
          {searchable && (
            <TextInput
              value={search}
              onChangeText={setSearch}
              style={styles.searchInput}
              placeholder={t('vehicles.setup.searchPlaceholder')}
              placeholderTextColor={tokens.neutral.n400}
              autoCorrect={false}
              autoCapitalize="none"
            />
          )}
          <FlatList
            data={filtered}
            keyExtractor={(it) => it.key}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.modalRow}
                onPress={() => onSelect(item)}
                accessibilityRole="button"
              >
                <Text style={styles.modalRowLabel}>{item.label}</Text>
                {item.sublabel && (
                  <Text style={styles.modalRowSublabel}>{item.sublabel}</Text>
                )}
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <Text style={styles.modalEmptyText}>
                {/* If the catalog itself is empty (e.g. no engines for this year),
                    show the actionable hint pointing the user at the manual fallback.
                    Otherwise the search just didn't match. */}
                {items.length === 0 && emptyHint
                  ? emptyHint
                  : t('vehicles.setup.noMatches')}
              </Text>
            }
          />
          <TouchableOpacity
            style={styles.modalManualButton}
            onPress={onManual}
          >
            <Text style={styles.modalManualText}>{manualLabel}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: tokens.surface.page,
  },
  flex1: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.neutral.n200,
    backgroundColor: tokens.surface.card,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: tokens.neutral.n200,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  closeText: {
    fontSize: 16,
    fontWeight: '600',
    color: tokens.neutral.n500,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: tokens.brand.ink,
  },
  content: {
    padding: 24,
    paddingBottom: 48,
  },
  subtitle: {
    fontSize: 14,
    color: tokens.neutral.n500,
    marginBottom: 24,
    lineHeight: 20,
  },
  stepWrapper: {
    marginBottom: 16,
  },
  stepLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: tokens.neutral.n500,
    marginBottom: 6,
  },
  stepCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.neutral.n200,
    backgroundColor: tokens.surface.card,
  },
  stepCardDisabled: {
    opacity: 0.5,
  },
  stepCardDone: {
    borderColor: tokens.brand.accent,
  },
  stepValue: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    color: tokens.brand.ink,
  },
  stepValuePlaceholder: {
    color: tokens.neutral.n400,
    fontWeight: '400',
  },
  stepValueDisabled: {
    color: tokens.neutral.n400,
  },
  stepChevron: {
    fontSize: 22,
    color: tokens.neutral.n400,
    marginLeft: 8,
  },
  manualInput: {
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
  fuelTypeLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: tokens.neutral.n500,
    marginTop: 4,
    marginBottom: 8,
  },
  fuelTypeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  fuelTypeChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: tokens.radius.full,
    borderWidth: 1,
    borderColor: tokens.neutral.n200,
    backgroundColor: tokens.surface.card,
  },
  fuelTypeChipActive: {
    borderColor: tokens.brand.accent,
    backgroundColor: '#fffbeb',
  },
  fuelTypeChipText: {
    fontSize: 13,
    color: tokens.neutral.n500,
    fontWeight: '500',
  },
  fuelTypeChipTextActive: {
    color: tokens.brand.accent,
    fontWeight: '700',
  },
  nicknameLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: tokens.neutral.n500,
    marginTop: 8,
    marginBottom: 6,
  },
  nicknameHint: {
    fontSize: 12,
    color: tokens.neutral.n400,
    marginTop: -8,
    marginBottom: 24,
  },
  errorText: {
    fontSize: 14,
    color: tokens.price.expensive,
    marginBottom: 12,
  },
  saveButton: {
    paddingVertical: 16,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.brand.accent,
    alignItems: 'center',
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: tokens.neutral.n0,
  },

  // Modal
  modalContainer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalSheet: {
    height: '75%',
    backgroundColor: tokens.surface.card,
    borderTopLeftRadius: tokens.radius.lg,
    borderTopRightRadius: tokens.radius.lg,
    paddingTop: 12,
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: tokens.neutral.n200,
    alignSelf: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: tokens.brand.ink,
    textAlign: 'center',
    marginBottom: 12,
  },
  searchInput: {
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.neutral.n200,
    backgroundColor: tokens.neutral.n100,
    fontSize: 15,
    color: tokens.brand.ink,
  },
  modalRow: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.neutral.n200,
  },
  modalRowLabel: {
    fontSize: 16,
    color: tokens.brand.ink,
    fontWeight: '500',
  },
  modalRowSublabel: {
    fontSize: 12,
    color: tokens.neutral.n400,
    marginTop: 2,
  },
  modalEmptyText: {
    textAlign: 'center',
    fontSize: 14,
    color: tokens.neutral.n400,
    paddingVertical: 24,
  },
  modalManualButton: {
    paddingVertical: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: tokens.neutral.n200,
    alignItems: 'center',
  },
  modalManualText: {
    fontSize: 14,
    fontWeight: '600',
    color: tokens.brand.accent,
  },
});
