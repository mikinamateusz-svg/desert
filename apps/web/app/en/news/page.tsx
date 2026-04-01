import type { Metadata } from 'next';
import { translations } from '../../../lib/i18n';
import ArticleListPageContent from '../../../components/pages/ArticleListPageContent';

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'News — Litro' };
}

export default function NewsPage() {
  return <ArticleListPageContent locale="en" t={translations.en} />;
}
