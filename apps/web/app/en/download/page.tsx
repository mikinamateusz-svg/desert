import type { Metadata } from 'next';
import { translations } from '../../../lib/i18n';
import DownloadPageContent from '../../../components/pages/DownloadPageContent';

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Download Litro' };
}

export default function DownloadEnPage() {
  return <DownloadPageContent locale="en" t={translations.en} />;
}
