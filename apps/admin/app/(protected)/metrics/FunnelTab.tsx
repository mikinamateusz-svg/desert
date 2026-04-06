'use client';

import { useState, useTransition, useEffect } from 'react';
import { fetchFunnelMetrics, fetchFunnelDrilldown } from './actions';
import type { FunnelMetricsDto, FunnelDrilldownDto } from './types';
import type { MetricsTranslations } from '../../../lib/i18n';

type Period = 'today' | '7d' | '30d';

interface Props {
  t: MetricsTranslations;
}

function FunnelRow({ label, count, pct }: { label: string; count: number; pct: number }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-700">{label}</span>
      <span className="text-sm font-semibold text-gray-900">
        {count.toLocaleString()} <span className="font-normal text-gray-400">({pct}%)</span>
      </span>
    </div>
  );
}

function Drilldown({
  reason,
  period,
  t,
  onBack,
}: {
  reason: string;
  period: Period;
  t: MetricsTranslations;
  onBack: () => void;
}) {
  const tf = t.funnel;
  const [data, setData] = useState<FunnelDrilldownDto | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function load(p: number) {
    startTransition(async () => {
      const result = await fetchFunnelDrilldown(reason, period, p);
      if (result.error) setError(result.error);
      else { setData(result.data ?? null); setError(null); }
    });
  }

  useEffect(() => { load(1); }, [reason, period]); // eslint-disable-line react-hooks/exhaustive-deps

  const label = t.flagReasons[reason] ?? reason;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-sm text-blue-600 underline">{tf.backToFunnel}</button>
        <h2 className="text-lg font-semibold text-gray-900">{tf.drilldownTitle}{label}</h2>
      </div>

      {error && <p className="text-sm text-red-600">{t.errorGeneric}</p>}
      {!data && !error && <p className="text-sm text-gray-400">…</p>}

      {data && (
        <>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                <th className="pb-2 pr-4">{tf.columnId}</th>
                <th className="pb-2 pr-4">{tf.columnStation}</th>
                <th className="pb-2 pr-4">{tf.columnDate}</th>
                <th className="pb-2">{tf.columnReason}</th>
              </tr>
            </thead>
            <tbody>
              {data.data.length === 0 && (
                <tr><td colSpan={4} className="py-4 text-center text-gray-400">{tf.noSubmissions}</td></tr>
              )}
              {data.data.map(row => (
                <tr key={row.id} className="border-b border-gray-100">
                  <td className="py-1.5 pr-4 font-mono text-xs text-gray-500">{row.id.slice(0, 8)}…</td>
                  <td className="py-1.5 pr-4 text-gray-700">{row.stationName ?? '—'}</td>
                  <td className="py-1.5 pr-4 text-gray-600">{new Date(row.createdAt).toLocaleDateString()}</td>
                  <td className="py-1.5 text-gray-700">{t.flagReasons[row.flagReason ?? ''] ?? row.flagReason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {data.total > data.limit && (
            <div className="flex gap-2">
              <button
                onClick={() => { const p = page - 1; setPage(p); load(p); }}
                disabled={page === 1 || isPending}
                className="px-3 py-1 text-sm border border-gray-300 rounded disabled:opacity-40"
              >
                ←
              </button>
              <span className="text-sm text-gray-500 self-center">
                {page} / {Math.ceil(data.total / data.limit)}
              </span>
              <button
                onClick={() => { const p = page + 1; setPage(p); load(p); }}
                disabled={page >= Math.ceil(data.total / data.limit) || isPending}
                className="px-3 py-1 text-sm border border-gray-300 rounded disabled:opacity-40"
              >
                →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function FunnelTab({ t }: Props) {
  const tf = t.funnel;
  const [period, setPeriod] = useState<Period>('today');
  const [data, setData] = useState<FunnelMetricsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drilldownReason, setDrilldownReason] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function load(p: Period) {
    startTransition(async () => {
      const result = await fetchFunnelMetrics(p);
      if (result.error) setError(result.error);
      else { setData(result.data ?? null); setError(null); }
    });
  }

  useEffect(() => { load(period); }, [period]); // eslint-disable-line react-hooks/exhaustive-deps

  if (drilldownReason) {
    return (
      <Drilldown
        reason={drilldownReason}
        period={period}
        t={t}
        onBack={() => setDrilldownReason(null)}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold text-gray-900">{t.tabs.funnel}</h2>
        <div className="flex gap-1">
          {(['today', '7d', '30d'] as Period[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              disabled={isPending}
              className={`px-3 py-1 text-xs rounded ${period === p ? 'bg-gray-900 text-white' : 'border border-gray-300 text-gray-700'}`}
            >
              {t.period[p]}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{t.errorGeneric}</p>}
      {!data && !error && <p className="text-sm text-gray-400">…</p>}

      {data && (
        <>
          <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
            <FunnelRow label={tf.total}         count={data.totalSubmissions} pct={100} />
            <FunnelRow label={tf.verified}       count={data.verified}         pct={data.verifiedPct} />
            <FunnelRow label={tf.rejected}       count={data.rejected}         pct={data.rejectedPct} />
            <FunnelRow label={tf.shadowRejected} count={data.shadowRejected}   pct={data.shadowRejectedPct} />
            <FunnelRow
              label={tf.pending}
              count={data.pending}
              pct={data.totalSubmissions > 0 ? Math.round((data.pending / data.totalSubmissions) * 1000) / 10 : 0}
            />
            <div className="flex items-center justify-between py-2 px-0">
              <span className="text-sm text-gray-700">{tf.dlq}</span>
              <span className="text-sm font-semibold text-gray-900">{data.dlqCount}</span>
            </div>
          </div>

          {data.rejectionBreakdown.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-2">{tf.rejectionBreakdown}</h3>
              <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
                {data.rejectionBreakdown.map(row => (
                  <button
                    key={row.reason}
                    onClick={() => setDrilldownReason(row.reason)}
                    className="w-full flex items-center justify-between px-4 py-2 text-left hover:bg-gray-50"
                  >
                    <span className="text-sm text-gray-700">{t.flagReasons[row.reason] ?? row.reason}</span>
                    <span className="text-sm font-semibold text-gray-900 underline decoration-dotted">{row.count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
