import { detectLocale, getTranslations } from '../../../lib/i18n';
import { adminFetch } from '../../../lib/admin-api';
import { DlqRowActions } from './DlqRowActions';
import type { DlqJobRow } from '../../../lib/types';

export default async function DeadLetterPage() {
  const locale = await detectLocale();
  const t = getTranslations(locale);

  let jobs: DlqJobRow[] = [];
  let fetchError: string | null = null;

  try {
    jobs = await adminFetch<DlqJobRow[]>('/v1/admin/dlq');
  } catch {
    fetchError = t.deadLetter.errorGeneric;
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900">{t.sections.deadLetter.title}</h1>
      <p className="mt-1 text-sm text-gray-500">{t.sections.deadLetter.description}</p>

      {fetchError && (
        <p className="mt-6 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{fetchError}</p>
      )}

      {!fetchError && jobs.length === 0 && (
        <p className="mt-8 text-sm text-gray-400">{t.deadLetter.noItems}</p>
      )}

      {jobs.length > 0 && (
        <div className="mt-6 overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                {[
                  t.deadLetter.columns.submissionId,
                  t.deadLetter.columns.station,
                  t.deadLetter.columns.failureReason,
                  t.deadLetter.columns.attempts,
                  t.deadLetter.columns.lastAttempt,
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
              {jobs.map((row) => (
                <tr key={row.jobId} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">
                    {row.submissionId ? `${row.submissionId.slice(0, 8)}…` : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {row.stationName ?? t.deadLetter.unknownStation}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {row.failureReason ?? t.deadLetter.unknownReason}
                  </td>
                  <td className="px-4 py-3 text-center text-gray-700">{row.attemptsMade}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {row.lastAttemptAt
                      ? new Date(row.lastAttemptAt).toLocaleString(locale)
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <DlqRowActions
                      jobId={row.jobId}
                      retryLabel={t.deadLetter.retry}
                      discardLabel={t.deadLetter.discard}
                      confirmDiscardLabel={t.deadLetter.confirmDiscard}
                      errorLabel={t.deadLetter.errorGeneric}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
