import Link from 'next/link';
import { detectLocale, getTranslations } from '../../../../lib/i18n';
import { adminFetch, AdminApiError } from '../../../../lib/admin-api';
import type { UserDetail, AnomalyAlertRow, UserSubmissionRow } from '../../../../lib/types';
import { UserActions } from './UserActions';
import { DismissAlertButton } from './DismissAlertButton';

function getTrustColor(score: number): string {
  if (score >= 200) return 'text-green-700 bg-green-50';
  if (score >= 50) return 'text-amber-700 bg-amber-50';
  return 'text-red-700 bg-red-50';
}

export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const locale = await detectLocale();
  const t = getTranslations(locale);
  const { id } = await params;

  let user: UserDetail | null = null;
  let error: string | null = null;

  try {
    user = await adminFetch<UserDetail>(`/v1/admin/users/${id}`);
  } catch (e) {
    error = e instanceof AdminApiError ? e.message : 'Failed to load user.';
  }

  return (
    <div>
      <div className="mb-6">
        <Link href="/users" className="text-sm text-blue-600 hover:underline">
          ← Back to users
        </Link>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 p-4 mb-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {user && (
        <div className="space-y-6">
          {/* Header */}
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-2xl font-semibold text-gray-900">
                  {user.display_name ?? '(no name)'}
                </h1>
                <p className="text-sm text-gray-500">{user.email ?? '(no email)'}</p>
                <p className="text-xs text-gray-400 mt-1">ID: {user.id}</p>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="text-xs text-gray-500">{t.users.trustScore}</p>
                  <span
                    className={`inline-flex items-center px-3 py-1 rounded text-sm font-medium ${getTrustColor(user.trust_score)}`}
                  >
                    {user.trust_score}
                  </span>
                </div>
                {user.shadow_banned && (
                  <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-800">
                    {t.users.shadowBanned}
                  </span>
                )}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-4 text-sm text-gray-600">
              <div>
                <span className="font-medium">Role:</span> {user.role}
              </div>
              <div>
                <span className="font-medium">Submissions:</span> {user.submission_count}
              </div>
              <div>
                <span className="font-medium">Joined:</span>{' '}
                {new Date(user.created_at).toLocaleDateString()}
              </div>
            </div>

            <div className="mt-4">
              <UserActions
                userId={user.id}
                isBanned={user.shadow_banned}
                confirmBanLabel={t.users.confirmBan}
                confirmUnbanLabel={t.users.confirmUnban}
                shadowBanLabel={t.users.shadowBan}
                removeBanLabel={t.users.removeBan}
              />
            </div>
          </div>

          {/* Anomaly Alerts */}
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">{t.users.alertsLabel}</h2>
            {user.alerts.length === 0 ? (
              <p className="text-sm text-gray-400">{t.users.noAlerts}</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {user.alerts.map((alert: AnomalyAlertRow) => (
                  <li key={alert.id} className="py-3 flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-800">
                        {t.users.alertTypes[alert.alert_type] ?? alert.alert_type}
                      </p>
                      <p className="text-xs text-gray-500">
                        {new Date(alert.created_at).toLocaleString()}
                      </p>
                      <pre className="text-xs text-gray-400 mt-1 max-w-md overflow-x-auto">
                        {JSON.stringify(alert.detail, null, 2)}
                      </pre>
                    </div>
                    <DismissAlertButton
                      userId={user!.id}
                      alertId={alert.id}
                      label={t.users.dismissAlert}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Submissions */}
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Submissions ({user.submissions.total})
            </h2>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-gray-500">Status</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-500">Station</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-500">Flag</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-500">Date</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {user.submissions.data.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-4 text-center text-gray-400">
                        No submissions.
                      </td>
                    </tr>
                  )}
                  {user.submissions.data.map((sub: UserSubmissionRow) => (
                    <tr key={sub.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
                          {t.users.submissionStatuses[sub.status] ?? sub.status}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-gray-600 text-xs truncate max-w-xs">
                        {sub.station_id ?? '—'}
                      </td>
                      <td className="px-4 py-2 text-gray-500 text-xs">
                        {sub.flag_reason ?? '—'}
                      </td>
                      <td className="px-4 py-2 text-gray-500 text-xs">
                        {new Date(sub.created_at).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {user.submissions.total > 20 && (
              <p className="text-xs text-gray-400 mt-2">
                Showing 20 of {user.submissions.total} submissions.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
