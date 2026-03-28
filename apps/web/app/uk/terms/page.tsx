import type { Metadata } from 'next';
import { translations } from '../../../lib/i18n';
import TermsPageContent from '../../../components/pages/TermsPageContent';

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Умови використання — Litro' };
}

export default function TermsUkPage() {
  return <TermsPageContent locale="uk" t={translations.uk} />;
}
