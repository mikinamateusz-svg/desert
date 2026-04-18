import Link from 'next/link';
import type { Locale, Translations } from '../lib/i18n';

interface Props {
  locale: Locale;
  t: Translations;
}

export default function Footer({ locale, t }: Props) {
  const aboutHref = locale === 'en' ? '/en/about' : locale === 'uk' ? '/uk/about' : '/o-nas';
  const contactHref = locale === 'en' ? '/en/contact' : locale === 'uk' ? '/uk/contact' : '/kontakt';
  const downloadHref = locale === 'en' ? '/en/download' : locale === 'uk' ? '/uk/download' : '/pobierz';
  const privacyHref = locale === 'en' ? '/en/privacy' : locale === 'uk' ? '/uk/privacy' : '/polityka-prywatnosci';
  const termsHref = locale === 'en' ? '/en/terms' : locale === 'uk' ? '/uk/terms' : '/regulamin';

  return (
    <footer className="bg-surface-page border-t border-neutral-border mt-auto">
      <div className="max-w-6xl mx-auto px-4 lg:px-6 py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <span className="text-lg font-bold text-brand-ink">Litro</span>
            <p className="mt-1.5 text-sm text-gray-500">{t.footer.tagline}</p>
          </div>

          {/* Litro — product links */}
          <div>
            <h3 className="text-xs font-semibold text-gray-900 uppercase tracking-wider mb-3">
              {t.footer.product}
            </h3>
            <ul className="space-y-2 text-sm text-gray-600">
              <li><Link href="/" className="hover:text-gray-900 transition-colors">{t.nav.map}</Link></li>
              <li><Link href={downloadHref} className="hover:text-gray-900 transition-colors">{t.nav.getApp}</Link></li>
            </ul>
          </div>

          {/* About us */}
          <div>
            <h3 className="text-xs font-semibold text-gray-900 uppercase tracking-wider mb-3">
              {t.footer.company}
            </h3>
            <ul className="space-y-2 text-sm text-gray-600">
              <li><Link href={aboutHref} className="hover:text-gray-900 transition-colors">{t.footer.about}</Link></li>
              <li><Link href={contactHref} className="hover:text-gray-900 transition-colors">{t.footer.contact}</Link></li>
            </ul>
          </div>

          {/* Documents */}
          <div>
            <h3 className="text-xs font-semibold text-gray-900 uppercase tracking-wider mb-3">
              {t.footer.legal}
            </h3>
            <ul className="space-y-2 text-sm text-gray-600">
              <li>
                <Link href={privacyHref} className="hover:text-gray-900 transition-colors">
                  {t.footer.privacy}
                </Link>
              </li>
              <li>
                <Link href={termsHref} className="hover:text-gray-900 transition-colors">
                  {t.footer.terms}
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-gray-400">{t.footer.copyright}</p>
          <div className="flex items-center gap-1">
            {(['pl', 'en', 'uk'] as Locale[]).map(l => (
              l === locale ? (
                <span key={l} className="px-2.5 py-1 rounded-full text-xs font-semibold uppercase border border-brand-accent bg-amber-50 text-brand-accent">{l}</span>
              ) : (
                <a key={l} href={`/api/set-locale?l=${l}`} className="px-2.5 py-1 rounded-full text-xs font-medium uppercase border border-gray-200 text-gray-400 hover:text-gray-900 hover:border-gray-400 transition-colors">
                  {l}
                </a>
              )
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
