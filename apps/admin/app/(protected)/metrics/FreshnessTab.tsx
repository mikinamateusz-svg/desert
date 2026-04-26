'use client';

import { useEffect, useState, useTransition } from 'react';
import { fetchFreshnessData } from './actions';
import type {
  FreshnessDashboardDto,
  FreshnessRowDto,
  FreshnessSortBy,
  FreshnessSortOrder,
} from './types';
import type { MetricsTranslations } from '../../../lib/i18n';

interface Props {
  t: MetricsTranslations;
}

const VOIVODESHIPS = [
  'dolnoslaskie',
  'kujawsko-pomorskie',
  'lubelskie',
  'lubuskie',
  'lodzkie',
  'malopolskie',
  'mazowieckie',
  'opolskie',
  'podkarpackie',
  'podlaskie',
  'pomorskie',
  'slaskie',
  'swietokrzyskie',
  'warminsko-mazurskie',
  'wielkopolskie',
  'zachodniopomorskie',
];

const PAGE_SIZE = 50;

function formatDateTime(iso: string | null, neverLabel: string): string {
  if (!iso) return neverLabel;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return neverLabel;
  return d.toLocaleString();
}

export function FreshnessTab({ t }: Props) {
  const tf = t.freshness;
  const [data, setData] = useState<FreshnessDashboardDto | null>(null);
  const [voivodeship, setVoivodeship] = useState<string | ''>('');
  const [sortBy, setSortBy] = useState<FreshnessSortBy>('lastPriceAt');
  const [order, setOrder] = useState<FreshnessSortOrder>('asc');
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let alive = true;
    startTransition(async () => {
      const result = await fetchFreshnessData({
        voivodeship: voivodeship || null,
        sortBy,
        order,
        page,
        limit: PAGE_SIZE,
      });
      if (!alive) return;
      if ('error' in result) setError(result.error ?? t.errorGeneric);
      else { setData(result.data ?? null); setError(null); }
    });
    return () => { alive = false; };
  }, [voivodeship, sortBy, order, page, t.errorGeneric]);

  // Reset to page 1 whenever the filter / sort changes (otherwise we'd ask for, e.g., page 5
  // of a much smaller filtered set and show "no results" by accident).
  function onVoivodeshipChange(v: string) {
    setVoivodeship(v);
    setPage(1);
  }
  function onSortChange(s: FreshnessSortBy) {
    setSortBy(s);
    setPage(1);
  }
  function onOrderToggle() {
    setOrder(prev => (prev === 'asc' ? 'desc' : 'asc'));
    setPage(1);
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold text-gray-900">{t.tabs.freshness}</h2>
        {isPending && <span className="text-xs text-gray-400">…</span>}
        {data && (
          <span className="ml-auto text-xs text-gray-500">
            {tf.staleCount}: <span className="font-semibold text-red-600">{data.staleCount}</span>
            {' / '}
            {data.total}
          </span>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4">
        <label className="flex flex-col text-xs text-gray-500">
          {tf.colVoivodeship}
          <select
            value={voivodeship}
            onChange={e => onVoivodeshipChange(e.target.value)}
            className="mt-1 rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900"
          >
            <option value="">{tf.allRegions}</option>
            {VOIVODESHIPS.map(v => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col text-xs text-gray-500">
          {tf.sortBy}
          <select
            value={sortBy}
            onChange={e => onSortChange(e.target.value as FreshnessSortBy)}
            className="mt-1 rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900"
          >
            <option value="lastPriceAt">{tf.colLastUpdated}</option>
            <option value="voivodeship">{tf.colVoivodeship}</option>
            <option value="priceSource">{tf.colSource}</option>
          </select>
        </label>

        <button
          type="button"
          onClick={onOrderToggle}
          className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
        >
          {order === 'asc' ? '↑ asc' : '↓ desc'}
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2 text-left">{tf.colName}</th>
              <th className="px-3 py-2 text-left">{tf.colAddress}</th>
              <th className="px-3 py-2 text-left">{tf.colVoivodeship}</th>
              <th className="px-3 py-2 text-left">{tf.colSource}</th>
              <th className="px-3 py-2 text-left">{tf.colLastUpdated}</th>
              <th className="px-3 py-2 text-left">{tf.colStatus}</th>
            </tr>
          </thead>
          <tbody>
            {data?.data.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-gray-400">{tf.noResults}</td>
              </tr>
            )}
            {data?.data.map((row: FreshnessRowDto) => (
              <tr
                key={row.stationId}
                className={row.isStale ? 'border-t border-gray-100 bg-red-50' : 'border-t border-gray-100'}
              >
                <td className="px-3 py-2 font-medium text-gray-900">{row.stationName}</td>
                <td className="px-3 py-2 text-gray-600">{row.address ?? '—'}</td>
                <td className="px-3 py-2 text-gray-600">{row.voivodeship ?? '—'}</td>
                <td className="px-3 py-2 text-gray-600">
                  {row.priceSource ? tf.sources[row.priceSource] : '—'}
                </td>
                <td className="px-3 py-2 text-gray-600">
                  {formatDateTime(row.lastPriceAt, tf.noData)}
                </td>
                <td className="px-3 py-2">
                  {row.isStale && (
                    <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                      {tf.stale}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data && data.total > data.limit && (
        <div className="flex items-center justify-between text-sm text-gray-600">
          <button
            type="button"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded border border-gray-300 bg-white px-3 py-1 disabled:cursor-not-allowed disabled:opacity-50"
          >
            ←
          </button>
          <span>
            {page} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="rounded border border-gray-300 bg-white px-3 py-1 disabled:cursor-not-allowed disabled:opacity-50"
          >
            →
          </button>
        </div>
      )}
    </div>
  );
}
