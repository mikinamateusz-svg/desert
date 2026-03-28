import type { Metadata } from 'next';
import { translations } from '../../../lib/i18n';
import PrivacyPageContent from '../../../components/pages/PrivacyPageContent';

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Політика конфіденційності — Litro' };
}

export default function PrivacyUkPage() {
  return <PrivacyPageContent locale="uk" t={translations.uk} />;
}
