import type { Metadata } from 'next';
import { headers, cookies } from 'next/headers';
import { detectLocale, translations } from '../../lib/i18n';
import TermsPageContent from '../../components/pages/TermsPageContent';

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Regulamin — Litro' };
}

export default async function TermsPage() {
  const headerList = await headers();
  const cookieStore = await cookies();
  const locale = detectLocale(
    headerList.get('accept-language'),
    cookieStore.get('locale')?.value,
  );
  return <TermsPageContent locale={locale} t={translations[locale]} />;
}
