import type { Metadata } from 'next';
import { detectLocale } from '../lib/i18n';
import './globals.css';

export const metadata: Metadata = {
  title: 'desert — partner portal',
  description: 'Claim and manage your fuel station on desert.',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await detectLocale();
  return (
    <html lang={locale}>
      <body>{children}</body>
    </html>
  );
}
