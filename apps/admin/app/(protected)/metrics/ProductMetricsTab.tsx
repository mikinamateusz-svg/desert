'use client';

import { useState, useTransition, useEffect } from 'react';
import { fetchProductMetrics } from './actions';
import type { ProductMetricsDto } from './types';
import type { MetricsTranslations } from '../../../lib/i18n';

type Period = 'today' | '7d' | '30d';

interface Props {
  t: MetricsTranslations;
}

export function ProductMetricsTab({ t }: Props) {
  const tp = t.product;
  const [period, setPeriod] = useState<Period>('7d');
  const [data, setData] = useState<ProductMetricsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function load(p: Period) {
    startTransition(async () => {
      const result = await fetchProductMetrics(p);
      if (result.error) setError(result.error);
      else { setData(result.data ?? null); setError(null); }
    });
  }

  useEffect(() => { load(period); }, [period]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold text-gray-900">{t.tabs.product}</h2>
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
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <p className="text-xs text-gray-500 mb-1">{tp.totalMapViews}</p>
              <p className="text-2xl font-semibold text-gray-900">{data.totalMapViews.toLocaleString()}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <p className="text-xs text-gray-500 mb-1">{tp.avgAuthPct}</p>
              <p className="text-2xl font-semibold text-gray-900">{data.avgAuthPct} %</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <p className="text-xs text-gray-500 mb-1">{tp.totalNewRegs}</p>
              <p className="text-2xl font-semibold text-gray-900">{data.totalNewRegistrations.toLocaleString()}</p>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left text-xs text-gray-500">
                  <th className="px-4 py-2">{tp.date}</th>
                  <th className="px-4 py-2 text-right">{tp.mapViews}</th>
                  <th className="px-4 py-2 text-right">{tp.authPct}</th>
                  <th className="px-4 py-2 text-right">{tp.newRegs}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {[...data.days].reverse().map(day => (
                  <tr key={day.date}>
                    <td className="px-4 py-2 text-gray-700">{day.date}</td>
                    <td className="px-4 py-2 text-right font-mono text-gray-900">{day.mapViews.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right text-gray-600">{day.authPct} %</td>
                    <td className="px-4 py-2 text-right font-mono text-gray-900">{day.newRegistrations.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
