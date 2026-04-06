import type { Metadata } from 'next';
import { translations } from '../../../lib/i18n';
import DownloadPageContent from '../../../components/pages/DownloadPageContent';

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Завантажити Litro' };
}

export default function DownloadUkPage() {
  return <DownloadPageContent locale="uk" t={translations.uk} />;
}
