import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'desert — fuel prices',
  description: 'Community-sourced fuel prices across Poland',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}
