'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Locale, MarketSignalsTranslations } from '../../../lib/i18n';
import { fetchHistory, fetchSummary } from './actions';
import type { HistoryRow, SignalSummary, SignalType } from './types';

// Single source of truth for the history limit — referenced by both the
// fetchHistory call and the i18n title's {{count}} interpolation.
const HISTORY_LIMIT = 30;

// Locale → BCP-47 tag map. Switching to a typed map (vs nested ternaries)
// means a future Locale union widening fails at this call site rather
// than silently falling through to en-GB.
const LOCALE_TAG: Record<Locale, string> = {
  pl: 'pl-PL',
  en: 'en-GB',
  uk: 'uk-UA',
};

interface Props {
  t: MarketSignalsTranslations;
  locale: Locale;
  initialSummary: SignalSummary[] | null;
  initialError: string | null;
}

// Per signal-type expected interval (ms). ORLEN cron fires twice daily;
// Brent's underlying Alpha Vantage feed publishes ONCE per day so the
// service de-dups same-day re-runs — Brent's freshness floor is therefore
// ~24h, not the 12h of the cron cadence.
const EXPECTED_INTERVAL_MS: Record<SignalType, number> = {
  orlen_rack_pb95: 12 * 3_600_000,
  orlen_rack_on: 12 * 3_600_000,
  orlen_rack_lpg: 12 * 3_600_000,
  brent_crude_pln: 24 * 3_600_000,
};

const REFRESH_INTERVAL_MS = 60_000;

type Freshness = 'fresh' | 'watch' | 'stale' | 'none';

function freshnessFor(signal: SignalSummary, now: number): Freshness {
  if (!signal.recordedAt) return 'none';
  const recorded = new Date(signal.recordedAt).getTime();
  if (Number.isNaN(recorded)) return 'none';
  const age = now - recorded;
  const expected = EXPECTED_INTERVAL_MS[signal.signalType];
  if (age <= expected * 1.5) return 'fresh';
  if (age <= expected * 3) return 'watch';
  return 'stale';
}

function formatRelative(
  iso: string | null,
  locale: Locale,
  t: MarketSignalsTranslations,
  now: number,
): string {
  if (!iso) return t.never;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return t.never;
  // Anchor on the caller-provided `now` so all timestamps in one card
  // share a snapshot — avoids the "1m ago badge / 2m ago line" drift
  // that arises from re-reading Date.now() inside the formatter.
  const diffMs = now - date.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return t.justNow;
  if (minutes < 60) return t.minutesAgo.replace('{{count}}', String(minutes));
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t.hoursAgo.replace('{{count}}', String(hours));
  // Older than a day → absolute datetime in the user's locale.
  return date.toLocaleString(LOCALE_TAG[locale]);
}

function formatPctChange(pct: number | null): string {
  if (pct == null) return '—';
  const pct100 = pct * 100;
  const sign = pct100 > 0 ? '+' : '';
  return `${sign}${pct100.toFixed(2)}%`;
}

function pctChangeColor(pct: number | null): string {
  // Inverted from typical green-up/red-down financial UX: for fuel-price
  // context, RISING is BAD news for the driver.
  if (pct == null) return 'text-gray-500';
  if (pct > 0) return 'text-red-600';
  if (pct < 0) return 'text-green-600';
  return 'text-gray-500';
}

