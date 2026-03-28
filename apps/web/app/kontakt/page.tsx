import type { Metadata } from 'next';
import { headers, cookies } from 'next/headers';
import { detectLocale, translations } from '../../lib/i18n';
import ContactPageContent from '../../components/pages/ContactPageContent';

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Kontakt — Litro' };
}

export default async function ContactPage() {
  const headerList = await headers();
  const cookieStore = await cookies();
  const locale = detectLocale(
    headerList.get('accept-language'),
    cookieStore.get('locale')?.value,
  );
  return <ContactPageContent locale={locale} t={translations[locale]} />;
}
