import Link from 'next/link';
import { detectLocale, getTranslations, type Translations } from '../../../../lib/i18n';
import { adminFetch } from '../../../../lib/admin-api';
import type {
  AllSubmissionsListResult,
  AllSubmissionRow,
  SubmissionStatusValue,
} from '../../../../lib/types';
import AllSubmissionsFilter from './AllSubmissionsFilter';

const PAGE_SIZE = 20;

const ALL_STATUSES: SubmissionStatusValue[] = [
  'pending',
  'verified',
  'shadow_rejected',
  'rejected',
];

interface Props {
  searchParams: Promise<{
    page?: string;
    statuses?: string;
    from?: string;
    to?: string;
  }>;
}

function formatPrice(
  priceData: Array<{ fuel_type: string; price_per_litre: number | null }> | null | undefined,
): string {
  if (!Array.isArray(priceData)) return '—';
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

function parseStatusesFromQuery(raw: string | undefined): SubmissionStatusValue[] {
  if (!raw) return ALL_STATUSES;
  // P7 (3.18 review) — Set-dedup so a URL like `?statuses=pending,pending`
  // doesn't double-tap the toggle handler / inflate the URL on rapid clicks.
  const parts = Array.from(
    new Set(
      raw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => (ALL_STATUSES as string[]).includes(s)),
    ),
  ) as SubmissionStatusValue[];
  // No valid values → fall back to "all selected" rather than rendering an
  // empty list (the page intent is "all" by default).
  return parts.length > 0 ? parts : ALL_STATUSES;
}

// P6 (3.18 review) — single source of truth for URL-param construction.
// Used by both the API call build (this page) and the pagination links.
// Skips empty strings, null, and undefined uniformly.
function buildQuery(params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') qs.set(k, v);
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export default async function AllSubmissionsPage({ searchParams }: Props) {
  const locale = await detectLocale();
  const t = getTranslations(locale);
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page ?? '1', 10) || 1);
  const selectedStatuses = parseStatusesFromQuery(params.statuses);
  const fromDate = params.from ?? '';
  const toDate = params.to ?? '';

  let result: AllSubmissionsListResult | null = null;
  let fetchError: string | null = null;

  // Only forward the `statuses` query param when the selection is a strict
  // subset. Sending all four is equivalent to omitting the filter; skipping
  // the param keeps the URL clean when the page is in default state.
  const statusesIsSubset = selectedStatuses.length < ALL_STATUSES.length;

  // Shared filter params reused by the API call AND pagination <Link>s so
  // both stay in lock-step on what gets serialised.
  const sharedParams: Record<string, string | undefined> = {
    statuses: statusesIsSubset ? selectedStatuses.join(',') : undefined,
    from: fromDate || undefined,
    to: toDate || undefined,
  };

  try {
    result = await adminFetch<AllSubmissionsListResult>(
      `/v1/admin/submissions/all${buildQuery({
        ...sharedParams,
        page: String(page),
        limit: String(PAGE_SIZE),
      })}`,
    );
  } catch {
    fetchError = t.review.errorGeneric;
  }

  const totalPages = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1;

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900">{t.sections.allSubmissions.title}</h1>
      <p className="mt-1 text-sm text-gray-500">{t.sections.allSubmissions.description}</p>

      <div className="mt-4">
        <AllSubmissionsFilter
          selectedStatuses={selectedStatuses}
          allStatuses={ALL_STATUSES}
          fromDate={fromDate}
          toDate={toDate}
          statusFilterLabel={t.allSubmissions.statusFilterLabel}
          statusFilterAll={t.allSubmissions.statusFilterAll}
          dateFromLabel={t.allSubmissions.dateFromLabel}
          dateToLabel={t.allSubmissions.dateToLabel}
          statusLabels={t.users.submissionStatuses}
        />
      </div>

      {fetchError && (
        <p className="mt-6 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{fetchError}</p>
      )}

      {result && result.data.length === 0 && (
        <p className="mt-8 text-sm text-gray-400">{t.allSubmissions.noItems}</p>
      )}

      {result && result.data.length > 0 && (
        <div className="mt-6 space-y-3">
          {result.data.map((row) => (
            <FirehoseRow key={row.id} row={row} t={t} locale={locale} />
          ))}

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm text-gray-500">
              <span>
                {result.total} total · page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                {page > 1 && (
                  <Link
                    href={`/submissions/all${buildQuery({
                      ...sharedParams,
                      page: String(page - 1),
                    })}`}
                    className="rounded border border-gray-200 px-3 py-1 hover:bg-gray-50"
                  >
                    ←
                  </Link>
                )}
                {page < totalPages && (
                  <Link
                    href={`/submissions/all${buildQuery({
                      ...sharedParams,
                      page: String(page + 1),
                    })}`}
                    className="rounded border border-gray-200 px-3 py-1 hover:bg-gray-50"
                  >
                    →
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const STATUS_BADGE_STYLE: Record<SubmissionStatusValue, string> = {
  verified: 'bg-emerald-100 text-emerald-800',
  pending: 'bg-blue-100 text-blue-800',
  shadow_rejected: 'bg-amber-100 text-amber-800',
  rejected: 'bg-gray-200 text-gray-800',
};

// P2 (3.18 review) — fallback for any future SubmissionStatus enum value
// the firehose hasn't been updated for. Keeps the row rendering instead
// of emitting `className="… undefined"`.
const STATUS_BADGE_FALLBACK = 'bg-gray-100 text-gray-700';

function FirehoseRow({
  row,
  t,
  locale,
}: {
  row: AllSubmissionRow;
  t: Translations;
  locale: string;
}) {
  const statusLabel = t.users.submissionStatuses[row.status] ?? row.status;
  const flagLabel = row.flag_reason
    ? (t.review.flagReason[row.flag_reason] ?? row.flag_reason)
    : null;

  return (
    <Link
      href={`/submissions/${row.id}`}
      className="block rounded-md border border-gray-200 bg-white p-3 hover:bg-gray-50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-gray-900">
            {row.station_name ?? t.review.unknown}
          </p>
          <p className="mt-0.5 text-sm text-gray-700">{formatPrice(row.price_data)}</p>
          <p className="mt-0.5 text-xs text-gray-500">
            {new Date(row.created_at).toLocaleString(locale)}
            {row.ocr_confidence_score != null
              ? ` · ${(row.ocr_confidence_score * 100).toFixed(0)}%`
              : ` · ${t.review.na}`}
            {' · '}
            <span className="font-mono text-gray-400">{row.user_id.slice(0, 8)}…</span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_STYLE[row.status] ?? STATUS_BADGE_FALLBACK}`}
          >
            {statusLabel}
          </span>
          {flagLabel && (
            <span className="text-xs text-gray-500">{flagLabel}</span>
          )}
        </div>
      </div>
    </Link>
  );
}
