import type { Metadata } from 'next';
import { translations } from '../../../lib/i18n';
import PrivacyPageContent from '../../../components/pages/PrivacyPageContent';

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Privacy policy — Litro' };
}

export default function PrivacyEnPage() {
  return <PrivacyPageContent locale="en" t={translations.en} />;
}
