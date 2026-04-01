import type { Metadata } from 'next';
import { headers, cookies } from 'next/headers';
import { detectLocale, translations } from '../../lib/i18n';
import ArticleListPageContent from '../../components/pages/ArticleListPageContent';

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Aktualności — Litro' };
}

export default async function AktualnosciPage() {
  const headerList = await headers();
  const cookieStore = await cookies();
  const locale = detectLocale(
    headerList.get('accept-language'),
    cookieStore.get('locale')?.value,
  );
  return <ArticleListPageContent locale={locale} t={translations[locale]} />;
}
