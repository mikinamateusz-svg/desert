import Link from 'next/link';
import { detectLocale, getTranslations } from '../../lib/i18n';
import { logoutAction } from '../login/actions';

export default async function PartnerLayout({ children }: { children: React.ReactNode }) {
  const locale = await detectLocale();
  const t = getTranslations(locale);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <span className="text-sm font-semibold tracking-tight text-gray-900">
              desert / partner
            </span>
            <nav className="flex items-center gap-4">
              <Link
                href="/home"
                className="text-sm text-gray-700 hover:text-gray-900"
              >
                {t.nav.home}
              </Link>
              <Link
                href="/claim"
                className="text-sm text-gray-700 hover:text-gray-900"
              >
                {t.nav.claim}
              </Link>
            </nav>
          </div>
          <form action={logoutAction}>
            <button
              type="submit"
              className="text-sm text-gray-500 hover:text-gray-900"
            >
              {t.nav.logout}
            </button>
          </form>
        </div>
      </header>
      <main className="max-w-5xl mx-auto p-6">{children}</main>
    </div>
  );
}
