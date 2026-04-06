import Link from 'next/link';
import { detectLocale, getTranslations } from '../../../lib/i18n';
import { adminFetch, AdminApiError } from '../../../lib/admin-api';
import type { StationListResult, StationRow } from '../../../lib/types';

interface SearchParams {
  page?: string;
  search?: string;
}

export default async function StationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const locale = await detectLocale();
  const t = getTranslations(locale);
  const params = await searchParams;
  const page = parseInt(params.page ?? '1', 10) || 1;
  const search = params.search ?? '';

  let result: StationListResult | null = null;
  let error: string | null = null;

  try {
    const qs = new URLSearchParams({ page: String(page), limit: '20' });
    if (search) qs.set('search', search);
    result = await adminFetch<StationListResult>(`/v1/admin/stations?${qs.toString()}`);
  } catch (e) {
    error = e instanceof AdminApiError ? e.message : t.stations.errorGeneric;
  }

  const totalPages = result ? Math.ceil(result.total / 20) : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{t.sections.stations.title}</h1>
          <p className="mt-1 text-sm text-gray-500">{t.sections.stations.description}</p>
        </div>
      </div>

      <form className="mb-4" method="GET">
        <input
          name="search"
          defaultValue={search}
          placeholder={t.stations.searchPlaceholder}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm w-64"
        />
        <button
          type="submit"
          className="ml-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700"
        >
          {t.stations.searchButton}
        </button>
      </form>

      {error && (
        <div className="rounded-md bg-red-50 p-4 mb-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {result && (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">{t.stations.nameColumn}</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">{t.stations.addressColumn}</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">{t.stations.brandColumn}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {result.data.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-gray-400">
                      {t.stations.noResults}
                    </td>
                  </tr>
                )}
                {result.data.map((station: StationRow) => (
                  <tr key={station.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{station.name}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs truncate max-w-xs">
                      {station.address ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{station.brand ?? '—'}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/stations/${station.id}`}
                        className="text-blue-600 hover:underline text-xs"
                      >
                        {t.stations.detailAction}
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
                  href={`?page=${page - 1}${search ? `&search=${encodeURIComponent(search)}` : ''}`}
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
                  href={`?page=${page + 1}${search ? `&search=${encodeURIComponent(search)}` : ''}`}
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
