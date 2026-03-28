import type { Metadata } from 'next';
import { translations } from '../../../lib/i18n';
import TermsPageContent from '../../../components/pages/TermsPageContent';

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Terms of service — Litro' };
}

export default function TermsEnPage() {
  return <TermsPageContent locale="en" t={translations.en} />;
}
