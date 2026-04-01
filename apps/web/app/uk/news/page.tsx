import type { Metadata } from 'next';
import { translations } from '../../../lib/i18n';
import ArticleListPageContent from '../../../components/pages/ArticleListPageContent';

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Новини — Litro' };
}

export default function UkNewsPage() {
  return <ArticleListPageContent locale="uk" t={translations.uk} />;
}
