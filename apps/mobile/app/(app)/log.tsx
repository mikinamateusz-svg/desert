import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
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
import {
  apiListVehicles,
  apiGetVehicleBenchmark,
  type Vehicle,
  type ConsumptionBenchmarkDto,
} from '../../src/api/vehicles';
import {
  apiListFillups,
  type FillupListItem,
  type FillupPeriod,
  type FillupSummary,
} from '../../src/api/fillups';
import { calculateSavings } from '../../src/utils/savings';
import { SavingsDisplay } from '../../src/components/SavingsDisplay';
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

const ALL_VEHICLES = 'all' as const;
type VehicleScope = string; // vehicle UUID, OR the literal 'all'
const PERIOD_OPTIONS: FillupPeriod[] = ['30d', '3m', '12m', 'all'];
const PERIOD_DEFAULT: FillupPeriod = '3m';
const PAGE_LIMIT = 20;

// P4: simple lookup map replaces the convoluted ternary chain that picked
// a key with a capitalised 'All' suffix while everything else stayed lower.
const PERIOD_I18N_KEY: Record<FillupPeriod, string> = {
  '30d': 'history.period30d',
  '3m':  'history.period3m',
  '12m': 'history.period12m',
  'all': 'history.periodAll',
};

// P3: locale-aware number formatting. `toFixed` always emits a `.` decimal
// separator regardless of locale — Polish/Ukrainian users expect `,`. Use
// Intl via toLocaleString. Try/catch covers the (rare) Hermes case where a
// locale tag is rejected with RangeError; fall back to toFixed.
function formatNumber(value: number, locale: string, fractionDigits: number): string {
  try {
    return value.toLocaleString(locale, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
  } catch {
    return value.toFixed(fractionDigits);
  }
}

function LogScreenContent() {
  const { t, i18n } = useTranslation();
  const { accessToken } = useAuth();

  // `deletedId` is set by vehicle/[id].tsx after a successful DELETE — see
  // its handleDelete onPress. Optimistic local prune so the user doesn't see
  // (and tap) the deleted row during the focus-refetch round-trip.
  const params = useLocalSearchParams<{ deletedId?: string }>();

  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [vehiclesLoading, setVehiclesLoading] = useState(false);
  const [vehiclesError, setVehiclesError] = useState<string | null>(null);

  // History state. Selected scope defaults to 'all' on first mount so we
  // show something even before vehicles resolve. Switches to most-recent
  // vehicle on first vehicle list load if the user has 1+ vehicles.
  const [scope, setScope] = useState<VehicleScope>(ALL_VEHICLES);
  const [period, setPeriod] = useState<FillupPeriod>(PERIOD_DEFAULT);
  const [fillups, setFillups] = useState<FillupListItem[]>([]);
  const [summary, setSummary] = useState<FillupSummary | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
  // Defaults-on-first-mount latch — set true the first time we successfully
  // fetch vehicles, so subsequent vehicle refetches don't keep clobbering
  // the user's manual scope choice. Reset on auth change (P5) so a different
  // user logging in still gets their own most-recent vehicle picked.
  const scopeDefaultedRef = useRef(false);
  const cancelledRef = useRef(false);
  // Request-generation counter (P1). Bumped on every history reload — any
  // in-flight request whose token no longer matches the current generation
  // is ignored on resolution. Catches three races at once:
  //   - rapid scope/period taps overwriting each other out of order
  //   - onEndReached firing twice before the first setHistoryLoading commits
  //   - blur/focus jitter where the cancelled flag toggles mid-request
  const historyGenRef = useRef(0);

  // ── Vehicle list ─────────────────────────────────────────────────────────

  // P5: reset the "defaulted-once" latch when the auth token changes so a
  // new user logging in still triggers the most-recent-vehicle auto-pick.
  // Otherwise the ref carries over from the previous session and the new
  // user lands on 'all' until they manually pick a chip.
  useEffect(() => {
    scopeDefaultedRef.current = false;
  }, [accessToken]);

  useEffect(() => {
    const deletedId = params.deletedId;
    if (!deletedId) return;
    setVehicles((prev) => (prev ? prev.filter((v) => v.id !== deletedId) : prev));
    // If the user was scoped to the deleted vehicle, fall back to 'all' so
    // history doesn't render against a vehicle that no longer exists.
    if (scope === deletedId) setScope(ALL_VEHICLES);
    router.setParams({ deletedId: undefined });
  }, [params.deletedId, scope]);

  const loadVehicles = useCallback(async () => {
    if (!accessToken) {
      setVehicles([]);
      // P6: also reset the loading flag — without this, an in-flight
      // fetch that races with a logout would leave vehiclesLoading true
      // forever even though we shortcut to an empty list.
      setVehiclesLoading(false);
      return;
    }
    setVehiclesLoading(true);
    setVehiclesError(null);
    try {
      const list = await apiListVehicles(accessToken);
      if (cancelledRef.current) return;
      setVehicles(list);
      // First-time default: if the user has at least one vehicle and we
      // haven't yet picked a scope based on data, select the most recently
      // created vehicle so the summary cards show meaningful numbers
      // immediately. Subsequent refetches respect manual scope changes.
      if (!scopeDefaultedRef.current && list.length > 0) {
        const newest = [...list].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        )[0]!;
        setScope(newest.id);
        scopeDefaultedRef.current = true;
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('vehicle list load failed', e);
      if (!cancelledRef.current) setVehiclesError(t('log.loadError'));
    } finally {
      if (!cancelledRef.current) setVehiclesLoading(false);
    }
  }, [accessToken, t]);

  // ── History list ─────────────────────────────────────────────────────────

  // Single combined loader. `mode` distinguishes:
  //   - 'reload' → wiping current data, page = 1 (scope/period change, refresh)
  //   - 'next'   → appending to current data (onEndReached pagination)
  // Caller is responsible for not firing 'next' when there's no more data.
  //
  // Race control (P1): every reload bumps `historyGenRef`. After awaiting
  // the network we compare the captured token against the current ref —
  // mismatch means the user has switched scope/period since this request
  // launched, so we drop the response on the floor instead of clobbering
  // the visible data with stale rows. 'next' calls don't bump (they're
  // contributing to the current generation), so a reload during a
  // page-2 fetch correctly invalidates the page-2 append.
  const loadHistory = useCallback(
    async (mode: 'reload' | 'next', overrideScope?: VehicleScope, overridePeriod?: FillupPeriod) => {
      if (!accessToken) return;
      const effectiveScope = overrideScope ?? scope;
      const effectivePeriod = overridePeriod ?? period;
      const effectivePage = mode === 'reload' ? 1 : page + 1;
      const myGen = mode === 'reload' ? ++historyGenRef.current : historyGenRef.current;

      setHistoryLoading(true);
      setHistoryError(null);
      try {
        const response = await apiListFillups(accessToken, {
          vehicleId: effectiveScope,
          period: effectivePeriod,
          page: effectivePage,
          limit: PAGE_LIMIT,
        });
        if (cancelledRef.current || myGen !== historyGenRef.current) return;
        setFillups((prev) => {
          if (mode === 'reload') return response.data;
          // P2: dedupe-on-append. If a fill-up was inserted into the table
          // between the page-1 fetch and this page-2 fetch, the offset shift
          // can produce overlapping rows. Use a Set of seen ids to drop the
          // duplicates instead of letting React Native warn about clashing
          // keys and rendering ghost rows.
          const seen = new Set(prev.map((f) => f.id));
          const fresh = response.data.filter((f) => !seen.has(f.id));
          return [...prev, ...fresh];
        });
        setSummary(response.summary);
        setHistoryTotal(response.total);
        setPage(effectivePage);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('history load failed', e);
        if (!cancelledRef.current && myGen === historyGenRef.current) {
          setHistoryError(t('history.loadError'));
        }
      } finally {
        if (!cancelledRef.current && myGen === historyGenRef.current) {
          setHistoryLoading(false);
        }
      }
    },
    [accessToken, scope, period, page, t],
  );

  // Reload history whenever scope or period changes (after the initial
  // vehicle-list resolution latched scope to a real default).
  useEffect(() => {
    if (!accessToken) return;
    void loadHistory('reload');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, scope, period]);

  useFocusEffect(
    useCallback(() => {
      cancelledRef.current = false;
      void loadVehicles();
      return () => {
        cancelledRef.current = true;
      };
    }, [loadVehicles]),
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    // P7: clear the spinner exactly once both fetches settle (success or
    // failure). Previous code set `refreshing=false` inside loadHistory's
    // finally — but loadVehicles never touched it, so an early return in
    // either loader could leave the spinner stuck.
    Promise.all([loadHistory('reload'), loadVehicles()])
      .finally(() => {
        if (!cancelledRef.current) setRefreshing(false);
      });
  }, [loadHistory, loadVehicles]);

  const onEndReached = useCallback(() => {
    // Only fetch the next page when:
    //   - We're not already mid-load (avoids stacked requests)
    //   - There's actually more data on the server
    if (historyLoading) return;
    if (fillups.length >= historyTotal) return;
    void loadHistory('next');
  }, [historyLoading, fillups.length, historyTotal, loadHistory]);

  // ── Render: guest ────────────────────────────────────────────────────────

  if (!accessToken) {
    return (
      <View style={styles.screen}>
        <TopChrome />
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
      </View>
    );
  }

  // ── Render: full screen ──────────────────────────────────────────────────

  // FlatList with a ListHeaderComponent for everything above the list — the
  // chip row and the summary cards scroll together with the data, which keeps
  // the layout simple (no sticky-header coordination across nested scrolls).
  return (
    <View style={styles.screen}>
      <TopChrome />
      <FlatList
        data={fillups}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <FillUpCard
            fillUp={item}
            showVehicleLabel={scope === ALL_VEHICLES}
            locale={i18n.language}
          />
        )}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        onEndReached={onEndReached}
        // 0.5 = trigger when the user is halfway through the on-screen list
        // (~50% of viewport height from the bottom). Stricter than the
        // spec's "80% scrolled" intuition because RN's threshold is measured
        // from the END, not from the top of the list.
        onEndReachedThreshold={0.5}
        ListHeaderComponent={
          <ListHeader
            vehicles={vehicles}
            vehiclesError={vehiclesError}
            vehiclesLoading={vehiclesLoading}
            scope={scope}
            onScopeChange={setScope}
            period={period}
            onPeriodChange={setPeriod}
            summary={summary}
            historyError={historyError}
          />
        }
        ListEmptyComponent={
          historyLoading ? (
            <View style={styles.center}>
              <ActivityIndicator color={tokens.brand.accent} />
            </View>
          ) : historyError ? (
            // P9: error message is already rendered in the header. Don't
            // double up with the "Record your first fill-up" prompt — that
            // would tell the user two contradictory things at once.
            null
          ) : (
            <EmptyHistoryCard />
          )
        }
        ListFooterComponent={
          fillups.length > 0 && historyLoading ? (
            <View style={styles.footerLoader}>
              <ActivityIndicator color={tokens.brand.accent} />
            </View>
          ) : null
        }
      />
    </View>
  );
}

