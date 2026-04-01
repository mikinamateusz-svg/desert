import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { headers, cookies } from 'next/headers';
import { detectLocale, translations } from '../../../lib/i18n';
import { getArticleBySlug } from '../../../lib/articles';
import ArticlePageContent from '../../../components/pages/ArticlePageContent';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = getArticleBySlug(slug);
  if (!article) return { title: 'Nie znaleziono — Litro' };
  if (article.auto) return {
    title: 'Tygodniowe ceny paliw ORLEN — Litro',
    openGraph: { title: 'Tygodniowe ceny paliw ORLEN', type: 'article', url: 'https://litro.app/aktualnosci/tygodniowe-ceny-paliw' },
  };
  return {
    title:       `${article.title} — Litro`,
    description: article.excerpt,
    openGraph: {
      title:       article.title,
      description: article.excerpt,
      type:        'article',
      url:         `https://litro.app/aktualnosci/${article.slug}`,
    },
  };
}

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = getArticleBySlug(slug);
  if (!article) notFound();

  const headerList = await headers();
  const cookieStore = await cookies();
  const locale = detectLocale(
    headerList.get('accept-language'),
    cookieStore.get('locale')?.value,
  );

  const jsonLd = article.auto ? null : {
    '@context':    'https://schema.org',
    '@type':       'Article',
    headline:      article.title,
    datePublished: article.date,
    description:   article.excerpt,
    publisher:     { '@type': 'Organization', name: 'Litro' },
  };

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      <ArticlePageContent article={article} locale={locale} t={translations[locale]} />
    </>
  );
}
