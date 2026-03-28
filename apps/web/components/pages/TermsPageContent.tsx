import type { Locale, Translations } from '../../lib/i18n';
import Footer from '../Footer';

interface Props {
  locale: Locale;
  t: Translations;
}

export default function TermsPageContent({ locale, t }: Props) {
  const isPl = locale === 'pl';
  return (
    <>
      <div className="flex-1 max-w-3xl mx-auto w-full px-4 py-10 lg:py-16">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">{t.legal.termsTitle}</h1>
        <p className="text-sm text-gray-400 mb-8">
          {isPl ? 'Ostatnia aktualizacja: marzec 2026' : locale === 'uk' ? 'Остання оновлення: березень 2026' : 'Last updated: March 2026'}
        </p>

        <div className="prose prose-sm max-w-none text-gray-600">
          <p className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-amber-800 text-sm mb-8">
            {t.legal.stub}
          </p>

          {isPl ? (
            <>
              <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-2">1. Postanowienia ogólne</h2>
              <p>Niniejszy Regulamin określa zasady korzystania z serwisu Litro dostępnego pod adresem litro.app oraz aplikacji mobilnej Litro.</p>
              <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-2">2. Usługi</h2>
              <p>Litro udostępnia narzędzie do przeglądania i zgłaszania cen paliw. Ceny zgłaszane są przez użytkowników — Litro nie gwarantuje ich aktualności ani poprawności.</p>
              <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-2">3. Obowiązki użytkownika</h2>
              <p>Użytkownik zobowiązuje się do zgłaszania wyłącznie rzeczywistych cen paliw. Zgłaszanie nieprawdziwych danych jest zabronione.</p>
              <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-2">4. Odpowiedzialność</h2>
              <p>Litro nie ponosi odpowiedzialności za decyzje podjęte na podstawie cen wyświetlanych w serwisie.</p>
              <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-2">5. Zmiany regulaminu</h2>
              <p>Litro zastrzega sobie prawo do zmiany niniejszego Regulaminu z odpowiednim wyprzedzeniem.</p>
            </>
          ) : locale === 'uk' ? (
            <>
              <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-2">1. Загальні положення</h2>
              <p>Цей Регламент визначає умови використання сервісу Litro на litro.app та мобільного додатку Litro.</p>
              <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-2">2. Послуги</h2>
              <p>Litro надає інструмент для перегляду та подачі цін на пальне. Ціни подаються користувачами — Litro не гарантує їх актуальності чи правильності.</p>
              <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-2">3. Обов&apos;язки користувача</h2>
              <p>Користувач зобов&apos;язується подавати лише реальні ціни на пальне. Подання неправдивих даних забороняється.</p>
              <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-2">4. Відповідальність</h2>
              <p>Litro не несе відповідальності за рішення, прийняті на основі цін, що відображаються в сервісі.</p>
              <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-2">5. Зміни умов</h2>
              <p>Litro залишає за собою право змінювати цей Регламент з відповідним попередженням.</p>
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-2">1. General provisions</h2>
              <p>These Terms govern the use of the Litro service at litro.app and the Litro mobile app.</p>
              <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-2">2. Services</h2>
              <p>Litro provides a tool for browsing and submitting fuel prices. Prices are submitted by users — Litro does not guarantee their accuracy or currency.</p>
              <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-2">3. User obligations</h2>
              <p>You agree to submit only real fuel prices observed at the time of filling up. Submitting false data is prohibited.</p>
              <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-2">4. Liability</h2>
              <p>Litro is not liable for decisions made based on prices displayed in the service.</p>
              <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-2">5. Changes to terms</h2>
              <p>Litro reserves the right to modify these Terms with appropriate notice.</p>
            </>
          )}
        </div>
      </div>
      <Footer locale={locale} t={t} />
    </>
  );
}
