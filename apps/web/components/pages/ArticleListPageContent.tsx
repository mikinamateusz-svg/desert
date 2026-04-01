import Link from 'next/link';
import type { Locale, Translations } from '../../lib/i18n';
import { getAllArticles } from '../../lib/articles';

function articleHref(slug: string, locale: Locale): string {
  if (locale === 'en') return `/en/news/${slug}`;
  if (locale === 'uk') return `/uk/news/${slug}`;
  return `/aktualnosci/${slug}`;
}

function listHref(locale: Locale): string {
  if (locale === 'en') return '/en/news';
  if (locale === 'uk') return '/uk/news';
  return '/aktualnosci';
}

export default function ArticleListPageContent({
  locale,
  t,
}: {
  locale: Locale;
  t: Translations;
}) {
  const articles = getAllArticles();

  return (
    <main className="max-w-2xl mx-auto px-4 py-10">
      <h1 className="text-3xl font-bold mb-8">{t.news.title}</h1>

      {articles.length === 0 ? (
        <p className="text-gray-500">{t.news.noArticles}</p>
      ) : (
        <ul className="space-y-6">
          {articles.map(article => (
            <li key={article.slug} className="border-b pb-6 last:border-0">
              <Link href={articleHref(article.slug, locale)} className="group">
                <p className="text-xs text-gray-400 mb-1">{article.date}</p>
                <h2 className="text-lg font-semibold group-hover:underline">
                  {article.auto ? t.news.priceSummaryTitle : article.title}
                </h2>
                {!article.auto && article.excerpt && (
                  <p className="text-sm text-gray-600 mt-1 line-clamp-2">{article.excerpt}</p>
                )}
                <span className="text-sm text-blue-600 mt-2 inline-block group-hover:underline">
                  {t.news.readMore}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-6 text-xs text-gray-400">
        <Link href={listHref(locale)} className="hover:underline">{t.news.title}</Link>
      </p>
    </main>
  );
}
