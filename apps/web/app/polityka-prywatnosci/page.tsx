import type { Metadata } from 'next';
import { headers, cookies } from 'next/headers';
import { detectLocale, translations } from '../../lib/i18n';
import PrivacyPageContent from '../../components/pages/PrivacyPageContent';

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Polityka prywatności — Litro' };
}

export default async function PrivacyPage() {
  const headerList = await headers();
  const cookieStore = await cookies();
  const locale = detectLocale(
    headerList.get('accept-language'),
    cookieStore.get('locale')?.value,
  );
  return <PrivacyPageContent locale={locale} t={translations[locale]} />;
}
