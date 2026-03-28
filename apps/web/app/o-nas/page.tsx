import type { Metadata } from 'next';
import { headers, cookies } from 'next/headers';
import { detectLocale, translations } from '../../lib/i18n';
import AboutPageContent from '../../components/pages/AboutPageContent';

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'O nas — Litro' };
}

export default async function AboutPage() {
  const headerList = await headers();
  const cookieStore = await cookies();
  const locale = detectLocale(
    headerList.get('accept-language'),
    cookieStore.get('locale')?.value,
  );
  return <AboutPageContent locale={locale} t={translations[locale]} />;
}
