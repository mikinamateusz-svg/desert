import { detectLocale, getTranslations } from '../../lib/i18n';
import { loginAction } from './actions';
import LoginForm from './LoginForm';

export default async function LoginPage() {
  const locale = await detectLocale();
  const t = getTranslations(locale);

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-8 text-center text-2xl font-bold tracking-tight text-gray-900">
          desert <span className="font-normal text-gray-500">/ {t.login.title}</span>
        </h1>
        <LoginForm t={t.login} action={loginAction} />
      </div>
    </main>
  );
}
