import Link from 'next/link';
import { detectLocale, getTranslations } from '../../../lib/i18n';
import { adminFetch, AdminApiError } from '../../../lib/admin-api';
import type {
  ClaimStatusValue,
  StationClaimListResult,
  StationClaimRow,
} from '../../../lib/types';

interface SearchParams {
  status?: string;
  page?: string;
}

const ALLOWED_STATUSES: readonly ClaimStatusValue[] = [
  'PENDING',
  'AWAITING_DOCS',
  'APPROVED',
  'REJECTED',
];

const STATUS_BADGE: Record<ClaimStatusValue, string> = {
  PENDING: 'bg-amber-50 text-amber-700',
  AWAITING_DOCS: 'bg-blue-50 text-blue-700',
  APPROVED: 'bg-green-50 text-green-700',
  REJECTED: 'bg-red-50 text-red-700',
};

const PAGE_LIMIT = 50;

export default async function StationClaimsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const locale = await detectLocale();
  const t = getTranslations(locale);
  const params = await searchParams;

  // Default landing view: PENDING — that's where ops attention is
  // needed. Setting `?status=` (or any other unknown value) shows all
  // statuses so admins can audit history.
  const requestedStatus = params.status?.toUpperCase();
  const statusFilter: ClaimStatusValue | undefined =
    requestedStatus && ALLOWED_STATUSES.includes(requestedStatus as ClaimStatusValue)
      ? (requestedStatus as ClaimStatusValue)
      : params.status === undefined
        ? 'PENDING'
        : undefined;

  // P8 (CR fix): cap page to prevent ?page=999999 triggering a
  // skip = (page-1) * limit scan over potentially many rows. Real
  // queues never exceed ~50 entries; 50 page * 50 limit = 2500 row
  // ceiling is plenty.
  const rawPage = parseInt(params.page ?? '1', 10) || 1;
  const page = Math.min(Math.max(1, rawPage), 50);

  let result: StationClaimListResult | null = null;
  let error: string | null = null;
  try {
    const qs = new URLSearchParams({ page: String(page), limit: String(PAGE_LIMIT) });
    if (statusFilter) qs.set('status', statusFilter);
    result = await adminFetch<StationClaimListResult>(`/v1/admin/station-claims?${qs.toString()}`);
  } catch (e) {
    // P7: same safe-message rule as the detail page.
    if (e instanceof AdminApiError) {
      console.error('[admin claim list] AdminApiError', e.status, e.message);
      error = e.status >= 500 ? 'API error — please retry.' : 'Failed to load claims.';
    } else {
      error = 'Failed to load claims.';
    }
  }

  const totalPages = result ? Math.ceil(result.total / PAGE_LIMIT) : 0;

  // Filter chips: each links to the same page with ?status=X. The "All"
  // chip uses a dummy `?status=all` which falls through the allow-list
  // → undefined → no filter.
  const statusChips: Array<{ key: string; label: string; href: string }> = [
    { key: 'PENDING', label: t.stationClaims.filterPending, href: '?status=PENDING' },
    { key: 'AWAITING_DOCS', label: t.stationClaims.filterAwaitingDocs, href: '?status=AWAITING_DOCS' },
    { key: 'APPROVED', label: t.stationClaims.filterApproved, href: '?status=APPROVED' },
    { key: 'REJECTED', label: t.stationClaims.filterRejected, href: '?status=REJECTED' },
    { key: 'ALL', label: t.stationClaims.filterAll, href: '?status=all' },
  ];

  function chipClass(active: boolean): string {
    return active
      ? 'inline-block px-3 py-1 rounded-full text-xs font-medium bg-blue-600 text-white'
      : 'inline-block px-3 py-1 rounded-full text-xs font-medium bg-white text-gray-600 border border-gray-200 hover:bg-gray-50';
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{t.sections.stationClaims.title}</h1>
          <p className="mt-1 text-sm text-gray-500">{t.sections.stationClaims.description}</p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {statusChips.map((chip) => {
          const active =
            (chip.key === 'ALL' && statusFilter === undefined) || chip.key === statusFilter;
          return (
            <Link key={chip.key} href={chip.href} className={chipClass(active)}>
              {chip.label}
            </Link>
          );
        })}
      </div>

      {error && (
        <div className="rounded-md bg-red-50 p-4 mb-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {result && (
        <>
          <div className="overflow-x-auto bg-white rounded-md border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">{t.stationClaims.colApplicant}</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">{t.stationClaims.colStation}</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">{t.stationClaims.colBrand}</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">{t.stationClaims.colStatus}</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">{t.stationClaims.colSubmitted}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {result.data.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-gray-400">
                      {t.stationClaims.noClaims}
                    </td>
                  </tr>
                )}
                {result.data.map((claim: StationClaimRow) => (
                  <tr key={claim.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">
                        {claim.user.display_name ?? '—'}
                      </div>
                      <div className="text-xs text-gray-500 truncate max-w-xs">
                        {claim.user.email ?? '—'}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900 truncate max-w-xs">
                        {claim.station.name}
                      </div>
                      <div className="text-xs text-gray-500 truncate max-w-xs">
                        {claim.station.address ?? '—'}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {claim.station.brand ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE[claim.status]}`}
                      >
                        {claim.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                      {new Date(claim.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/station-claims/${claim.id}`}
                        className="text-blue-600 hover:underline text-xs"
                      >
                        {t.stationClaims.viewLink}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="mt-4 flex gap-2 items-center text-sm">
              {page > 1 && (
                <Link
                  href={`?${statusFilter ? `status=${statusFilter}&` : 'status=all&'}page=${page - 1}`}
                  className="px-3 py-1 border rounded hover:bg-gray-50"
                >
                  Previous
                </Link>
              )}
              <span className="text-gray-500">
                Page {page} of {totalPages}
              </span>
              {page < totalPages && (
                <Link
                  href={`?${statusFilter ? `status=${statusFilter}&` : 'status=all&'}page=${page + 1}`}
                  className="px-3 py-1 border rounded hover:bg-gray-50"
                >
                  Next
                </Link>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
