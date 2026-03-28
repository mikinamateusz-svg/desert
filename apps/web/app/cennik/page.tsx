import type { Metadata } from 'next';
import { headers, cookies } from 'next/headers';
import { detectLocale, translations } from '../../lib/i18n';
import PricingPageContent from '../../components/pages/PricingPageContent';

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Cennik — Litro' };
}

export default async function PricingPage() {
  const headerList = await headers();
  const cookieStore = await cookies();
  const locale = detectLocale(
    headerList.get('accept-language'),
    cookieStore.get('locale')?.value,
  );
  return <PricingPageContent locale={locale} t={translations[locale]} />;
}
