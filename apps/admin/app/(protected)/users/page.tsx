import Link from 'next/link';
import { detectLocale, getTranslations } from '../../../lib/i18n';
import { adminFetch, AdminApiError } from '../../../lib/admin-api';
import type { UserListResult, UserRow } from '../../../lib/types';

const TRUST_HIGH = 200;
const TRUST_LOW = 50;

function getTrustColor(score: number): string {
  if (score >= TRUST_HIGH) return 'text-green-700 bg-green-50';
  if (score >= TRUST_LOW) return 'text-amber-700 bg-amber-50';
  return 'text-red-700 bg-red-50';
}

interface SearchParams {
  page?: string;
  search?: string;
}

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const locale = await detectLocale();
  const t = getTranslations(locale);
  const params = await searchParams;
  const page = parseInt(params.page ?? '1', 10) || 1;
  const search = params.search ?? '';

  let result: UserListResult | null = null;
  let error: string | null = null;

  try {
    const qs = new URLSearchParams({ page: String(page), limit: '20' });
    if (search) qs.set('search', search);
    result = await adminFetch<UserListResult>(`/v1/admin/users?${qs.toString()}`);
  } catch (e) {
    error = e instanceof AdminApiError ? e.message : 'Failed to load users.';
  }

  const totalPages = result ? Math.ceil(result.total / 20) : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{t.sections.users.title}</h1>
          <p className="mt-1 text-sm text-gray-500">{t.sections.users.description}</p>
        </div>
      </div>

      <form className="mb-4" method="GET">
        <input
          name="search"
          defaultValue={search}
          placeholder={t.users.searchPlaceholder}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm w-64"
        />
        <button
          type="submit"
          className="ml-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700"
        >
          {t.users.searchButton}
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
                  <th className="px-4 py-3 text-left font-medium text-gray-500">{t.users.nameColumn}</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">{t.users.trustScore}</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">{t.users.shadowBanned}</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">{t.users.alertsColumn}</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">{t.users.submissionsColumn}</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">{t.users.joinedColumn}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {result.data.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-gray-400">
                      {t.users.noUsersFound}
                    </td>
                  </tr>
                )}
                {result.data.map((user: UserRow) => (
                  <tr key={user.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">
                        {user.display_name ?? '—'}
                      </div>
                      <div className="text-xs text-gray-500 truncate max-w-xs">
                        {user.email ?? '—'}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getTrustColor(user.trust_score)}`}
                      >
                        {user.trust_score}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {user.shadow_banned ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                          Banned
                        </span>
                      ) : (
                        <span className="text-gray-400 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {user.active_alert_count > 0 ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                          {user.active_alert_count}
                        </span>
                      ) : (
                        <span className="text-gray-400 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{user.submission_count}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {new Date(user.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/users/${user.id}`}
                        className="text-blue-600 hover:underline text-xs"
                      >
                        View
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
