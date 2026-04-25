'use client';

import { useEffect, useState, useTransition } from 'react';
import { fetchApiCostMetrics } from './actions';
import type { ApiCostMetricsDto } from './types';
import type { MetricsTranslations } from '../../../lib/i18n';

interface Props {
  t: MetricsTranslations;
}

function formatUsd(val: number): string {
  return `$${val.toFixed(2)}`;
}

export function ApiCostTab({ t }: Props) {
  const tc = t.cost;
  const [data, setData] = useState<ApiCostMetricsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let alive = true;
    startTransition(async () => {
      const result = await fetchApiCostMetrics();
      if (!alive) return;
      // Use 'in' instead of truthy check so an Error('') doesn't yield a phantom blank state.
      if ('error' in result) setError(result.error ?? 'Failed to load API cost metrics.');
      else { setData(result.data ?? null); setError(null); }
    });
    return () => { alive = false; };
  }, []);

  const maxMonthlySpend = data
    ? Math.max(...data.last3Months.map(m => m.spendUsd), 0)
    : 0;
  // When all three months are zero the chart is meaningless — suppress it so the user
  // sees the noData-ish fallback rather than a row of flat 2% bars.
  const showChart = data != null && maxMonthlySpend > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold text-gray-900">{t.tabs.cost}</h2>
        {isPending && <span className="text-xs text-gray-400">…</span>}
      </div>

      {error && <p className="text-sm text-red-600">{t.errorGeneric}</p>}
      {!data && !error && !isPending && <p className="text-sm text-gray-400">{tc.noData}</p>}

      {data && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="mb-1 text-xs text-gray-500">{tc.today}</p>
              <p className="text-2xl font-semibold text-gray-900">{formatUsd(data.today.spendUsd)}</p>
              <p className="text-xs text-gray-500">
                {data.today.imageCount.toLocaleString()} {tc.imagesLabel.toLowerCase()}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="mb-1 text-xs text-gray-500">{tc.currentWeek}</p>
              <p className="text-2xl font-semibold text-gray-900">
                {formatUsd(data.currentWeek.spendUsd)}
              </p>
              <p className="text-xs text-gray-500">
                {data.currentWeek.imageCount.toLocaleString()} {tc.imagesLabel.toLowerCase()}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="mb-1 text-xs text-gray-500">{tc.currentMonth}</p>
              <p className="text-2xl font-semibold text-gray-900">
                {formatUsd(data.currentMonth.spendUsd)}
              </p>
              <p className="text-xs text-gray-500">
                {data.currentMonth.imageCount.toLocaleString()} {tc.imagesLabel.toLowerCase()}
              </p>
            </div>
          </div>

          {showChart && (
            <div className="rounded-lg border border-gray-200 bg-white p-5">
              <p className="mb-3 text-sm font-medium text-gray-900">{tc.last3Months}</p>
              <div className="flex h-32 items-end gap-3">
                {data.last3Months.map(m => {
                  const heightPct = Math.max(Math.round((m.spendUsd / maxMonthlySpend) * 100), 2);
                  return (
                    <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
                      <span className="text-xs font-medium text-gray-700">
                        {formatUsd(m.spendUsd)}
                      </span>
                      <div className="flex w-full flex-1 items-end">
                        <div
                          className="w-full rounded-t bg-blue-600"
                          style={{ height: `${heightPct}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-500">{m.month}</span>
                      <span className="text-[10px] text-gray-400">
                        {m.imageCount.toLocaleString()}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
