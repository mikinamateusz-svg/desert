'use client';

import { useRouter } from 'next/navigation';

interface Props {
  currentFilter: string;
  filterLabel: string;
  filterAll: string;
  options: Array<{ value: string; label: string }>;
}

export default function SubmissionsFilter({ currentFilter, filterLabel, filterAll, options }: Props) {
  const router = useRouter();
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-gray-500">{filterLabel}</span>
      <select
        value={currentFilter}
        onChange={(e) => {
          const v = e.target.value;
          router.push(v ? `/submissions?flagReason=${encodeURIComponent(v)}` : '/submissions');
        }}
        className="rounded border border-gray-200 px-2 py-1 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-gray-900"
      >
        <option value="">{filterAll}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
