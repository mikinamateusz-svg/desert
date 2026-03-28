import type { Metadata } from 'next';
import { translations } from '../../../lib/i18n';
import AboutPageContent from '../../../components/pages/AboutPageContent';

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'About — Litro' };
}

export default function AboutEnPage() {
  return <AboutPageContent locale="en" t={translations.en} />;
}
