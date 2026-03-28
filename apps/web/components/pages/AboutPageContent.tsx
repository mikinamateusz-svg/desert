import Link from 'next/link';
import type { Locale, Translations } from '../../lib/i18n';
import Footer from '../Footer';

interface Props {
  locale: Locale;
  t: Translations;
}

export default function AboutPageContent({ locale, t }: Props) {
  const a = t.about;
  return (
    <>
      <div className="flex-1">
        {/* Hero */}
        <section className="bg-blue-600 text-white px-4 py-16 lg:py-24 text-center">
          <h1 className="text-3xl lg:text-5xl font-bold mb-4">{a.hero}</h1>
          <p className="text-lg lg:text-xl text-blue-100 max-w-2xl mx-auto">{a.heroSub}</p>
        </section>

        {/* How it works */}
        <section className="max-w-4xl mx-auto px-4 py-12 lg:py-16">
          <h2 className="text-2xl font-bold text-gray-900 mb-8 text-center">{a.howTitle}</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { num: '1', title: a.step1Title, body: a.step1 },
              { num: '2', title: a.step2Title, body: a.step2 },
              { num: '3', title: a.step3Title, body: a.step3 },
            ].map(step => (
              <div key={step.num} className="text-center">
                <div className="w-12 h-12 bg-blue-600 text-white rounded-full flex items-center justify-center text-xl font-bold mx-auto mb-4">
                  {step.num}
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">{step.title}</h3>
                <p className="text-sm text-gray-500">{step.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Why Litro */}
        <section className="bg-gray-50 px-4 py-12 lg:py-16">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl font-bold text-gray-900 mb-8 text-center">{a.whyTitle}</h2>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[a.feature1, a.feature2, a.feature3, a.feature4].map((f, i) => (
                <li key={i} className="flex items-start gap-3 bg-white rounded-xl p-4 shadow-sm">
                  <svg className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-sm text-gray-700">{f}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* CTA */}
        <section className="max-w-4xl mx-auto px-4 py-12 lg:py-16 text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">{a.ctaTitle}</h2>
          <p className="text-gray-500 mb-6">{a.ctaSub}</p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 bg-blue-600 text-white text-sm font-semibold px-6 py-3 rounded-xl hover:bg-blue-700 transition-colors"
          >
            {a.ctaButton}
          </Link>
        </section>
      </div>
      <Footer locale={locale} t={t} />
    </>
  );
}
