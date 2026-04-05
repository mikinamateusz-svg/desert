import Link from 'next/link';
import { detectLocale, getTranslations } from '../../../lib/i18n';
import { adminFetch } from '../../../lib/admin-api';
import type { SubmissionListResult } from '../../../lib/types';

const PAGE_SIZE = 20;

interface Props {
  searchParams: Promise<{ page?: string }>;
}

function formatPrice(priceData: Array<{ fuel_type: string; price_per_litre: number }>): string {
  return priceData.map((p) => `${p.fuel_type} ${p.price_per_litre.toFixed(2)} zł`).join(', ');
}

export default async function SubmissionsPage({ searchParams }: Props) {
  const locale = await detectLocale();
  const t = getTranslations(locale);
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page ?? '1', 10) || 1);

  let result: SubmissionListResult | null = null;
  let fetchError: string | null = null;

  try {
    result = await adminFetch<SubmissionListResult>(
      `/v1/admin/submissions?page=${page}&limit=${PAGE_SIZE}`,
    );
  } catch {
    fetchError = t.review.errorGeneric;
  }

  const totalPages = result ? Math.ceil(result.total / PAGE_SIZE) : 1;

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900">{t.sections.submissions.title}</h1>
      <p className="mt-1 text-sm text-gray-500">{t.sections.submissions.description}</p>

      {fetchError && (
        <p className="mt-6 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{fetchError}</p>
      )}

      {result && result.data.length === 0 && (
        <p className="mt-8 text-sm text-gray-400">{t.review.noItems}</p>
      )}

      {result && result.data.length > 0 && (
        <div className="mt-6">
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {[
                    t.review.columns.station,
                    t.review.columns.prices,
                    t.review.columns.confidence,
                    t.review.columns.submitted,
                    t.review.columns.contributor,
                    t.review.columns.flag,
                    '',
                  ].map((header, i) => (
                    <th
                      key={i}
                      className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {result.data.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {row.station_name ?? t.review.unknown}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{formatPrice(row.price_data)}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {row.ocr_confidence_score != null
                        ? `${(row.ocr_confidence_score * 100).toFixed(0)}%`
                        : t.review.na}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {new Date(row.created_at).toLocaleString(locale)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-400">
                      {row.user_id.slice(0, 8)}…
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                        {t.review.flagReason[row.flag_reason] ?? row.flag_reason}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/submissions/${row.id}`}
                        className="text-sm font-medium text-gray-900 hover:underline"
                      >
                        Review →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm text-gray-500">
              <span>
                {result.total} total · page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                {page > 1 && (
                  <Link
                    href={`/submissions?page=${page - 1}`}
                    className="rounded border border-gray-200 px-3 py-1 hover:bg-gray-50"
                  >
                    ←
                  </Link>
                )}
                {page < totalPages && (
                  <Link
                    href={`/submissions?page=${page + 1}`}
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
