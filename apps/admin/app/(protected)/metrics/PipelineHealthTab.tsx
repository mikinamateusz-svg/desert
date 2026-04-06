'use client';

import { useEffect, useState, useTransition } from 'react';
import { fetchPipelineHealth } from './actions';
import type { PipelineHealthDto } from './types';
import type { MetricsTranslations } from '../../../lib/i18n';

interface Props {
  t: MetricsTranslations;
}

function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-2xl font-semibold text-gray-900">{value}</p>
    </div>
  );
}

function fmtPct(v: number | null): string {
  if (v === null) return '—';
  return `${Math.round(v * 1000) / 10} %`;
}

function fmtSec(v: number | null, suffix: string): string {
  if (v === null) return '—';
  return `${v} ${suffix}`;
}

export function PipelineHealthTab({ t }: Props) {
  const tp = t.pipeline;
  const [data, setData] = useState<PipelineHealthDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function load() {
    startTransition(async () => {
      const result = await fetchPipelineHealth();
      if (result.error) {
        setError(result.error);
      } else {
        setData(result.data ?? null);
        setError(null);
      }
    });
  }

  // Initial load
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh every 60 s
  useEffect(() => {
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    return (
      <div className="flex items-center gap-3">
        <p className="text-sm text-red-600">{t.errorGeneric}</p>
        <button onClick={load} className="text-sm text-blue-600 underline">{tp.autoRefresh}</button>
      </div>
    );
  }

  if (!data) {
    return <p className="text-sm text-gray-400">{isPending ? '…' : tp.noData}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">{t.tabs.pipeline}</h2>
        <button
          onClick={load}
          disabled={isPending}
          className="text-sm text-blue-600 underline disabled:opacity-50"
        >
          {tp.autoRefresh}
        </button>
      </div>

      {data.successRate1h === null && (
        <p className="text-sm text-gray-400">{tp.noData}</p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard label={tp.successRate}    value={fmtPct(data.successRate1h)} />
        <StatCard label={tp.processingP50}  value={fmtSec(data.processingTimeP50Seconds, tp.seconds)} />
        <StatCard label={tp.processingP95}  value={fmtSec(data.processingTimeP95Seconds, tp.seconds)} />
        <StatCard label={tp.queueDepth}     value={data.queueDepth} />
        <StatCard label={tp.activeJobs}     value={data.activeJobs} />
        <StatCard label={tp.dlqCount}       value={data.dlqCount} />
      </div>

      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-2">{tp.errorBreakdown}</h3>
        {data.errorBreakdown.length === 0 ? (
          <p className="text-sm text-gray-400">{tp.noErrors}</p>
        ) : (
          <table className="w-full text-sm border-collapse">
            <tbody>
              {data.errorBreakdown.map(row => (
                <tr key={row.reason} className="border-b border-gray-100">
                  <td className="py-1 pr-4 text-gray-700">
                    {t.flagReasons[row.reason] ?? row.reason}
                  </td>
                  <td className="py-1 font-mono text-gray-900">{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
