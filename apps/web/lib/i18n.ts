export type Locale = 'pl' | 'en' | 'uk';

export function detectLocale(acceptLanguage: string | null): Locale {
  if (!acceptLanguage) return 'pl';
  const lang = acceptLanguage.split(',')[0]?.split('-')[0]?.toLowerCase();
  if (lang === 'uk') return 'uk';
  if (lang === 'en') return 'en';
  return 'pl';
}

export interface Translations {
  pageTitle: string;
  contribute: string;
  contributePrompt: string;
  contributePromptTitle: string;
  close: string;
  noData: string;
  updatedAt: string;
  fuelTypes: Record<string, string>;
  estimated: string;
}

export const translations: Record<Locale, Translations> = {
  pl: {
    pageTitle: 'Ceny paliw — desert',
    contribute: 'Dodaj cenę',
    contributePrompt: 'Utwórz konto, aby dodawać aktualne ceny paliw w swojej okolicy.',
    contributePromptTitle: 'Zaloguj się, aby dodać cenę',
    close: 'Zamknij',
    noData: 'Brak danych o cenach',
    updatedAt: 'Zaktualizowano',
    fuelTypes: {
      PB_95: 'PB 95',
      PB_98: 'PB 98',
      ON: 'ON',
      ON_PREMIUM: 'ON Premium',
      LPG: 'LPG',
    },
    estimated: 'szacunkowa',
  },
  en: {
    pageTitle: 'Fuel prices — desert',
    contribute: 'Add price',
    contributePrompt: 'Create an account to contribute current fuel prices in your area.',
    contributePromptTitle: 'Sign in to add a price',
    close: 'Close',
    noData: 'No price data',
    updatedAt: 'Updated',
    fuelTypes: {
      PB_95: 'Petrol 95',
      PB_98: 'Petrol 98',
      ON: 'Diesel',
      ON_PREMIUM: 'Premium Diesel',
      LPG: 'LPG',
    },
    estimated: 'estimated',
  },
  uk: {
    pageTitle: 'Ціни на пальне — desert',
    contribute: 'Додати ціну',
    contributePrompt: 'Створіть обліковий запис, щоб додавати актуальні ціни на пальне у вашому районі.',
    contributePromptTitle: 'Увійдіть, щоб додати ціну',
    close: 'Закрити',
    noData: 'Немає даних про ціни',
    updatedAt: 'Оновлено',
    fuelTypes: {
      PB_95: 'Бензин 95',
      PB_98: 'Бензин 98',
      ON: 'Дизель',
      ON_PREMIUM: 'Преміум дизель',
      LPG: 'LPG',
    },
    estimated: 'орієнтовна',
  },
};
