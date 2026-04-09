'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import type { Locale, Translations } from '../lib/i18n';
import { LitroWordmark } from './LitroWordmark';

interface Props {
  locale: Locale;
  t: Translations;
}

const NAV_LINKS = (t: Translations, locale: Locale) => [
  { href: '/', label: t.nav.map },
  { href: locale === 'en' ? '/en/about' : locale === 'uk' ? '/uk/about' : '/o-nas', label: t.nav.about },
  { href: locale === 'en' ? '/en/contact' : locale === 'uk' ? '/uk/contact' : '/kontakt', label: t.nav.contact },
  // { href: locale === 'en' ? '/en/pricing' : locale === 'uk' ? '/uk/pricing' : '/cennik', label: t.nav.pricing },
];

export default function Navbar({ locale, t }: Props) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 h-16 bg-white border-b border-gray-200 flex items-center px-4 lg:px-6">
      {/* Logo */}
      <Link href="/" className="flex items-center gap-2 mr-8 flex-shrink-0">
        <LitroWordmark height={22} />
        <span className="hidden sm:inline text-xs text-gray-400 font-normal">ceny paliw</span>
      </Link>

      {/* Desktop nav */}
      <nav className="hidden md:flex items-center gap-1 flex-1">
        {NAV_LINKS(t, locale).map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              pathname === href
                ? 'bg-amber-50 text-brand-ink font-semibold'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            {label}
          </Link>
        ))}
      </nav>

      {/* Right side */}
      <div className="flex items-center gap-2 ml-auto">
        {/* Lang switcher */}
        <div className="hidden sm:flex items-center gap-0.5 text-xs text-gray-500">
          {(['pl', 'en', 'uk'] as Locale[]).map((l, i) => (
            <span key={l} className="flex items-center">
              {i > 0 && <span className="mx-0.5 text-gray-300">|</span>}
              {l === locale ? (
                <span className="font-semibold text-gray-900 uppercase">{l}</span>
              ) : (
                <a
                  href={`/api/set-locale?l=${l}`}
                  className="uppercase hover:text-gray-900 transition-colors"
                >
                  {l}
                </a>
              )}
            </span>
          ))}
        </div>

        {/* Get the app CTA */}
        <a
          href={locale === 'en' ? '/en/download' : locale === 'uk' ? '/uk/download' : '/pobierz'}
          className="hidden sm:inline-flex items-center gap-1.5 bg-brand-ink text-white text-sm font-medium px-3.5 py-1.5 rounded-lg hover:bg-brand-ink-hover transition-colors"
        >
          {t.nav.getApp}
        </a>

        {/* Mobile hamburger */}
        <button
          className="md:hidden inline-flex items-center justify-center p-2 rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-100"
          onClick={() => setMenuOpen(o => !o)}
          aria-label={t.nav.menu}
          aria-expanded={menuOpen}
        >
          {menuOpen ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="absolute top-16 left-0 right-0 bg-white border-b border-gray-200 shadow-lg md:hidden z-50">
          <nav className="px-4 py-3 flex flex-col gap-1">
            {NAV_LINKS(t, locale).map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setMenuOpen(false)}
                className={`px-3 py-2.5 rounded-md text-sm font-medium ${
                  pathname === href
                    ? 'bg-amber-50 text-brand-ink font-semibold'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                {label}
              </Link>
            ))}
            <div className="border-t border-gray-100 mt-2 pt-2 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-gray-500">
                {(['pl', 'en', 'uk'] as Locale[]).map(l => (
                  l === locale ? (
                    <span key={l} className="font-semibold text-gray-900 uppercase">{l}</span>
                  ) : (
                    <a key={l} href={`/api/set-locale?l=${l}`} className="uppercase hover:text-gray-900">
                      {l}
                    </a>
                  )
                ))}
              </div>
              <a
                href={locale === 'en' ? '/en/download' : locale === 'uk' ? '/uk/download' : '/pobierz'}
                className="bg-brand-ink text-white text-sm font-medium px-3 py-1.5 rounded-lg"
              >
                {t.nav.getApp}
              </a>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
