import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { tokens } from '../../src/theme';
import { useAuth } from '../../src/store/auth.store';
import { apiListVehicles, type Vehicle } from '../../src/api/vehicles';
import { formatVehicleDisplayName, formatVehicleSubtitle } from '../../src/utils/formatVehicle';
import { TopChrome } from '../../src/components/TopChrome';

/**
 * /vehicles — dedicated vehicle management screen. Lifted out of the Log
 * screen (Story 5.5 ListHeader) which used to render this list inline,
 * crowding the actual fillup history. The Log screen now links here via
 * the "Pojazdy →" affordance.
 */
export default function VehiclesScreen() {
  const { t } = useTranslation();
  const { accessToken } = useAuth();
  const params = useLocalSearchParams<{ deletedId?: string }>();

  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  // Honour the optimistic-prune pattern from log.tsx — vehicle/[id].tsx
  // sets ?deletedId=<uuid> after a successful DELETE so the user doesn't
  // see (and tap) the deleted row during the focus-refetch round-trip.
  useEffect(() => {
    const deletedId = params.deletedId;
    if (!deletedId) return;
    setVehicles((prev) => (prev ? prev.filter((v) => v.id !== deletedId) : prev));
    router.setParams({ deletedId: undefined });
  }, [params.deletedId]);

  const load = useCallback(async () => {
    if (!accessToken) {
      setVehicles([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await apiListVehicles(accessToken);
      if (cancelledRef.current) return;
      setVehicles(list);
    } catch (e) {
      console.warn('vehicle list load failed', e);
      if (!cancelledRef.current) setError(t('log.loadError'));
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, [accessToken, t]);

  useFocusEffect(
    useCallback(() => {
      cancelledRef.current = false;
      void load();
      return () => {
        cancelledRef.current = true;
      };
    }, [load]),
  );

  if (!accessToken) {
    return (
      <View style={styles.screen}>
        <TopChrome />
        <View style={styles.guestContainer}>
          <Text style={styles.guestTitle}>{t('log.guestTitle')}</Text>
          <Text style={styles.guestSubtitle}>{t('log.guestSubtitle')}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <TopChrome />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.sectionTitle}>{t('log.vehiclesTitle')}</Text>
        <Text style={styles.sectionSubtitle}>{t('log.vehiclesSubtitle')}</Text>

        {loading && !vehicles && (
          <View style={styles.center}>
            <ActivityIndicator color={tokens.brand.accent} />
          </View>
        )}

        {error && <Text style={styles.errorText}>{error}</Text>}

        {vehicles && vehicles.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>{t('log.emptyTitle')}</Text>
            <Text style={styles.emptySubtitle}>{t('log.emptySubtitle')}</Text>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => router.push('/(app)/vehicle-setup')}
              accessibilityRole="button"
            >
              <Text style={styles.primaryButtonText}>{t('log.addVehicle')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {vehicles?.map((v) => {
              const displayName = formatVehicleDisplayName(v);
              const subtitle = formatVehicleSubtitle(v);
              return (
                <TouchableOpacity
                  key={v.id}
                  style={styles.vehicleCard}
                  onPress={() =>
                    router.push({
                      pathname: '/(app)/vehicle/[id]',
                      params: { id: v.id },
                    })
                  }
                  accessibilityRole="button"
                  accessibilityLabel={subtitle ? `${displayName}, ${subtitle}` : displayName}
                >
                  <View style={styles.vehicleCardBody}>
                    <Text style={styles.vehicleNickname}>{displayName}</Text>
                    {subtitle ? <Text style={styles.vehicleSubtitle}>{subtitle}</Text> : null}
                  </View>
                  <Text style={styles.vehicleChevron}>›</Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              style={styles.recordOdometerButton}
              onPress={() => router.push('/(app)/odometer-capture')}
              accessibilityRole="button"
            >
              <Text style={styles.recordOdometerText}>{t('log.recordOdometer')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.addButton}
              onPress={() => router.push('/(app)/vehicle-setup')}
              accessibilityRole="button"
            >
              <Text style={styles.addButtonText}>+ {t('log.addVehicle')}</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: tokens.surface.page },
  scrollContent: {
    padding: 24,
    paddingBottom: 48,
  },
  center: {
    paddingVertical: 48,
    alignItems: 'center',
  },
  guestContainer: {
    flex: 1,
    backgroundColor: tokens.surface.page,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  guestTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: tokens.brand.ink,
    marginBottom: 8,
    textAlign: 'center',
  },
  guestSubtitle: {
    fontSize: 14,
    color: tokens.neutral.n500,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: tokens.brand.ink,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: tokens.neutral.n500,
    marginBottom: 24,
    lineHeight: 20,
  },
  errorText: {
    fontSize: 14,
    color: tokens.price.expensive,
    marginBottom: 12,
  },
  emptyCard: {
    padding: 24,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.neutral.n200,
    backgroundColor: tokens.surface.card,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: tokens.brand.ink,
    marginBottom: 4,
  },
  emptySubtitle: {
    fontSize: 13,
    color: tokens.neutral.n500,
    marginBottom: 20,
    textAlign: 'center',
  },
  vehicleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.neutral.n200,
    backgroundColor: tokens.surface.card,
    marginBottom: 12,
  },
  vehicleCardBody: { flex: 1 },
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
  vehicleChevron: {
    fontSize: 24,
    color: tokens.neutral.n400,
    marginLeft: 8,
  },
  addButton: {
    marginTop: 8,
    paddingVertical: 14,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.brand.accent,
    alignItems: 'center',
    backgroundColor: tokens.surface.card,
  },
  addButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: tokens.brand.accent,
  },
  recordOdometerButton: {
    marginTop: 8,
    paddingVertical: 14,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.neutral.n200,
    alignItems: 'center',
    backgroundColor: tokens.surface.card,
  },
  recordOdometerText: {
    fontSize: 15,
    fontWeight: '600',
    color: tokens.neutral.n500,
  },
  primaryButton: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.brand.accent,
    alignItems: 'center',
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: tokens.neutral.n0,
  },
});
