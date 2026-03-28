import type { Metadata } from 'next';
import { translations } from '../../../lib/i18n';
import PricingPageContent from '../../../components/pages/PricingPageContent';

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Pricing — Litro' };
}

export default function PricingEnPage() {
  return <PricingPageContent locale="en" t={translations.en} />;
}
