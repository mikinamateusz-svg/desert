import type { Metadata } from 'next';
import { translations } from '../../../lib/i18n';
import ContactPageContent from '../../../components/pages/ContactPageContent';

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Контакт — Litro' };
}

export default function ContactUkPage() {
  return <ContactPageContent locale="uk" t={translations.uk} />;
}
