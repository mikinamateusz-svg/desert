import Link from 'next/link';
import { detectLocale, getTranslations } from '../../lib/i18n';
import { logoutAction } from '../login/actions';

interface NavItem {
  href: string;
  label: string;
}

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const locale = await detectLocale();
  const t = getTranslations(locale);

  const navItems: NavItem[] = [
    { href: '/submissions', label: t.nav.submissions },
    { href: '/users', label: t.nav.users },
    { href: '/dead-letter', label: t.nav.deadLetter },
    { href: '/stations', label: t.nav.stations },
    { href: '/station-claims', label: t.nav.stationClaims },
    { href: '/station-sync', label: t.nav.stationSync },
    { href: '/metrics', label: t.nav.metrics },
  ];

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="flex w-56 flex-col border-r border-gray-200 bg-white">
        <div className="flex h-14 items-center border-b border-gray-200 px-4">
          <span className="text-sm font-semibold tracking-tight text-gray-900">desert / admin</span>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3">
          <ul className="space-y-0.5">
            {navItems.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="block rounded-md px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 hover:text-gray-900"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="border-t border-gray-200 p-2">
          <form action={logoutAction}>
            <button
              type="submit"
              className="w-full rounded-md px-3 py-2 text-left text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-900"
            >
              {t.common.logout}
            </button>
          </form>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto p-8">{children}</main>
    </div>
  );
}
