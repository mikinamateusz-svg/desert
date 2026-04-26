'use client';

import { useCallback, useEffect, useState } from 'react';
import type { StationSyncTranslations } from '../../../lib/i18n';
import { fetchSyncStatus, triggerSync } from './actions';
import type { SyncStatusResult } from './types';

interface Props {
  t: StationSyncTranslations;
  initialStatus: SyncStatusResult | null;
  initialError: string | null;
}

function formatDateTime(iso: string | null, never: string): string {
  if (!iso) return never;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return never;
  return d.toLocaleString();
}

export function StationSyncDashboard({ t, initialStatus, initialError }: Props) {
  const [status, setStatus] = useState<SyncStatusResult | null>(initialStatus);
  const [isTriggering, setIsTriggering] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(initialError);
  // Track which failure timestamp the admin has dismissed. Banner reappears only if a
  // newer lastFailedAt comes in — not on every navigation.
  const [dismissedFailedAt, setDismissedFailedAt] = useState<string | null>(null);

  // Poll status every 5s while running
  useEffect(() => {
    if (status?.status !== 'running') return;
    const id = setInterval(async () => {
      const result = await fetchSyncStatus();
      if (result.data) setStatus(result.data);
    }, 5_000);
    return () => clearInterval(id);
  }, [status?.status]);

  const handleTrigger = useCallback(async () => {
    setIsTriggering(true);
    setErrorBanner(null);
    const result = await triggerSync();
    if (result.error === 'already_running') {
      const s = await fetchSyncStatus();
      if (s.data) setStatus(s.data);
    } else if (result.error) {
      setErrorBanner(result.error);
    } else {
      // Optimistic: flip to running; the first poll will confirm.
      setStatus(prev => (prev ? { ...prev, status: 'running' } : prev));
    }
    setIsTriggering(false);
  }, []);

  const isRunning = status?.status === 'running';
  const isFailed = status?.status === 'failed';
  const buttonDisabled = isRunning || isTriggering;
  const showFailureBanner =
    isFailed && status?.lastFailedAt != null && dismissedFailedAt !== status.lastFailedAt;

  const statusBadge = (() => {
    if (!status) return null;
    if (status.status === 'running') {
      return (
        <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800">
          {t.statusRunning}
        </span>
      );
    }
    if (status.status === 'failed') {
      return (
        <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800">
          {t.statusFailed}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
        {t.statusIdle}
      </span>
    );
  })();

  return (
    <div className="space-y-4">
      {showFailureBanner && (
        <div className="flex items-start justify-between gap-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p>{t.errorBanner}</p>
          <button
            type="button"
            onClick={() => setDismissedFailedAt(status?.lastFailedAt ?? null)}
            className="text-red-700 hover:text-red-900"
          >
            {t.dismissError}
          </button>
        </div>
      )}

      {errorBanner && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {errorBanner}
        </div>
      )}

      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
              {t.statusLabel}
            </dt>
            <dd className="mt-1">{statusBadge}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
              {t.stationCount}
            </dt>
            <dd className="mt-1 text-sm font-semibold text-gray-900">
              {status?.stationCount ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
              {t.lastCompleted}
            </dt>
            <dd className="mt-1 text-sm text-gray-900">
              {formatDateTime(status?.lastCompletedAt ?? null, t.never)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
              {t.lastFailed}
            </dt>
            <dd className="mt-1 text-sm text-gray-900">
              {formatDateTime(status?.lastFailedAt ?? null, t.never)}
            </dd>
          </div>
        </dl>

        <div className="mt-6 border-t border-gray-100 pt-4">
          <span title={isRunning ? t.alreadyRunningTooltip : undefined} className="inline-block">
            <button
              type="button"
              onClick={handleTrigger}
              disabled={buttonDisabled}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400"
            >
              {isRunning ? t.syncRunning : t.triggerButton}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
