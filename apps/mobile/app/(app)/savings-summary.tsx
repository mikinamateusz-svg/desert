import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import ViewShot from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { tokens } from '../../src/theme';
import { useAuth } from '../../src/store/auth.store';
import { apiGetMonthlySummary, type MonthlySummaryDto } from '../../src/api/fillups';
import { ShareableCard } from '../../src/components/ShareableCard';
import { flags } from '../../src/config/flags';

// Phase 2 gate at the entry point — keeps the inner component (with hooks)
// out of production builds. Pattern matches the rest of Phase 2 screens.
export default function SavingsSummaryScreen() {
  if (!flags.phase2) return <Redirect href="/(app)" />;
  return <SavingsSummaryContent />;
}

function SavingsSummaryContent() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const { accessToken } = useAuth();

  const params = useLocalSearchParams<{ year?: string; month?: string }>();
  // Defaults to the current month if the route lands without params (e.g.
  // direct navigation rather than via the log link or notification deep
  // link from Story 6.5). Garbage params (`?year=foo`, `?year=1e9` —
  // parseInt's silent truncation hits both NaN and out-of-range cases)
  // also fall back to current month — better than 400-ing on a malformed
  // shared URL.
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const year = parseRouteInt(params.year, currentYear, 2000, currentYear + 1);
  const month = parseRouteInt(params.month, currentMonth, 1, 12);

  const [summary, setSummary] = useState<MonthlySummaryDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Capture-in-flight latch — disables the Share button during the
  // capture+share roundtrip. Without this, a double-tap fires two
  // capture/share cycles and the second's temp file may collide with
  // the first.
  const [isCapturing, setIsCapturing] = useState(false);
  // P5: surfaced share failure (capture returned undefined, sharing
  // unavailable on device, or shareAsync threw). Cleared on every fresh
  // share attempt.
  const [shareError, setShareError] = useState<string | null>(null);
  const cardRef = useRef<ViewShot>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  // Loader is a stable callback so the retry button and the effect
  // share one code path. `t` lives in closure for the catch handler —
  // including it in the effect's dep array would refetch on every
  // language change.
  const loadSummary = useCallback(() => {
    if (!accessToken) {
      // P6: cold-start of a logged-out user via Story 6.5 deep link
      // would otherwise be stuck on the spinner forever — clear loading
      // and let the auth-required branch render.
      setLoading(false);
      setSummary(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    apiGetMonthlySummary(accessToken, year, month)
      .then((res) => {
        if (cancelledRef.current) return;
        setSummary(res);
      })
      .catch((e) => {
        // eslint-disable-next-line no-console
        console.warn('apiGetMonthlySummary failed', e);
        if (!cancelledRef.current) setError(t('savingsSummary.loadError'));
      })
      .finally(() => {
        if (!cancelledRef.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, year, month]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  // Build a localised month label like "March 2026" / "marzec 2026" /
  // "березень 2026". Day=15 picks something well inside the month so
  // toLocaleDateString never lands on an edge case (Feb 29 etc.).
  const monthLabel = formatMonthLabel(year, month, i18n.language);

  const handleShare = useCallback(async () => {
    if (isCapturing) return;
    if (!summary || summary.totalSavingsPln === null || summary.totalSavingsPln <= 0) return;
    setShareError(null);
    setIsCapturing(true);
    try {
      // P5: check sharing availability FIRST. expo-sharing returns
      // false on devices without a share sheet (older Android Go,
      // some Huawei builds without GMS) — skipping the capture step
      // saves disk + leaves the user with a clearer "share unavailable"
      // hint than a silent no-op.
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        if (!cancelledRef.current) setShareError(t('savingsSummary.shareUnavailable'));
        return;
      }
      // ViewShot ref might still be null if the user tapped the button
      // on the same paint as the conditional <ViewShot> mounted. Surface
      // the failure rather than swallowing it.
      const captureFn = cardRef.current?.capture;
      if (!captureFn) {
        if (!cancelledRef.current) setShareError(t('savingsSummary.shareCaptureFailed'));
        return;
      }
      // ViewShot.capture returns a temp-file URI. The file lives in the
      // app's cache dir until the OS reaps it — we don't clean up
      // explicitly because the cache cycle handles it and an
      // immediately-deleted file would race the share sheet's open
      // handle on some Android variants.
      const uri = await captureFn();
      if (!uri || cancelledRef.current) {
        if (!uri && !cancelledRef.current) {
          setShareError(t('savingsSummary.shareCaptureFailed'));
        }
        return;
      }
      await Sharing.shareAsync(uri, {
        mimeType: 'image/png',
        dialogTitle: t('savingsSummary.shareDialogTitle'),
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('handleShare failed', e);
      if (!cancelledRef.current) setShareError(t('savingsSummary.shareCaptureFailed'));
    } finally {
      if (!cancelledRef.current) setIsCapturing(false);
    }
  }, [isCapturing, summary, t]);

  // ── Render: loading / error / no-data ────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.fullscreen, { paddingTop: insets.top }]}>
        <Header title={t('savingsSummary.title')} onBack={() => router.back()} />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={tokens.brand.accent} />
        </View>
      </View>
    );
  }

  // P6: logged-out user landed via deep link (Story 6.5 push notification).
  // Loading state already cleared in loadSummary; show a clear sign-in
  // prompt rather than an infinite spinner or generic error.
  if (!accessToken) {
    return (
      <View style={[styles.fullscreen, { paddingTop: insets.top }]}>
        <Header title={t('savingsSummary.title')} onBack={() => router.back()} />
        <View style={styles.center}>
          <Text style={styles.noDataTitle}>{t('savingsSummary.signInRequired')}</Text>
          <TouchableOpacity
            style={[styles.shareButton, { marginTop: 16 }]}
            onPress={() => router.replace('/(auth)/login')}
            accessibilityRole="button"
          >
            <Text style={styles.shareButtonText}>{t('savingsSummary.signIn')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (error || !summary) {
    return (
      <View style={[styles.fullscreen, { paddingTop: insets.top }]}>
        <Header title={t('savingsSummary.title')} onBack={() => router.back()} />
        <View style={styles.center}>
          <Text style={styles.errorText}>{error ?? t('savingsSummary.loadError')}</Text>
          {/* P10: explicit retry — without this the user has to back
              out + re-enter to recover from a transient network error. */}
          <TouchableOpacity
            style={[styles.shareButton, { marginTop: 16 }]}
            onPress={() => loadSummary()}
            accessibilityRole="button"
          >
            <Text style={styles.shareButtonText}>{t('savingsSummary.retry')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // AC4: never share negative or zero outcomes. Both server null
  // (no comparable data) and ≤ 0 (broke even / above average) hide the
  // Share button + show a contextual hint instead.
  const showShareButton = summary.totalSavingsPln !== null && summary.totalSavingsPln > 0;

  // Locale-aware monetary formatting for the on-screen stats. P2:
  // Hermes Android with limited ICU silently emits ASCII (`.` decimal)
  // even for pl/uk — patch the separator manually so PL/UK users see
  // the correct format. Same logic as ShareableCard.formatAmountForLocale.
  const formatNum = (value: number, frac: number) => {
    let formatted: string;
    try {
      formatted = value.toLocaleString(i18n.language, {
        minimumFractionDigits: frac,
        maximumFractionDigits: frac,
      });
    } catch {
      formatted = value.toFixed(frac);
    }
    const primary = i18n.language.toLowerCase().split('-')[0];
    if ((primary === 'pl' || primary === 'uk') && formatted.includes('.')) {
      formatted = formatted.replace('.', ',');
    }
    return formatted;
  };

  return (
    <View style={[styles.fullscreen, { paddingTop: insets.top }]}>
      <Header title={t('savingsSummary.title')} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.monthHeading}>{monthLabel}</Text>

        {showShareButton ? (
          <>
            {/* On-screen stats */}
            <View style={styles.statsBlock}>
              <Text style={styles.savedAmount}>
                {t('savingsSummary.savedAmount', {
                  amount: formatNum(summary.totalSavingsPln!, 2),
                })}
              </Text>
              <Text style={styles.fillupCountLine}>
                {t('savingsSummary.fillupCount', { count: summary.fillupCount })}
              </Text>
              <Text style={styles.statSubline}>
                {t('savingsSummary.spendLine', { amount: formatNum(summary.totalSpendPln, 2) })}
              </Text>
              <Text style={styles.statSubline}>
                {t('savingsSummary.litresLine', { amount: formatNum(summary.totalLitres, 1) })}
              </Text>
            </View>

            {/* Card preview wrapped in ViewShot for capture. format=png +
                quality=1 + result=tmpfile + 2x pixelRatio give a 640px
                PNG suitable for social sharing without inflating files. */}
            <View style={styles.cardWrap}>
              <ViewShot
                ref={cardRef}
                // width/height force the captured PNG to 640×640 regardless
                // of the device's native pixel ratio — keeps the output
                // size consistent across 1x/2x/3x devices for upload.
                // (`pixelRatio` doesn't exist on this version of
                // react-native-view-shot's CaptureOptions type, despite
                // common docs claiming otherwise.)
                options={{ format: 'png', quality: 1, result: 'tmpfile', width: 640, height: 640 }}
              >
                <ShareableCard
                  monthLabel={monthLabel}
                  totalSavingsPln={summary.totalSavingsPln!}
                  fillupCount={summary.fillupCount}
                  rankingPercentile={summary.rankingPercentile}
                  rankingVoivodeship={summary.rankingVoivodeship}
                  locale={i18n.language}
                />
              </ViewShot>
            </View>

            <TouchableOpacity
              style={[styles.shareButton, isCapturing && styles.shareButtonDisabled]}
              onPress={() => void handleShare()}
              disabled={isCapturing}
              accessibilityRole="button"
            >
              <Text style={styles.shareButtonText}>
                {isCapturing ? t('savingsSummary.sharing') : t('savingsSummary.shareButton')}
              </Text>
            </TouchableOpacity>

            {/* P5: surface capture/share failures inline instead of
                silently swallowing — without this the user taps Share,
                button re-enables, no share sheet, no diagnostic. */}
            {shareError && <Text style={styles.shareErrorText}>{shareError}</Text>}
          </>
        ) : (
          // No positive savings → no Share button, show empty-state copy.
          // Distinguishes null (no comparable data) from ≤ 0 (broke even)
          // is handled by the spec: the Share button hides for both, the
          // empty-state copy is the same — the user doesn't need to
          // distinguish from the screen.
          <View style={styles.noDataBlock}>
            <Text style={styles.noDataTitle}>{t('savingsSummary.noSavings')}</Text>
            <Text style={styles.noDataHint}>{t('savingsSummary.noSavingsHint')}</Text>

            {/* Even without savings we show the basic activity for the month
                so the page isn't blank — the user opened it expecting data. */}
            {summary.fillupCount > 0 && (
              <View style={styles.statsBlock}>
                <Text style={styles.fillupCountLine}>
                  {t('savingsSummary.fillupCount', { count: summary.fillupCount })}
                </Text>
                <Text style={styles.statSubline}>
                  {t('savingsSummary.spendLine', { amount: formatNum(summary.totalSpendPln, 2) })}
                </Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatMonthLabel(year: number, month: number, locale: string): string {
  // Day=15 sidesteps any DST / leap-day edge case on month boundaries
  // (Feb 29 doesn't exist every year, but Feb 15 always does).
  const date = new Date(year, month - 1, 15);
  try {
    return date.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  } catch {
    return `${month}/${year}`;
  }
}

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.header}>
      <TouchableOpacity
        onPress={onBack}
        accessibilityRole="button"
        // P9: a11y label was 'common.close' but the visible label is "Back".
        // Mismatched announcements confuse screen-reader users.
        accessibilityLabel={t('savingsSummary.back')}
      >
        <Text style={styles.headerBack}>{'‹  '}{t('savingsSummary.back')}</Text>
      </TouchableOpacity>
      <Text style={styles.headerTitle}>{title}</Text>
      <View style={styles.headerSpacer} />
    </View>
  );
}

/**
 * Parse a route param to a clamped int; fall back to `defaultValue` on
 * any failure (NaN from non-numeric, out-of-range, missing). Catches the
 * scrubbed-deep-link cases (e.g. `?year=foo` → NaN, `?year=1e9` →
 * silently truncated to 1 by parseInt) before they hit the API.
 */
function parseRouteInt(raw: string | undefined, defaultValue: number, min: number, max: number): number {
  if (!raw) return defaultValue;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return defaultValue;
  return parsed;
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  fullscreen: { flex: 1, backgroundColor: tokens.surface.page },
  scroll: { padding: 24, paddingBottom: 48 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  errorText: { fontSize: 14, color: tokens.price.expensive, textAlign: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.neutral.n200,
    backgroundColor: tokens.surface.card,
  },
  headerBack: { fontSize: 14, color: tokens.brand.accent, fontWeight: '500', minWidth: 60 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: tokens.brand.ink, flex: 1, textAlign: 'center' },
  headerSpacer: { width: 60 },

  monthHeading: {
    fontSize: 24,
    fontWeight: '700',
    color: tokens.brand.ink,
    marginBottom: 24,
    textAlign: 'center',
  },

  statsBlock: { marginBottom: 24, alignItems: 'center' },
  savedAmount: {
    fontSize: 28,
    fontWeight: '700',
    color: tokens.fresh.recent,
    marginBottom: 8,
    textAlign: 'center',
  },
  fillupCountLine: {
    fontSize: 16,
    fontWeight: '600',
    color: tokens.brand.ink,
    marginBottom: 4,
  },
  statSubline: { fontSize: 13, color: tokens.neutral.n500, marginTop: 2 },

  cardWrap: { alignItems: 'center', marginBottom: 24 },

  shareButton: {
    paddingVertical: 16,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.brand.accent,
    alignItems: 'center',
  },
  shareButtonDisabled: { opacity: 0.6 },
  shareButtonText: { fontSize: 16, fontWeight: '700', color: tokens.neutral.n0 },
  shareErrorText: {
    fontSize: 13,
    color: tokens.price.expensive,
    marginTop: 12,
    textAlign: 'center',
  },

  noDataBlock: { alignItems: 'center', paddingVertical: 24 },
  noDataTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: tokens.brand.ink,
    textAlign: 'center',
    marginBottom: 8,
  },
  noDataHint: {
    fontSize: 13,
    color: tokens.neutral.n500,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 16,
  },
});
