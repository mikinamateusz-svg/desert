import type { Metadata } from 'next';
import { headers, cookies } from 'next/headers';
import { detectLocale, translations } from '../../lib/i18n';
import DownloadPageContent from '../../components/pages/DownloadPageContent';

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Pobierz Litro' };
}

export default async function DownloadPage() {
  const headerList = await headers();
  const cookieStore = await cookies();
  const locale = detectLocale(
    headerList.get('accept-language'),
    cookieStore.get('locale')?.value,
  );
  return <DownloadPageContent locale={locale} t={translations[locale]} />;
}
