import { detectLocale, getTranslations } from '../../../lib/i18n';
import { fetchSummary } from './actions';
import { MarketSignalsDashboard } from './MarketSignalsDashboard';

export default async function MarketSignalsPage() {
  const locale = await detectLocale();
  const t = getTranslations(locale);
  const { data: initialSummary, error: initialError } = await fetchSummary();

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
        {t.sections.marketSignals.title}
      </h1>
      <p className="mt-1 text-sm text-gray-600">{t.sections.marketSignals.description}</p>
      <div className="mt-6">
        <MarketSignalsDashboard
          t={t.marketSignals}
          locale={locale}
          initialSummary={initialSummary?.signals ?? null}
          initialError={initialError ?? null}
        />
      </div>
    </div>
  );
}