const FRESHNESS_STYLES: Record<Freshness, { bg: string; border: string; text: string }> = {
  fresh: { bg: 'bg-green-50', border: 'border-green-300', text: 'text-green-700' },
  watch: { bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-700' },
  stale: { bg: 'bg-red-50', border: 'border-red-300', text: 'text-red-700' },
  none: { bg: 'bg-gray-50', border: 'border-gray-300', text: 'text-gray-600' },
};

function signalLabel(signalType: SignalType, t: MarketSignalsTranslations): string {
  switch (signalType) {
    case 'orlen_rack_pb95':
      return t.signalOrlenPb95;
    case 'orlen_rack_on':
      return t.signalOrlenOn;
    case 'orlen_rack_lpg':
      return t.signalOrlenLpg;
    case 'brent_crude_pln':
      return t.signalBrentCrude;
  }
}

export function MarketSignalsDashboard({ t, locale, initialSummary, initialError }: Props) {
  const [summary, setSummary] = useState<SignalSummary[] | null>(initialSummary);
  const [errorBanner, setErrorBanner] = useState<string | null>(initialError);
  const [historyOpen, setHistoryOpen] = useState<SignalType | null>(null);
  const [historyData, setHistoryData] = useState<HistoryRow[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  // Re-render every 60s so freshness pills + relative-time strings tick
  // forward even when the polled summary returns the same data.
  const [now, setNow] = useState(() => Date.now());

  // Race-guard for history fetch — rapid card clicks could otherwise let
  // an earlier signal's response overwrite a later signal's loading state.
  const historyRequestRef = useRef(0);

  // 60s polling — pauses when the tab is hidden so a background admin
  // tab doesn't keep hammering the API. Browsers throttle but don't stop
  // setInterval, and the API hit (DB query + Redis read) is the cost,
  // not the timer.
  useEffect(() => {
    const id = setInterval(async () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      setNow(Date.now());
      const result = await fetchSummary();
      if (result.data) {
        setSummary(result.data.signals);
        // Clear any earlier transient error once a poll succeeds.
        setErrorBanner(null);
      } else if (result.error) {
        setErrorBanner(result.error);
      }
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const handleToggleHistory = useCallback(
    async (signalType: SignalType) => {
      if (historyOpen === signalType) {
        setHistoryOpen(null);
        setHistoryData(null);
        return;
      }
      // Bump the request counter; only the LAST request's result is
      // allowed to land. Closes the rapid-click race.
      const requestId = ++historyRequestRef.current;
      setHistoryOpen(signalType);
      setHistoryData(null);
      setHistoryLoading(true);
      const result = await fetchHistory(signalType, HISTORY_LIMIT);
      // Discard if a newer click has superseded this one.
      if (historyRequestRef.current !== requestId) return;
      // Set data BEFORE clearing the loading flag so the render between
      // the two state updates can't flash the "no data" branch.
      if (result.data) setHistoryData(result.data.rows);
      else if (result.error) setErrorBanner(result.error);
      setHistoryLoading(false);
    },
    [historyOpen],
  );

  return (
    <div className="space-y-4">
      {errorBanner && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {errorBanner}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {(summary ?? []).map((signal) => {
          const freshness = freshnessFor(signal, now);
          const styles = FRESHNESS_STYLES[freshness];
          const isOpen = historyOpen === signal.signalType;
          const isMissing = signal.value === null;
          const isBrent = signal.signalType === 'brent_crude_pln';

          return (
            <div
              key={signal.signalType}
              className={`rounded-lg border ${styles.border} ${styles.bg} p-5 shadow-sm`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-gray-900">
                    {signalLabel(signal.signalType, t)}
                  </h3>
                  <p className="mt-2 text-2xl font-bold tabular-nums text-gray-900">
                    {signal.value !== null ? signal.value.toFixed(4) : '—'}
                    {signal.value !== null && (
                      <span className="ml-1 text-sm font-normal text-gray-500">PLN/l</span>
                    )}
                  </p>
                  <p className={`mt-1 text-sm tabular-nums ${pctChangeColor(signal.pctChange)}`}>
                    {formatPctChange(signal.pctChange)}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${styles.text} ${styles.bg} border ${styles.border}`}
                  >
                    {freshness === 'fresh'
                      ? t.fresh
                      : freshness === 'watch'
                        ? t.watch
                        : freshness === 'stale'
                          ? t.stale
                          : isBrent
                            ? t.notConfigured
                            : t.noData}
                  </span>
                  {/* Defence-in-depth: gate the cached badge on freshness too,
                      so an inconsistently-written row can't show both
                      "Not configured" and "cached" badges at once. */}
                  {isBrent && signal.rateSource === 'cached' && freshness !== 'none' && (
                    <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700">
                      {t.sourceCached}
                    </span>
                  )}
                </div>
              </div>

              {/* AC5 — Brent never-ingested explanatory hint, surfaced as
                  body copy rather than crammed into the small status pill. */}
              {isBrent && isMissing && (
                <p className="mt-3 text-xs text-gray-600">{t.notConfiguredHint}</p>
              )}

              <p className="mt-3 text-xs text-gray-500">
                <span className="font-medium">{t.lastIngested}:</span>{' '}
                {formatRelative(signal.recordedAt, locale, t, now)}
              </p>

              {!isMissing && (
                <button
                  type="button"
                  onClick={() => void handleToggleHistory(signal.signalType)}
                  className="mt-3 text-xs font-medium text-blue-600 hover:text-blue-700"
                >
                  {isOpen ? '−' : '+'} {t.historyTitle.replace('{{count}}', String(HISTORY_LIMIT))}
                </button>
              )}

              {isOpen && (
                <div className="mt-3 overflow-x-auto">
                  {historyLoading ? (
                    <p className="py-2 text-xs text-gray-500">…</p>
                  ) : historyData && historyData.length > 0 ? (
                    <table className="min-w-full divide-y divide-gray-200 text-xs">
                      <thead>
                        <tr className="text-left text-gray-500">
                          <th className="py-1 pr-3 font-medium">{t.historyTime}</th>
                          <th className="py-1 pr-3 text-right font-medium">{t.historyValue}</th>
                          <th className="py-1 pr-3 text-right font-medium">{t.pctChangeLabel}</th>
                          {isBrent && (
                            <th className="py-1 pr-3 font-medium">{t.historySource}</th>
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {historyData.map((row) => (
                          <tr key={row.recordedAt} className="text-gray-700">
                            <td className="py-1 pr-3 tabular-nums">
                              {formatRelative(row.recordedAt, locale, t, now)}
                            </td>
                            <td className="py-1 pr-3 text-right tabular-nums">{row.value.toFixed(4)}</td>
                            <td className={`py-1 pr-3 text-right tabular-nums ${pctChangeColor(row.pctChange)}`}>
                              {formatPctChange(row.pctChange)}
                              {row.significantMovement && (
                                <span className="ml-1 inline-flex items-center rounded-full bg-orange-100 px-1.5 py-0.5 text-[9px] font-medium uppercase text-orange-700">
                                  {t.significantBadge}
                                </span>
                              )}
                            </td>
                            {isBrent && (
                              <td className="py-1 pr-3 text-[10px] uppercase tracking-wide text-gray-500">
                                {row.rateSource === 'cached'
                                  ? t.sourceCached
                                  : row.rateSource === 'live'
                                    ? t.sourceLive
                                    : '—'}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="py-2 text-xs text-gray-500">{t.noData}</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
