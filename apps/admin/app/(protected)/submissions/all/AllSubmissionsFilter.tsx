'use client';

import { useRouter } from 'next/navigation';
import type { SubmissionStatusValue } from '../../../../lib/types';

interface Props {
  selectedStatuses: SubmissionStatusValue[];
  allStatuses: SubmissionStatusValue[];
  fromDate: string;
  toDate: string;
  statusFilterLabel: string;
  statusFilterAll: string;
  dateFromLabel: string;
  dateToLabel: string;
  statusLabels: Record<string, string>;
}

export default function AllSubmissionsFilter({
  selectedStatuses,
  allStatuses,
  fromDate,
  toDate,
  statusFilterLabel,
  statusFilterAll,
  dateFromLabel,
  dateToLabel,
  statusLabels,
}: Props) {
  const router = useRouter();

  function pushUpdate(next: {
    statuses?: SubmissionStatusValue[];
    from?: string;
    to?: string;
  }) {
    const statuses = next.statuses ?? selectedStatuses;
    const from = next.from ?? fromDate;
    const to = next.to ?? toDate;
    const qs = new URLSearchParams();
    // Only emit `statuses` when the selection is a strict subset; sending
    // all four is equivalent to omitting the param. This keeps the URL
    // clean in the default state and matches the page parser's expectation.
    if (statuses.length > 0 && statuses.length < allStatuses.length) {
      qs.set('statuses', statuses.join(','));
    }
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    // P4 (3.18 review) — explicitly omit `page` so the page parser defaults
    // to 1. Previously this was achieved by accident (no page param ever
    // forwarded); making the contract explicit guards against future
    // refactors that might add `page` to the spread and silently break
    // pagination reset on filter change.
    const s = qs.toString();
    router.push(`/submissions/all${s ? `?${s}` : ''}`);
  }

  function toggleStatus(status: SubmissionStatusValue) {
    const isSelected = selectedStatuses.includes(status);
    let next: SubmissionStatusValue[];
    if (isSelected) {
      next = selectedStatuses.filter((s) => s !== status);
      // Empty selection collapses back to "all" — page intent is "all" by
      // default; an explicitly empty selection would render zero rows which
      // isn't useful for an observability surface.
      if (next.length === 0) next = allStatuses;
    } else {
      next = [...selectedStatuses, status];
    }
    pushUpdate({ statuses: next });
  }

  function selectAll() {
    pushUpdate({ statuses: allStatuses });
  }

  const allSelected = selectedStatuses.length === allStatuses.length;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-500">{statusFilterLabel}</span>
        <button
          type="button"
          onClick={selectAll}
          className={`rounded border px-2 py-1 text-xs ${
            allSelected
              ? 'border-gray-900 bg-gray-900 text-white'
              : 'border-gray-200 text-gray-700 hover:bg-gray-50'
          }`}
        >
          {statusFilterAll}
        </button>
        {allStatuses.map((s) => {
          const active = selectedStatuses.includes(s) && !allSelected;
          return (
            <button
              key={s}
              type="button"
              onClick={() => toggleStatus(s)}
              className={`rounded border px-2 py-1 text-xs ${
                active
                  ? 'border-gray-900 bg-gray-900 text-white'
                  : 'border-gray-200 text-gray-700 hover:bg-gray-50'
              }`}
            >
              {statusLabels[s] ?? s}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <label className="text-sm text-gray-500">
          {dateFromLabel}
          <input
            type="date"
            value={fromDate}
            onChange={(e) => pushUpdate({ from: e.target.value })}
            className="ml-2 rounded border border-gray-200 px-2 py-1 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-gray-900"
          />
        </label>
        <label className="text-sm text-gray-500">
          {dateToLabel}
          <input
            type="date"
            value={toDate}
            onChange={(e) => pushUpdate({ to: e.target.value })}
            className="ml-2 rounded border border-gray-200 px-2 py-1 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-gray-900"
          />
        </label>
      </div>
    </div>
  );
}