// ── ListHeader (vehicles section + selector + filter + summary) ────────────

interface ListHeaderProps {
  vehicles: Vehicle[] | null;
  vehiclesError: string | null;
  vehiclesLoading: boolean;
  scope: VehicleScope;
  onScopeChange: (scope: VehicleScope) => void;
  period: FillupPeriod;
  onPeriodChange: (period: FillupPeriod) => void;
  summary: FillupSummary | null;
  historyError: string | null;
}

function ListHeader({
  vehicles,
  vehiclesError,
  vehiclesLoading,
  scope,
  onScopeChange,
  period,
  onPeriodChange,
  summary,
  historyError,
}: ListHeaderProps) {
  const { t } = useTranslation();

  return (
    <View>
      {/* P10: initial-load spinner sits at the TOP of the header so the
          user sees activity rather than rendered-but-empty chrome while
          the first vehicle list resolves. */}
      {vehiclesLoading && !vehicles && (
        <View style={styles.center}>
          <ActivityIndicator color={tokens.brand.accent} />
        </View>
      )}

      {/* Vehicles section preserved from Story 5.1 — entry point for adding
          and inspecting cars. The history section below it is the new 5.5 surface. */}
      <Text style={styles.sectionTitle}>{t('log.vehiclesTitle')}</Text>
      <Text style={styles.sectionSubtitle}>{t('log.vehiclesSubtitle')}</Text>

      {vehiclesError && <Text style={styles.errorText}>{vehiclesError}</Text>}

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

      {/* History section — only render the controls + summary when the user
          actually has at least one vehicle. With zero vehicles there's
          definitionally no history to show. */}
      {vehicles && vehicles.length > 0 && (
        <>
          <View style={styles.divider} />
          <Text style={styles.sectionTitle}>{t('history.fillups')}</Text>

          {/* Vehicle chip row — horizontal scrollable. "All vehicles" chip
              first, then one chip per vehicle. We don't paginate this row;
              users with 50 vehicles are out of scope. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            <Chip
              label={t('history.vehicleSelectorAll')}
              active={scope === ALL_VEHICLES}
              onPress={() => onScopeChange(ALL_VEHICLES)}
            />
            {vehicles.map((v) => {
              const label = v.nickname?.trim() || `${v.make} ${v.model}`;
              return (
                <Chip
                  key={v.id}
                  label={label}
                  active={scope === v.id}
                  onPress={() => onScopeChange(v.id)}
                />
              );
            })}
          </ScrollView>

          {/* Period segmented control — fixed 4 options, full-width split. */}
          <View style={styles.segmentedControl}>
            {PERIOD_OPTIONS.map((p) => (
              <TouchableOpacity
                key={p}
                style={[styles.segment, period === p && styles.segmentActive]}
                onPress={() => onPeriodChange(p)}
                accessibilityRole="button"
                accessibilityState={{ selected: period === p }}
              >
                <Text
                  style={[
                    styles.segmentText,
                    period === p && styles.segmentTextActive,
                  ]}
                >
                  {t(PERIOD_I18N_KEY[p])}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {summary && <SummaryCards summary={summary} />}

          {/* Story 5.7: monthly-summary entry point. Visible only when the
              user is looking at the rolling 30-day window AND has positive
              savings — same gating principle as the Share button on the
              summary screen itself (never prompt sharing of a bad outcome,
              AC4). Routes to the savings-summary screen for the *current*
              calendar month — the rolling 30d window is a reasonable proxy. */}
          {period === '30d' && summary && summary.totalSavingsPln !== null && summary.totalSavingsPln > 0 && (
            <TouchableOpacity
              style={styles.monthlySummaryLink}
              onPress={() => {
                const now = new Date();
                router.push({
                  pathname: '/(app)/savings-summary',
                  params: { year: String(now.getFullYear()), month: String(now.getMonth() + 1) },
                });
              }}
              accessibilityRole="button"
            >
              <Text style={styles.monthlySummaryLinkText}>{t('history.viewMonthlySummary')}</Text>
            </TouchableOpacity>
          )}

          {/* Story 5.6: real-world consumption benchmark for the selected
              vehicle's make × model × engine variant. Only shown when a
              specific vehicle is selected (not 'all') — cross-vehicle
              benchmarks would mix engine variants and become meaningless.
              Renders nothing on null backend response (no qualifying data
              yet) per AC2. */}
          {scope !== ALL_VEHICLES && <BenchmarkSection vehicleId={scope} />}

          {historyError && <Text style={styles.errorText}>{historyError}</Text>}
        </>
      )}

    </View>
  );
}

// ── Chip ───────────────────────────────────────────────────────────────────

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.chip, active && styles.chipActive]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ── SummaryCards ───────────────────────────────────────────────────────────

function SummaryCards({ summary }: { summary: FillupSummary }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;

  // Per AC3 / AC6: cards with null values are omitted entirely, not rendered
  // with a placeholder. P3: numbers go through formatNumber so PL/UK users
  // see comma decimals. P8: hide the "Total saved" card when the sum is
  // exactly zero — same rule SavingsDisplay applies per-row (don't celebrate
  // zero; it confuses "broke even" with "no comparable data").
  return (
    <View style={styles.summaryGrid}>
      <SummaryCard label={t('history.totalSpend')} value={`${formatNumber(summary.totalSpendPln, locale, 2)} ${t('history.pln')}`} />
      <SummaryCard label={t('history.totalLitres')} value={`${formatNumber(summary.totalLitres, locale, 1)} ${t('history.litresUnit')}`} />
      {summary.avgPricePerLitrePln !== null && (
        <SummaryCard
          label={t('history.avgPrice')}
          value={`${formatNumber(summary.avgPricePerLitrePln, locale, 3)} ${t('history.plnPerL')}`}
        />
      )}
      {summary.totalSavingsPln !== null && summary.totalSavingsPln !== 0 && (
        <SummaryCard
          label={t('history.totalSaved')}
          value={`${summary.totalSavingsPln > 0 ? '+' : ''}${formatNumber(summary.totalSavingsPln, locale, 2)} ${t('history.pln')}`}
          highlight={summary.totalSavingsPln > 0 ? 'green' : 'amber'}
        />
      )}
      {summary.avgConsumptionL100km !== null && (
        <SummaryCard
          label={t('history.avgConsumption')}
          value={`${formatNumber(summary.avgConsumptionL100km, locale, 1)} ${t('history.consumptionUnit')}`}
          fullWidth
        />
      )}
    </View>
  );
}

interface SummaryCardProps {
  label: string;
  value: string;
  highlight?: 'green' | 'amber';
  fullWidth?: boolean;
}

function SummaryCard({ label, value, highlight, fullWidth }: SummaryCardProps) {
  return (
    <View style={[styles.summaryCard, fullWidth && styles.summaryCardFull]}>
      <Text
        style={[
          styles.summaryValue,
          highlight === 'green' && styles.summaryValueGreen,
          highlight === 'amber' && styles.summaryValueAmber,
        ]}
      >
        {value}
      </Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

// ── BenchmarkSection (Story 5.6) ───────────────────────────────────────────

// Minimum count below which we round to "10+ drivers" for privacy. Mirrors
// the spec's anonymisation principle (AC3): the threshold (10 drivers) is
// already the floor for showing a benchmark at all, so anything 10–19 is a
// small enough cohort that a precise count starts to feel identifying.
const BENCHMARK_PRIVACY_FLOOR = 20;

function BenchmarkSection({ vehicleId }: { vehicleId: string }) {
  const { t, i18n } = useTranslation();
  const { accessToken } = useAuth();
  // Tri-state: 'loading' (silent), null (omit per AC2), populated (render).
  // Distinguishing 'loading' from null prevents a flash of the section
  // when the network is fast — null is the final omit-state.
  const [benchmark, setBenchmark] = useState<ConsumptionBenchmarkDto | null | 'loading'>('loading');

  useEffect(() => {
    if (!accessToken) {
      setBenchmark(null);
      return;
    }
    setBenchmark('loading');
    let cancelled = false;
    apiGetVehicleBenchmark(accessToken, vehicleId)
      .then((result) => {
        if (cancelled) return;
        setBenchmark(result);
      })
      .catch((e) => {
        // eslint-disable-next-line no-console
        console.warn('apiGetVehicleBenchmark failed', e);
        // Network / auth failure → omit silently. The section is
        // supplementary; degrading to "no benchmark" is the right
        // failure mode (AC2 already says null = hide entirely).
        if (!cancelled) setBenchmark(null);
      });
    return () => {
      cancelled = true;
    };
  }, [vehicleId, accessToken]);

  // AC2: silent during load + null backend response → omit entirely.
  if (benchmark === 'loading' || benchmark === null) return null;

  const yourAvg = benchmark.yourAvgL100km !== null
    ? formatNumber(benchmark.yourAvgL100km, i18n.language, 1)
    : null;
  const communityAvg = formatNumber(benchmark.medianL100km, i18n.language, 1);

  const driverCountLabel = benchmark.driverCount < BENCHMARK_PRIVACY_FLOOR
    ? t('benchmark.driverCountMin')
    : t('benchmark.driverCountExact', { count: benchmark.driverCount });

  return (
    <View style={styles.benchmarkCard}>
      <Text style={styles.benchmarkTitle}>{t('benchmark.title')}</Text>
      <Text style={styles.benchmarkSubtitle}>{t('benchmark.subtitle')}</Text>
      <View style={styles.benchmarkRow}>
        {yourAvg !== null && (
          <View style={styles.benchmarkStat}>
            <Text style={styles.benchmarkValue}>{yourAvg}</Text>
            <Text style={styles.benchmarkUnit}>{t('benchmark.unit')}</Text>
            <Text style={styles.benchmarkStatLabel}>{t('benchmark.yours')}</Text>
          </View>
        )}
        <View style={styles.benchmarkStat}>
          <Text style={styles.benchmarkValue}>{communityAvg}</Text>
          <Text style={styles.benchmarkUnit}>{t('benchmark.unit')}</Text>
          <Text style={styles.benchmarkStatLabel}>{t('benchmark.community')}</Text>
        </View>
      </View>
      <Text style={styles.benchmarkFooter}>{driverCountLabel}</Text>
    </View>
  );
}

// ── FillUpCard ─────────────────────────────────────────────────────────────

interface FillUpCardProps {
  fillUp: FillupListItem;
  showVehicleLabel: boolean;
  locale: string;
}

function FillUpCard({ fillUp, showVehicleLabel, locale }: FillUpCardProps) {
  const { t } = useTranslation();
  const date = useMemo(() => {
    try {
      // Localised compact date: "5 May" / "5 maja" / "5 трав." — no year
      // unless the year would be ambiguous (different from current). Keeps
      // the row dense.
      const d = new Date(fillUp.filled_at);
      const sameYear = d.getFullYear() === new Date().getFullYear();
      return d.toLocaleDateString(locale, {
        day: 'numeric',
        month: 'short',
        ...(sameYear ? {} : { year: 'numeric' }),
      });
    } catch {
      return fillUp.filled_at.slice(0, 10);
    }
  }, [fillUp.filled_at, locale]);

  const savings = calculateSavings(
    fillUp.area_avg_at_fillup,
    fillUp.price_per_litre_pln,
    fillUp.litres,
  );

  const vehicleLabel = fillUp.vehicle.nickname?.trim()
    || `${fillUp.vehicle.make} ${fillUp.vehicle.model}`;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardDate}>{date}</Text>
        <View style={styles.fuelBadge}>
          <Text style={styles.fuelBadgeText}>
            {t(`vehicles.fuelTypes.${fillUp.fuel_type}`)}
          </Text>
        </View>
      </View>
      <Text style={styles.stationName}>
        {fillUp.station?.name ?? t('history.unknownStation')}
      </Text>
      {showVehicleLabel && <Text style={styles.vehicleLabel}>{vehicleLabel}</Text>}
      <View style={styles.cardRow}>
        <Text style={styles.litres}>
          {formatNumber(fillUp.litres, locale, 1)} {t('history.litresUnit')}
        </Text>
        <Text style={styles.cost}>
          {formatNumber(fillUp.total_cost_pln, locale, 2)} {t('history.pln')}
        </Text>
        <Text style={styles.pricePerL}>
          {formatNumber(fillUp.price_per_litre_pln, locale, 3)} {t('history.plnPerL')}
        </Text>
      </View>
      {fillUp.consumption_l_per_100km !== null && (
        <Text style={styles.consumption}>
          {formatNumber(fillUp.consumption_l_per_100km, locale, 1)} {t('history.consumptionUnit')}
        </Text>
      )}
      <SavingsDisplay savingsPln={savings} />
    </View>
  );
}

// ── EmptyHistoryCard ───────────────────────────────────────────────────────

function EmptyHistoryCard() {
  const { t } = useTranslation();
  return (
    <View style={styles.emptyHistoryCard}>
      <Text style={styles.emptyHistoryTitle}>{t('history.noFillups')}</Text>
      <TouchableOpacity
        style={styles.primaryButton}
        onPress={() => router.push('/(app)/fillup-capture')}
        accessibilityRole="button"
      >
        <Text style={styles.primaryButtonText}>{t('history.noFillupsAction')}</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: tokens.surface.page },
  listContent: {
    padding: 24,
    paddingBottom: 48,
  },
  center: {
    paddingVertical: 48,
    alignItems: 'center',
  },
  footerLoader: {
    paddingVertical: 24,
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
  divider: {
    height: 1,
    backgroundColor: tokens.neutral.n200,
    marginVertical: 24,
  },

  // Vehicle list (preserved from Story 5.1)
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

  // Vehicle chip row
  chipRow: {
    paddingVertical: 8,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: tokens.radius.full,
    borderWidth: 1,
    borderColor: tokens.neutral.n200,
    backgroundColor: tokens.surface.card,
  },
  chipActive: {
    borderColor: tokens.brand.accent,
    backgroundColor: '#fffbeb',
  },
  chipText: {
    fontSize: 13,
    color: tokens.neutral.n500,
    fontWeight: '500',
  },
  chipTextActive: {
    color: tokens.brand.accent,
    fontWeight: '700',
  },

  // Period segmented control
  segmentedControl: {
    flexDirection: 'row',
    marginTop: 12,
    marginBottom: 16,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.neutral.n200,
    backgroundColor: tokens.surface.card,
    overflow: 'hidden',
  },
  segment: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: tokens.surface.card,
  },
  segmentActive: {
    backgroundColor: tokens.brand.accent,
  },
  segmentText: {
    fontSize: 12,
    color: tokens.neutral.n500,
    fontWeight: '600',
  },
  segmentTextActive: {
    color: tokens.neutral.n0,
  },

  // Summary cards
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  summaryCard: {
    flexBasis: '48%',
    flexGrow: 1,
    padding: 16,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.neutral.n200,
    backgroundColor: tokens.surface.card,
  },
  summaryCardFull: {
    flexBasis: '100%',
  },
  summaryValue: {
    fontSize: 18,
    fontWeight: '700',
    color: tokens.brand.ink,
    marginBottom: 4,
  },
  summaryValueGreen: { color: tokens.fresh.recent },
  summaryValueAmber: { color: tokens.brand.accent },
  summaryLabel: {
    fontSize: 12,
    color: tokens.neutral.n500,
    fontWeight: '500',
  },

  // FillUp card
  card: {
    padding: 16,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.neutral.n200,
    backgroundColor: tokens.surface.card,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  cardDate: {
    fontSize: 13,
    color: tokens.neutral.n500,
    fontWeight: '500',
  },
  fuelBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: tokens.radius.sm,
    backgroundColor: tokens.neutral.n100,
  },
  fuelBadgeText: {
    fontSize: 11,
    color: tokens.brand.ink,
    fontWeight: '700',
  },
  stationName: {
    fontSize: 15,
    color: tokens.brand.ink,
    fontWeight: '600',
    marginBottom: 4,
  },
  vehicleLabel: {
    fontSize: 12,
    color: tokens.neutral.n500,
    marginBottom: 8,
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  litres: {
    fontSize: 14,
    color: tokens.neutral.n500,
  },
  cost: {
    fontSize: 14,
    color: tokens.brand.ink,
    fontWeight: '600',
  },
  pricePerL: {
    fontSize: 14,
    color: tokens.neutral.n500,
  },
  consumption: {
    marginTop: 6,
    fontSize: 13,
    color: tokens.neutral.n500,
  },

  // Empty history
  emptyHistoryCard: {
    padding: 24,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.neutral.n200,
    backgroundColor: tokens.surface.card,
    alignItems: 'center',
  },
  emptyHistoryTitle: {
    fontSize: 15,
    color: tokens.neutral.n500,
    marginBottom: 16,
    textAlign: 'center',
  },

  // Benchmark card (Story 5.6)
  benchmarkCard: {
    padding: 16,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.neutral.n200,
    backgroundColor: tokens.surface.card,
    marginBottom: 16,
  },
  benchmarkTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: tokens.brand.ink,
    marginBottom: 2,
  },
  // AC3: clearly labelled as community-sourced. The subtitle text is the
  // primary signal — keep it visible (not a tiny footnote).
  benchmarkSubtitle: {
    fontSize: 12,
    color: tokens.neutral.n500,
    marginBottom: 12,
  },
  benchmarkRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 8,
  },
  benchmarkStat: {
    alignItems: 'center',
    flex: 1,
  },
  benchmarkValue: {
    fontSize: 22,
    fontWeight: '700',
    color: tokens.brand.ink,
  },
  benchmarkUnit: {
    fontSize: 11,
    color: tokens.neutral.n500,
    marginTop: 2,
  },
  benchmarkStatLabel: {
    fontSize: 12,
    color: tokens.neutral.n500,
    marginTop: 6,
    fontWeight: '500',
  },
  benchmarkFooter: {
    fontSize: 11,
    color: tokens.neutral.n400,
    marginTop: 12,
    textAlign: 'center',
  },

  // Story 5.7: monthly-summary link (between summary cards + benchmark)
  monthlySummaryLink: {
    paddingVertical: 14,
    marginBottom: 16,
    alignItems: 'center',
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.brand.accent,
    backgroundColor: '#fffbeb',
  },
  monthlySummaryLinkText: {
    fontSize: 14,
    fontWeight: '600',
    color: tokens.brand.accent,
  },
});
