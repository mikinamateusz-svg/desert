import type { Metadata } from 'next';
import { translations } from '../../../lib/i18n';
import AboutPageContent from '../../../components/pages/AboutPageContent';

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Про нас — Litro' };
}

export default function AboutUkPage() {
  return <AboutPageContent locale="uk" t={translations.uk} />;
}
