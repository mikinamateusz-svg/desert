import type { Metadata } from 'next';
import { translations } from '../../../lib/i18n';
import ContactPageContent from '../../../components/pages/ContactPageContent';

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Contact — Litro' };
}

export default function ContactEnPage() {
  return <ContactPageContent locale="en" t={translations.en} />;
}
