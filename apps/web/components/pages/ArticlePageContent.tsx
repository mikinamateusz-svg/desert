import Link from 'next/link';
import type { Locale, Translations } from '../../lib/i18n';
import type { Article } from '../../lib/articles';
import AdSlot from '../AdSlot';
import PriceSummaryContent from './PriceSummaryContent';

function listHref(locale: Locale): string {
  if (locale === 'en') return '/en/news';
  if (locale === 'uk') return '/uk/news';
  return '/aktualnosci';
}

export default function ArticlePageContent({
  article,
  locale,
  t,
}: {
  article: Article;
  locale: Locale;
  t: Translations;
}) {
  return (
    <main className="max-w-2xl mx-auto px-4 py-10">
      <Link href={listHref(locale)} className="text-sm text-blue-600 hover:underline mb-6 inline-block">
        {t.news.backToNews}
      </Link>

      <p className="text-xs text-gray-400 mb-1">{article.date}</p>
      <h1 className="text-2xl font-bold mb-6">
        {article.auto ? t.news.priceSummaryTitle : article.title}
      </h1>

      {article.auto ? (
          <PriceSummaryContent t={t} />
      ) : (
        <div
          className="prose prose-sm max-w-none"
          dangerouslySetInnerHTML={{ __html: article.html }}
        />
      )}

      <AdSlot slotId="aktualnosci-inline" className="h-[100px] w-full my-6" />
    </main>
  );
}
