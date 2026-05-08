import Link from 'next/link';
import { detectLocale, getTranslations, type Translations } from '../../../lib/i18n';
import { adminFetch } from '../../../lib/admin-api';
import type { SubmissionListResult, FlaggedSubmissionRow } from '../../../lib/types';
import SubmissionsFilter from './SubmissionsFilter';
import ConflictPairCard from './ConflictPairCard';

const PAGE_SIZE = 20;

interface Props {
  searchParams: Promise<{ page?: string; flagReason?: string }>;
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

export default async function SubmissionsPage({ searchParams }: Props) {
  const locale = await detectLocale();
  const t = getTranslations(locale);
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page ?? '1', 10) || 1);
  const flagReason = params.flagReason ?? '';

  let result: SubmissionListResult | null = null;
  let fetchError: string | null = null;

  const qs = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  if (flagReason) qs.set('flagReason', flagReason);

  try {
    result = await adminFetch<SubmissionListResult>(`/v1/admin/submissions?${qs.toString()}`);
  } catch {
    fetchError = t.review.errorGeneric;
  }

  const totalPages = result ? Math.ceil(result.total / PAGE_SIZE) : 1;

  const filterOptions = Object.entries(t.review.flagReason).map(([value, label]) => ({
    value,
    label,
  }));

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900">{t.sections.submissions.title}</h1>
      <p className="mt-1 text-sm text-gray-500">{t.sections.submissions.description}</p>

      <div className="mt-4">
        <SubmissionsFilter
          currentFilter={flagReason}
          filterLabel={t.review.filterLabel}
          filterAll={t.review.filterAll}
          options={filterOptions}
        />
      </div>

      {fetchError && (
        <p className="mt-6 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{fetchError}</p>
      )}

      {result && result.data.length === 0 && (
        <p className="mt-8 text-sm text-gray-400">{t.review.noItems}</p>
      )}

      {result && result.data.length > 0 && (
        <div className="mt-6 space-y-3">
          {result.data.map((item) =>
            item.kind === 'pair' ? (
              <ConflictPairCard
                key={item.conflict_group_id}
                conflictGroupId={item.conflict_group_id}
                newer={item.newer}
                older={item.older}
                copy={{
                  badge: t.review.conflictGroupBadge,
                  newerLabel: t.review.conflictNewerLabel,
                  olderLabel: t.review.conflictOlderLabel,
                  approveNewer: t.review.conflictApproveNewer,
                  approveOlder: t.review.conflictApproveOlder,
                  newerUnusable: t.review.conflictNewerUnusable,
                  bothUnusable: t.review.conflictBothUnusable,
                  confirmBothUnusableTitle: t.review.confirmBothUnusableTitle,
                  confirmBothUnusableYes: t.review.confirmBothUnusableYes,
                  cancel: t.review.cancel,
                  review: t.review.reviewLink,
                  errorGeneric: t.review.errorGeneric,
                  errorConflict: t.review.errorConflict,
                  errorBadRequest: t.review.errorBadRequest,
                }}
                locale={locale}
              />
            ) : (
              <SingleRow
                key={item.submission.id}
                row={item.submission}
                t={t}
                locale={locale}
              />
            ),
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm text-gray-500">
              <span>
                {result.total} total · page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                {page > 1 && (
                  <Link
                    href={`/submissions?page=${page - 1}${flagReason ? `&flagReason=${encodeURIComponent(flagReason)}` : ''}`}
                    className="rounded border border-gray-200 px-3 py-1 hover:bg-gray-50"
                  >
                    ←
                  </Link>
                )}
                {page < totalPages && (
                  <Link
                    href={`/submissions?page=${page + 1}${flagReason ? `&flagReason=${encodeURIComponent(flagReason)}` : ''}`}
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

function SingleRow({
  row,
  t,
  locale,
}: {
  row: FlaggedSubmissionRow;
  t: Translations;
  locale: string;
}) {
  return (
    <div className="rounded-md border border-gray-200 bg-white p-3 hover:bg-gray-50">
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
        <div className="flex flex-col items-end gap-2">
          <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
            {row.flag_reason
              ? (t.review.flagReason[row.flag_reason] ?? row.flag_reason)
              : t.review.unknown}
          </span>
          <Link
            href={`/submissions/${row.id}`}
            className="text-sm font-medium text-gray-900 hover:underline"
          >
            {t.review.reviewLink} →
          </Link>
        </div>
      </div>
    </div>
  );
}
