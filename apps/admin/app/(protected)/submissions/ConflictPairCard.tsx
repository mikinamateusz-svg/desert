'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import type { FlaggedSubmissionRow } from '../../../lib/types';
import {
  approveNewerInConflict,
  markBothUnusableInConflict,
  markNewerUnusableInConflict,
} from './actions';

interface Props {
  conflictGroupId: string;
  newer: FlaggedSubmissionRow;
  older: FlaggedSubmissionRow;
  copy: {
    badge: string;
    newerLabel: string;
    olderLabel: string;
    approveNewer: string;
    newerUnusable: string;
    bothUnusable: string;
    review: string;
    errorGeneric: string;
    errorConflict: string;
  };
  locale: string;
}

function formatPrices(
  priceData: Array<{ fuel_type: string; price_per_litre: number | null }>,
): string {
  return priceData
    .map((p) => {
      const price =
        typeof p.price_per_litre === 'number' && Number.isFinite(p.price_per_litre)
          ? `${p.price_per_litre.toFixed(2)} zł`
          : '—';
      return `${p.fuel_type ?? '?'} ${price}`;
    })
    .join(', ');
}

export default function ConflictPairCard({
  conflictGroupId,
  newer,
  older,
  copy,
  locale,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handle = (
    action: () => Promise<{ error: string } | null>,
  ) => {
    startTransition(async () => {
      setError(null);
      const result = await action();
      if (result?.error === 'conflict') setError(copy.errorConflict);
      else if (result?.error) setError(copy.errorGeneric);
    });
  };

  const sideClass =
    'flex-1 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm';

  return (
    <div className="rounded-lg border-2 border-amber-300 bg-amber-50/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="inline-flex rounded-full bg-amber-200 px-3 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-900">
          {copy.badge} (2)
        </span>
        <span className="font-mono text-xs text-gray-400">
          {conflictGroupId.slice(0, 8)}…
        </span>
      </div>

      <div className="flex flex-col gap-3 md:flex-row">
        <div className={sideClass}>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase text-amber-900">
              {copy.newerLabel}
            </span>
            <Link
              href={`/submissions/${newer.id}`}
              className="text-xs font-medium text-gray-900 hover:underline"
            >
              {copy.review} →
            </Link>
          </div>
          <p className="font-medium text-gray-900">{newer.station_name ?? '—'}</p>
          <p className="text-gray-700">{formatPrices(newer.price_data)}</p>
          <p className="mt-1 text-xs text-gray-500">
            {new Date(newer.created_at).toLocaleString(locale)}
            {newer.ocr_confidence_score != null
              ? ` · ${(newer.ocr_confidence_score * 100).toFixed(0)}%`
              : ''}
          </p>
        </div>

        <div className={sideClass}>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase text-gray-600">
              {copy.olderLabel}
            </span>
            <Link
              href={`/submissions/${older.id}`}
              className="text-xs font-medium text-gray-900 hover:underline"
            >
              {copy.review} →
            </Link>
          </div>
          <p className="font-medium text-gray-900">{older.station_name ?? '—'}</p>
          <p className="text-gray-700">{formatPrices(older.price_data)}</p>
          <p className="mt-1 text-xs text-gray-500">
            {new Date(older.created_at).toLocaleString(locale)}
            {older.ocr_confidence_score != null
              ? ` · ${(older.ocr_confidence_score * 100).toFixed(0)}%`
              : ''}
          </p>
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() => handle(() => approveNewerInConflict(conflictGroupId, newer.id))}
          className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {copy.approveNewer}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => handle(() => markNewerUnusableInConflict(conflictGroupId, newer.id))}
          className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {copy.newerUnusable}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => handle(() => markBothUnusableInConflict(conflictGroupId))}
          className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {copy.bothUnusable}
        </button>
      </div>
    </div>
  );
}
