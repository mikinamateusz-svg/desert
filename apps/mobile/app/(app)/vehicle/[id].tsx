import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { tokens } from '../../../src/theme';
import { useAuth } from '../../../src/store/auth.store';
import {
  apiDeleteVehicle,
  apiGetVehicle,
  apiUpdateVehicle,
  type Vehicle,
} from '../../../src/api/vehicles';
import { flags } from '../../../src/config/flags';

// Phase 2 gate at the entry point — see vehicle-setup.tsx for rationale.
export default function VehicleEditScreen() {
  if (!flags.phase2) return <Redirect href="/(app)/log" />;
  return <VehicleEditScreenContent />;
}

function VehicleEditScreenContent() {
  const { t } = useTranslation();
  // expo-router types params as `string | string[]` for catch-all routes; the
  // dynamic `[id]` route is single-value but a hostile invocation could still
  // surface an array. Normalise defensively.
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const { accessToken } = useAuth();

  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [nickname, setNickname] = useState('');
  const [engineVariant, setEngineVariant] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id || !accessToken) return;
    let cancelled = false;
    (async () => {
      try {
        const v = await apiGetVehicle(accessToken, id);
        if (cancelled) return;
        setVehicle(v);
        setNickname(v.nickname ?? '');
        setEngineVariant(v.engine_variant ?? '');
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('vehicle load failed', e);
        if (!cancelled) setError(t('vehicles.edit.loadError'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, accessToken, t]);

  async function handleSave() {
    if (!vehicle || !accessToken) return;
    setError(null);
    setSaving(true);
    try {
      const trimmedNickname = nickname.trim();
      const trimmedEngine = engineVariant.trim();
      const payload: { nickname?: string; engine_variant?: string } = {};
      if (trimmedNickname !== (vehicle.nickname ?? '')) {
        payload.nickname = trimmedNickname.length > 0 ? trimmedNickname : undefined;
      }
      if (trimmedEngine !== (vehicle.engine_variant ?? '')) {
        payload.engine_variant = trimmedEngine.length > 0 ? trimmedEngine : undefined;
      }
      // Short-circuit when nothing changed — avoids a wasted PATCH that would
      // bump updated_at without any user-visible diff.
      if (Object.keys(payload).length === 0) {
        router.back();
        return;
      }
      const updated = await apiUpdateVehicle(accessToken, vehicle.id, payload);
      setVehicle(updated);
      router.back();
    } catch (e) {
      setError(t('vehicles.edit.saveError'));
      // eslint-disable-next-line no-console
      console.warn('vehicle update failed', e);
    } finally {
      // Always reset; without finally a non-throwing navigation hiccup leaves
      // the save button permanently disabled.
      setSaving(false);
    }
  }

  function handleDelete() {
    if (!vehicle || !accessToken) return;
    Alert.alert(
      t('vehicles.edit.deleteConfirmTitle'),
      t('vehicles.edit.deleteConfirmBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('vehicles.edit.deleteConfirm'),
          style: 'destructive',
          onPress: async () => {
            try {
              await apiDeleteVehicle(accessToken, vehicle.id);
              router.back();
            } catch (e) {
              // eslint-disable-next-line no-console
              console.warn('vehicle delete failed', e);
              // Surface the API error message rather than a generic toast —
              // the previous Content-Type-on-empty-body bug returned 400
              // with a useful message that was completely hidden by the
              // generic deleteError fallback. Now the user sees what
              // actually went wrong (locked, network, etc.) and we can
              // diagnose without checking the JS console.
              const apiMessage = e instanceof Error ? e.message : '';
              Alert.alert(
                t('vehicles.edit.deleteError'),
                apiMessage || undefined,
              );
            }
          },
        },
      ],
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.center}>
          <ActivityIndicator color={tokens.brand.accent} />
        </View>
      </SafeAreaView>
    );
  }

  if (!vehicle) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.center}>
          <Text style={styles.errorText}>
            {error ?? t('vehicles.edit.notFound')}
          </Text>
          <TouchableOpacity onPress={() => router.back()} style={styles.cancelButton}>
            <Text style={styles.cancelText}>{t('common.close')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
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
        <Text style={styles.headerTitle}>{t('vehicles.edit.title')}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Identity (read-only when locked) */}
        <View style={styles.identityCard}>
          <Text style={styles.identityLine}>
            {vehicle.year} {vehicle.make} {vehicle.model}
          </Text>
          {vehicle.engine_variant && (
            <Text style={styles.identitySublabel}>{vehicle.engine_variant}</Text>
          )}
          {vehicle.is_locked && (
            <Text style={styles.lockedNote}>{t('vehicles.edit.lockedNote')}</Text>
          )}
        </View>

        <Text style={styles.fieldLabel}>{t('vehicles.edit.nicknameLabel')}</Text>
        <TextInput
          value={nickname}
          onChangeText={setNickname}
          style={styles.input}
          placeholder={t('vehicles.edit.nicknamePlaceholder')}
          placeholderTextColor={tokens.neutral.n400}
          maxLength={50}
        />

        <Text style={styles.fieldLabel}>{t('vehicles.edit.engineLabel')}</Text>
        <TextInput
          value={engineVariant}
          onChangeText={setEngineVariant}
          style={styles.input}
          placeholder={t('vehicles.edit.enginePlaceholder')}
          placeholderTextColor={tokens.neutral.n400}
          maxLength={100}
        />

        {error && <Text style={styles.errorText}>{error}</Text>}

        <TouchableOpacity
          style={[styles.saveButton, saving && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={saving}
          accessibilityRole="button"
        >
          {saving ? (
            <ActivityIndicator color={tokens.neutral.n0} />
          ) : (
            <Text style={styles.saveButtonText}>
              {t('vehicles.edit.saveButton')}
            </Text>
          )}
        </TouchableOpacity>

        {!vehicle.is_locked && (
          <TouchableOpacity
            style={styles.deleteRow}
            onPress={handleDelete}
            accessibilityRole="button"
          >
            <Text style={styles.deleteText}>
              {t('vehicles.edit.deleteButton')}
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: tokens.surface.page,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
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
  identityCard: {
    padding: 16,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.surface.card,
    borderWidth: 1,
    borderColor: tokens.neutral.n200,
    marginBottom: 24,
  },
  identityLine: {
    fontSize: 17,
    fontWeight: '600',
    color: tokens.brand.ink,
  },
  identitySublabel: {
    fontSize: 13,
    color: tokens.neutral.n500,
    marginTop: 4,
  },
  lockedNote: {
    fontSize: 12,
    color: tokens.neutral.n400,
    marginTop: 8,
    fontStyle: 'italic',
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: tokens.neutral.n500,
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
  cancelButton: {
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.neutral.n200,
  },
  cancelText: {
    fontSize: 14,
    color: tokens.brand.ink,
  },
  deleteRow: {
    alignItems: 'center',
    paddingVertical: 16,
    marginTop: 24,
  },
  deleteText: {
    fontSize: 14,
    color: tokens.price.expensive,
    fontWeight: '500',
  },
});
