import Link from 'next/link';
import { detectLocale, getTranslations } from '../../lib/i18n';
import { LoginForm } from './LoginForm';

export default async function LoginPage() {
  const locale = await detectLocale();
  const t = getTranslations(locale);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-md shadow-sm p-6">
        <h1 className="text-2xl font-semibold text-gray-900">{t.login.title}</h1>
        <p className="mt-1 text-sm text-gray-500 mb-6">{t.login.subtitle}</p>
        <LoginForm t={t.login} />
        <div className="mt-4 text-center">
          <Link href="/register" className="text-sm text-blue-600 hover:underline">
            {t.login.registerLink}
          </Link>
        </div>
      </div>
    </div>
  );
}
