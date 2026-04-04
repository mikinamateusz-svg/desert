import { detectLocale, getTranslations } from '../../../lib/i18n';

export default async function DeadLetterPage() {
  const locale = await detectLocale();
  const t = getTranslations(locale);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900">{t.sections.deadLetter.title}</h1>
      <p className="mt-1 text-sm text-gray-500">{t.sections.deadLetter.description}</p>
      <p className="mt-8 text-sm text-gray-400">{t.common.comingSoon}</p>
    </div>
  );
}
