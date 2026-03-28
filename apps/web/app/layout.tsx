import type { Metadata } from 'next';
import { headers, cookies } from 'next/headers';
import './globals.css';
import Navbar from '../components/Navbar';
import { detectLocale, localeToHtmlLang, translations } from '../lib/i18n';

export const metadata: Metadata = {
  title: 'Litro — ceny paliw w Polsce',
  description: 'Aktualne ceny paliw na stacjach w całej Polsce. Dane od społeczności kierowców.',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headerList = await headers();
  const cookieStore = await cookies();
  const locale = detectLocale(
    headerList.get('accept-language'),
    cookieStore.get('locale')?.value,
  );
  const t = translations[locale];

  return (
    <html lang={localeToHtmlLang(locale)}>
      <body className="min-h-dvh flex flex-col bg-white text-gray-900 antialiased">
        <Navbar locale={locale} t={t} />
        <main className="flex-1 flex flex-col">
          {children}
        </main>
      </body>
    </html>
  );
}
