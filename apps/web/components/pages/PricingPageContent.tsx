import Link from 'next/link';
import type { Locale, Translations } from '../../lib/i18n';
import Footer from '../Footer';

interface Props {
  locale: Locale;
  t: Translations;
}

function CheckIcon() {
  return (
    <svg className="w-4 h-4 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  );
}

export default function PricingPageContent({ locale, t }: Props) {
  const p = t.pricing;
  const features = p.features;
  const contactHref = locale === 'en' ? '/en/contact' : locale === 'uk' ? '/uk/contact' : '/kontakt';

  return (
    <>
      <div className="flex-1 max-w-5xl mx-auto w-full px-4 py-10 lg:py-16">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">{p.title}</h1>
          <p className="text-gray-500 max-w-xl mx-auto">{p.subtitle}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Free */}
          <div className="border border-gray-200 rounded-2xl p-6 flex flex-col">
            <h2 className="text-lg font-bold text-gray-900">{p.free}</h2>
            <p className="text-sm text-gray-500 mt-1 mb-4">{p.freeDesc}</p>
            <div className="text-3xl font-bold text-gray-900 mb-6">
              0 <span className="text-base font-normal text-gray-400">zł/mies.</span>
            </div>
            <ul className="space-y-2 flex-1">
              {features.free.map(f => (
                <li key={f} className="flex items-center gap-2 text-sm text-gray-600">
                  <CheckIcon /> {f}
                </li>
              ))}
            </ul>
            <Link
              href="/"
              className="mt-6 block text-center text-sm font-semibold bg-brand-ink text-white px-4 py-3 rounded-xl hover:bg-brand-ink-hover transition-colors"
            >
              {t.nav.map}
            </Link>
          </div>

          {/* Pro */}
          <div className="border-2 border-brand-accent rounded-2xl p-6 flex flex-col relative">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2">
              <span className="bg-brand-accent text-brand-ink text-xs font-semibold px-3 py-1 rounded-full">Popular</span>
            </div>
            <h2 className="text-lg font-bold text-gray-900">{p.pro}</h2>
            <p className="text-sm text-gray-500 mt-1 mb-4">{p.proDesc}</p>
            <div className="text-3xl font-bold text-gray-900 mb-2">
              — <span className="text-base font-normal text-gray-400">{p.comingSoon}</span>
            </div>
            <ul className="space-y-2 flex-1 mt-4">
              {features.pro.map(f => (
                <li key={f} className="flex items-center gap-2 text-sm text-gray-600">
                  <CheckIcon /> {f}
                </li>
              ))}
            </ul>
            <button
              disabled
              className="mt-6 block w-full text-center text-sm font-semibold bg-gray-100 text-gray-400 px-4 py-3 rounded-xl cursor-not-allowed"
            >
              {p.comingSoon}
            </button>
          </div>

          {/* Fleet */}
          <div className="border border-gray-200 rounded-2xl p-6 flex flex-col">
            <h2 className="text-lg font-bold text-gray-900">{p.fleet}</h2>
            <p className="text-sm text-gray-500 mt-1 mb-4">{p.fleetDesc}</p>
            <div className="text-3xl font-bold text-gray-900 mb-6">
              — <span className="text-base font-normal text-gray-400">{p.comingSoon}</span>
            </div>
            <ul className="space-y-2 flex-1">
              {features.fleet.map(f => (
                <li key={f} className="flex items-center gap-2 text-sm text-gray-600">
                  <CheckIcon /> {f}
                </li>
              ))}
            </ul>
            <Link
              href={contactHref}
              className="mt-6 block text-center text-sm font-semibold border border-gray-300 text-gray-700 px-4 py-3 rounded-xl hover:bg-gray-50 transition-colors"
            >
              {p.contact}
            </Link>
          </div>
        </div>
      </div>
      <Footer locale={locale} t={t} />
    </>
  );
}
