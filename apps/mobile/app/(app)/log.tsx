import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { tokens } from '../../src/theme';
import { useAuth } from '../../src/store/auth.store';
import { apiListVehicles, type Vehicle } from '../../src/api/vehicles';
import { flags } from '../../src/config/flags';
import { TopChrome } from '../../src/components/TopChrome';

// Phase 2 gate lives at the entry point so the inner component (with all the
// hooks for vehicle fetching) is never mounted in production builds. Keeps the
// Rules-of-Hooks invariant clean — no hooks under a conditional return.
export default function LogScreen() {
  if (!flags.phase2) return <ComingSoonScreen />;
  return <LogScreenContent />;
}

function ComingSoonScreen() {
  const { t } = useTranslation();
  return (
    <View style={styles.screen}>
      <TopChrome />
      <View style={styles.guestContainer}>
        <Text style={styles.guestTitle}>{t('log.comingSoonTitle')}</Text>
        <Text style={styles.guestSubtitle}>{t('log.comingSoonSubtitle')}</Text>
      </View>
    </View>
  );
}

function LogScreenContent() {
  const { t } = useTranslation();
  const { accessToken } = useAuth();

  // `deletedId` is set by vehicle/[id].tsx after a successful DELETE — see
  // its handleDelete onPress. We use it for an optimistic local prune so the
  // user doesn't see (and tap) the deleted row during the focus-refetch
  // network round-trip. The refetch still runs and reconciles canonically,
  // this just smooths the visible jump.
  const params = useLocalSearchParams<{ deletedId?: string }>();

  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Optimistic prune: when we land here with ?deletedId=xxx, drop that row
  // from cached list immediately. Runs once per param value (we wipe the
  // search params via router.setParams so the same hint can't re-fire).
  useEffect(() => {
    const deletedId = params.deletedId;
    if (!deletedId) return;
    setVehicles((prev) => (prev ? prev.filter((v) => v.id !== deletedId) : prev));
    // Clear the param so a back-navigation that re-mounts this screen
    // doesn't re-apply a stale hint.
    router.setParams({ deletedId: undefined });
  }, [params.deletedId]);

  // Ref so loadVehicles can read "have we loaded once?" without putting the
  // mutable `vehicles` state into useFocusEffect's deps (which would re-create
  // the callback on every render and burn the loading-state distinction).
  const initialLoadDoneRef = useRef(false);
  // Flag flipped by the focus-effect cleanup so async fetches don't write to
  // an unmounted/blurred screen.
  const cancelledRef = useRef(false);

  const loadVehicles = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (!accessToken) {
        if (!cancelledRef.current) setVehicles([]);
        initialLoadDoneRef.current = true;
        return;
      }
      if (mode === 'refresh') setRefreshing(true);
      else if (!initialLoadDoneRef.current) setLoading(true);
      if (!cancelledRef.current) setError(null);
      try {
        const list = await apiListVehicles(accessToken);
        if (!cancelledRef.current) setVehicles(list);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('vehicle list load failed', e);
        if (!cancelledRef.current) setError(t('log.loadError'));
      } finally {
        initialLoadDoneRef.current = true;
        if (!cancelledRef.current) {
          setRefreshing(false);
          setLoading(false);
        }
      }
    },
    [accessToken, t],
  );

  useFocusEffect(
    useCallback(() => {
      cancelledRef.current = false;
      void loadVehicles('initial');
      return () => {
        cancelledRef.current = true;
      };
    }, [loadVehicles]),
  );

  // Build the body once, then wrap in TopChrome — all three branches
  // (guest / loading / list) share the same chrome + safe-area treatment.
  let body: ReactNode;
  if (!accessToken) {
    body = (
      <View style={styles.guestContainer}>
        <Text style={styles.guestTitle}>{t('log.guestTitle')}</Text>
        <Text style={styles.guestSubtitle}>{t('log.guestSubtitle')}</Text>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => router.replace('/(auth)/login')}
        >
          <Text style={styles.primaryButtonText}>{t('log.guestSignIn')}</Text>
        </TouchableOpacity>
      </View>
    );
  } else if (loading && vehicles === null) {
    body = (
      <View style={styles.center}>
        <ActivityIndicator color={tokens.brand.accent} />
      </View>
    );
  } else {
    body = (
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadVehicles('refresh')}
          />
        }
      >
        <Text style={styles.sectionTitle}>{t('log.vehiclesTitle')}</Text>
        <Text style={styles.sectionSubtitle}>{t('log.vehiclesSubtitle')}</Text>

        {error && <Text style={styles.errorText}>{error}</Text>}

        {vehicles && vehicles.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>{t('log.emptyTitle')}</Text>
            <Text style={styles.emptySubtitle}>{t('log.emptySubtitle')}</Text>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => router.push('/(app)/vehicle-setup')}
            >
              <Text style={styles.primaryButtonText}>{t('log.addVehicle')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {vehicles?.map((v) => {
              const nickname = v.nickname?.trim();
              const identity = `${v.year} ${v.make} ${v.model}`;
              const a11yLabel = nickname
                ? `${nickname}, ${identity}${v.engine_variant ? `, ${v.engine_variant}` : ''}`
                : `${identity}${v.engine_variant ? `, ${v.engine_variant}` : ''}`;
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
                  accessibilityLabel={a11yLabel}
                >
                  <View style={styles.vehicleCardBody}>
                    <Text style={styles.vehicleNickname}>{nickname || identity}</Text>
                    <Text style={styles.vehicleSubtitle}>
                      {identity}
                      {v.engine_variant ? ` · ${v.engine_variant}` : ''}
                    </Text>
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
    );
  }

  return (
    <View style={styles.screen}>
      <TopChrome />
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: tokens.surface.page },
  container: {
    flex: 1,
    backgroundColor: tokens.surface.page,
  },
  content: {
    padding: 24,
    paddingBottom: 48,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: tokens.surface.page,
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
  vehicleCardBody: {
    flex: 1,
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
