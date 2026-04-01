import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { translations } from '../../../../lib/i18n';
import { getArticleBySlug } from '../../../../lib/articles';
import ArticlePageContent from '../../../../components/pages/ArticlePageContent';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = getArticleBySlug(slug);
  if (!article) return { title: 'Not found — Litro' };
  if (article.auto) return {
    title: 'Weekly ORLEN fuel prices — Litro',
    openGraph: { title: 'Weekly ORLEN fuel prices', type: 'article', url: 'https://litro.app/en/news/tygodniowe-ceny-paliw' },
  };
  return {
    title:       `${article.title} — Litro`,
    description: article.excerpt,
    openGraph: {
      title:       article.title,
      description: article.excerpt,
      type:        'article',
      url:         `https://litro.app/en/news/${article.slug}`,
    },
  };
}

export default async function EnNewsArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = getArticleBySlug(slug);
  if (!article) notFound();

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
      <ArticlePageContent article={article} locale="en" t={translations.en} />
    </>
  );
}
