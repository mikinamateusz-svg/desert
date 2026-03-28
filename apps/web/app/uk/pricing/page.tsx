import type { Metadata } from 'next';
import { translations } from '../../../lib/i18n';
import PricingPageContent from '../../../components/pages/PricingPageContent';

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Ціни — Litro' };
}

export default function PricingUkPage() {
  return <PricingPageContent locale="uk" t={translations.uk} />;
}
