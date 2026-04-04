import { cookies, headers } from 'next/headers';

export type Locale = 'pl' | 'en' | 'uk';

export const SUPPORTED_LOCALES: Locale[] = ['pl', 'en', 'uk'];
const DEFAULT_LOCALE: Locale = 'pl';

export async function detectLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get('locale')?.value;
  if (cookieLocale && SUPPORTED_LOCALES.includes(cookieLocale as Locale)) {
    return cookieLocale as Locale;
  }
  const headerStore = await headers();
  const acceptLang = headerStore.get('accept-language') ?? '';
  for (const lang of acceptLang.split(',')) {
    const code = lang.split(';')[0].trim().toLowerCase().slice(0, 2) as Locale;
    if (SUPPORTED_LOCALES.includes(code)) return code;
  }
  return DEFAULT_LOCALE;
}

const translations = {
  pl: {
    nav: {
      submissions: 'Zgłoszenia',
      users: 'Użytkownicy',
      deadLetter: 'Kolejka błędów',
      stations: 'Stacje',
      metrics: 'Metryki',
    },
    login: {
      title: 'Panel admina',
      emailLabel: 'E-mail',
      passwordLabel: 'Hasło',
      submitButton: 'Zaloguj się',
      errorInvalid: 'Nieprawidłowe dane logowania.',
      errorNotAdmin: 'Konto nie ma uprawnień administratora.',
      errorGeneric: 'Błąd logowania. Spróbuj ponownie.',
    },
    common: {
      logout: 'Wyloguj',
      loading: 'Ładowanie…',
      comingSoon: 'Wkrótce',
    },
    sections: {
      submissions: { title: 'Zgłoszenia', description: 'Przeglądaj i moderuj zgłoszenia cen paliw.' },
      users: { title: 'Użytkownicy', description: 'Zarządzaj kontami użytkowników.' },
      deadLetter: { title: 'Kolejka błędów', description: 'Przeglądaj nieprzetworzone zadania.' },
      stations: { title: 'Stacje', description: 'Zarządzaj stacjami paliw.' },
      metrics: { title: 'Metryki', description: 'Przegląd operacyjnych wskaźników produktu.' },
    },
  },
  en: {
    nav: {
      submissions: 'Submissions',
      users: 'Users',
      deadLetter: 'Dead-Letter Queue',
      stations: 'Stations',
      metrics: 'Metrics',
    },
    login: {
      title: 'Admin panel',
      emailLabel: 'Email',
      passwordLabel: 'Password',
      submitButton: 'Sign in',
      errorInvalid: 'Invalid credentials.',
      errorNotAdmin: 'This account does not have admin access.',
      errorGeneric: 'Login failed. Please try again.',
    },
    common: {
      logout: 'Log out',
      loading: 'Loading…',
      comingSoon: 'Coming soon',
    },
    sections: {
      submissions: { title: 'Submissions', description: 'Review and moderate fuel price submissions.' },
      users: { title: 'Users', description: 'Manage user accounts.' },
      deadLetter: { title: 'Dead-Letter Queue', description: 'Review unprocessed jobs.' },
      stations: { title: 'Stations', description: 'Manage fuel stations.' },
      metrics: { title: 'Metrics', description: 'Operational product metrics overview.' },
    },
  },
  uk: {
    nav: {
      submissions: 'Заявки',
      users: 'Користувачі',
      deadLetter: 'Черга помилок',
      stations: 'Станції',
      metrics: 'Метрики',
    },
    login: {
      title: 'Панель адміна',
      emailLabel: 'E-mail',
      passwordLabel: 'Пароль',
      submitButton: 'Увійти',
      errorInvalid: 'Невірні дані для входу.',
      errorNotAdmin: 'Цей акаунт не має прав адміністратора.',
      errorGeneric: 'Помилка входу. Спробуйте ще раз.',
    },
    common: {
      logout: 'Вийти',
      loading: 'Завантаження…',
      comingSoon: 'Незабаром',
    },
    sections: {
      submissions: { title: 'Заявки', description: 'Перегляд та модерація заявок на ціни палива.' },
      users: { title: 'Користувачі', description: 'Управління акаунтами користувачів.' },
      deadLetter: { title: 'Черга помилок', description: 'Перегляд необроблених задач.' },
      stations: { title: 'Станції', description: 'Управління автозаправними станціями.' },
      metrics: { title: 'Метрики', description: 'Огляд операційних показників продукту.' },
    },
  },
} as const;

export interface Translations {
  nav: { submissions: string; users: string; deadLetter: string; stations: string; metrics: string };
  login: {
    title: string;
    emailLabel: string;
    passwordLabel: string;
    submitButton: string;
    errorInvalid: string;
    errorNotAdmin: string;
    errorGeneric: string;
  };
  common: { logout: string; loading: string; comingSoon: string };
  sections: {
    submissions: { title: string; description: string };
    users: { title: string; description: string };
    deadLetter: { title: string; description: string };
    stations: { title: string; description: string };
    metrics: { title: string; description: string };
  };
}

export function getTranslations(locale: Locale): Translations {
  return translations[locale];
}
