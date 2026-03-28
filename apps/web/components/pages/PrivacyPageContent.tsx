import type { Locale, Translations } from '../../lib/i18n';
import Footer from '../Footer';

interface Props {
  locale: Locale;
  t: Translations;
}

export default function PrivacyPageContent({ locale, t }: Props) {
  const isPl = locale === 'pl';
  return (
    <>
      <div className="flex-1 max-w-3xl mx-auto w-full px-4 py-10 lg:py-16">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">{t.legal.privacyTitle}</h1>
        <p className="text-sm text-gray-400 mb-8">
          {isPl ? 'Ostatnia aktualizacja: marzec 2026' : locale === 'uk' ? 'Остання оновлення: березень 2026' : 'Last updated: March 2026'}
        </p>

        <div className="prose prose-sm max-w-none text-gray-600">
          <p className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-amber-800 text-sm mb-8">
            {t.legal.stub}
          </p>

          {isPl ? (
            <>
              <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-2">1. Administrator danych</h2>
              <p>Administratorem danych osobowych jest Litro (kontakt: kontakt@litro.app).</p>
              <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-2">2. Zakres zbieranych danych</h2>
              <p>Zbieramy wyłącznie dane niezbędne do świadczenia usługi: adres e-mail przy rejestracji, dane lokalizacyjne za wyraźną zgodą, ceny paliw zgłaszane przez użytkowników.</p>
              <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-2">3. Cel przetwarzania</h2>
              <p>Dane przetwarzamy wyłącznie w celu świadczenia usługi Litro.</p>
              <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-2">4. Prawa użytkownika</h2>
              <p>Masz prawo dostępu do danych, ich sprostowania, usunięcia oraz przenoszenia. Skontaktuj się: kontakt@litro.app.</p>
              <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-2">5. Pliki cookie</h2>
              <p>Używamy wyłącznie technicznego pliku cookie &quot;locale&quot; do zapamiętania języka interfejsu.</p>
            </>
          ) : locale === 'uk' ? (
            <>
              <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-2">1. Адміністратор даних</h2>
              <p>Адміністратором персональних даних є Litro (контакт: contact@litro.app).</p>
              <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-2">2. Обсяг зібраних даних</h2>
              <p>Ми збираємо лише дані, необхідні для надання послуги: адресу електронної пошти при реєстрації, дані геолокації за явною згодою, ціни на пальне, надані користувачами.</p>
              <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-2">3. Мета обробки</h2>
              <p>Ми обробляємо дані виключно для надання послуги Litro.</p>
              <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-2">4. Права користувача</h2>
              <p>Ви маєте право на доступ, виправлення, видалення та перенесення своїх даних. Зверніться: contact@litro.app.</p>
              <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-2">5. Файли cookie</h2>
              <p>Ми використовуємо лише технічний файл cookie &quot;locale&quot; для збереження мови інтерфейсу.</p>
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-2">1. Data controller</h2>
              <p>The data controller is Litro (contact: contact@litro.app).</p>
              <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-2">2. Data collected</h2>
              <p>We collect only data necessary to provide the service: email address at registration, location data with explicit consent, fuel prices submitted by users.</p>
              <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-2">3. Purpose of processing</h2>
              <p>We process data solely for the purpose of providing the Litro service.</p>
              <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-2">4. User rights</h2>
              <p>You have the right to access, rectify, delete and port your data. Contact us: contact@litro.app.</p>
              <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-2">5. Cookies</h2>
              <p>We use only a technical &quot;locale&quot; cookie to remember the interface language.</p>
            </>
          )}
        </div>
      </div>
      <Footer locale={locale} t={t} />
    </>
  );
}
