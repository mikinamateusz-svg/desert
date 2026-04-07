import type { Locale, Translations } from '../../lib/i18n';
import Footer from '../Footer';

interface Props {
  locale: Locale;
  t: Translations;
}

export default function ContactPageContent({ locale, t }: Props) {
  const c = t.contact;
  return (
    <>
      <div className="flex-1 max-w-4xl mx-auto w-full px-4 py-10 lg:py-16">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">{c.title}</h1>
        <p className="text-gray-500 mb-10">{c.subtitle}</p>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Form */}
          <div className="lg:col-span-2">
            <form action={`mailto:${c.infoEmail}`} method="get" className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{c.name}</label>
                  <input
                    type="text"
                    name="name"
                    className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-accent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{c.email}</label>
                  <input
                    type="email"
                    name="email"
                    className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-accent"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{c.subject}</label>
                <input
                  type="text"
                  name="subject"
                  className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-accent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{c.message}</label>
                <textarea
                  name="body"
                  rows={6}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-accent resize-none"
                />
              </div>
              <button
                type="submit"
                className="bg-brand-ink text-white text-sm font-semibold px-6 py-3 rounded-xl hover:bg-brand-ink-hover transition-colors"
              >
                {c.send}
              </button>
            </form>
          </div>

          {/* Info */}
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">{c.infoTitle}</h2>
              <a href={`mailto:${c.infoEmail}`} className="text-sm text-brand-accent hover:underline">
                {c.infoEmail}
              </a>
              <p className="text-xs text-gray-400 mt-2">{c.infoResponse}</p>
            </div>
          </div>
        </div>
      </div>
      <Footer locale={locale} t={t} />
    </>
  );
}
