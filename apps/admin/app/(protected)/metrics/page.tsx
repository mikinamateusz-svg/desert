import { detectLocale, getTranslations } from '../../../lib/i18n';
import { MetricsDashboard } from './MetricsDashboard';

export default async function MetricsPage() {
  const locale = await detectLocale();
  const t = getTranslations(locale);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900">{t.sections.metrics.title}</h1>
      <p className="mt-1 text-sm text-gray-500 mb-6">{t.sections.metrics.description}</p>
      <MetricsDashboard t={t.metrics} />
    </div>
  );
}
