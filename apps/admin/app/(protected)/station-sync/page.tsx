import { detectLocale, getTranslations } from '../../../lib/i18n';
import { fetchSyncStatus } from './actions';
import { StationSyncDashboard } from './StationSyncDashboard';

export default async function StationSyncPage() {
  const locale = await detectLocale();
  const t = getTranslations(locale);
  const { data: initialStatus, error: initialError } = await fetchSyncStatus();

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
        {t.sections.stationSync.title}
      </h1>
      <p className="mt-1 text-sm text-gray-600">{t.sections.stationSync.description}</p>
      <div className="mt-6">
        <StationSyncDashboard
          t={t.stationSync}
          initialStatus={initialStatus ?? null}
          initialError={initialError ?? null}
        />
      </div>
    </div>
  );
}
