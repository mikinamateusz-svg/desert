import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'desert — admin',
  description: 'desert ops admin panel',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
