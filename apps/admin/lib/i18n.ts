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
    review: {
      flagReason: { logo_mismatch: 'Niezgodność logo', low_trust: 'Niskie zaufanie' },
      columns: {
        station: 'Stacja',
        prices: 'Ceny',
        confidence: 'Pewność OCR',
        submitted: 'Zgłoszono',
        contributor: 'Zgłaszający',
        flag: 'Powód flagi',
      },
      noItems: 'Brak zgłoszeń do przeglądu.',
      approve: 'Zatwierdź',
      reject: 'Odrzuć',
      rejectNotesLabel: 'Powód odrzucenia (opcjonalnie)',
      rejectConfirm: 'Potwierdź odrzucenie',
      cancel: 'Anuluj',
      back: '← Powrót',
      approvedSuccess: 'Zgłoszenie zatwierdzone.',
      rejectedSuccess: 'Zgłoszenie odrzucone.',
      errorGeneric: 'Błąd. Spróbuj ponownie.',
      errorConflict: 'To zgłoszenie zostało już rozpatrzone.',
      stationLabel: 'Stacja',
      brandLabel: 'Marka stacji',
      flagLabel: 'Powód flagi',
      confidenceLabel: 'Pewność OCR',
      submittedLabel: 'Data zgłoszenia',
      contributorLabel: 'ID zgłaszającego',
      unknown: 'Nieznana',
      na: 'n/d',
      photoLabel: 'Zdjęcie',
      photoExpires: 'Link wygasa za 1 godz.',
      gpsLabel: 'Lokalizacja GPS',
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
    review: {
      flagReason: { logo_mismatch: 'Logo mismatch', low_trust: 'Low trust score' },
      columns: {
        station: 'Station',
        prices: 'Prices',
        confidence: 'OCR confidence',
        submitted: 'Submitted',
        contributor: 'Contributor',
        flag: 'Flag reason',
      },
      noItems: 'No submissions awaiting review.',
      approve: 'Approve',
      reject: 'Reject',
      rejectNotesLabel: 'Rejection reason (optional)',
      rejectConfirm: 'Confirm rejection',
      cancel: 'Cancel',
      back: '← Back',
      approvedSuccess: 'Submission approved.',
      rejectedSuccess: 'Submission rejected.',
      errorGeneric: 'Something went wrong. Try again.',
      errorConflict: 'This submission has already been reviewed.',
      stationLabel: 'Station',
      brandLabel: 'Station brand',
      flagLabel: 'Flag reason',
      confidenceLabel: 'OCR confidence',
      submittedLabel: 'Submitted',
      contributorLabel: 'Contributor ID',
      unknown: 'Unknown',
      na: 'n/a',
      photoLabel: 'Photo',
      photoExpires: 'Link expires in 1 hour',
      gpsLabel: 'GPS location',
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
    review: {
      flagReason: { logo_mismatch: 'Невідповідність логотипу', low_trust: 'Низький рейтинг довіри' },
      columns: {
        station: 'Станція',
        prices: 'Ціни',
        confidence: 'Точність OCR',
        submitted: 'Подано',
        contributor: 'Автор',
        flag: 'Причина позначки',
      },
      noItems: 'Немає заявок для перегляду.',
      approve: 'Затвердити',
      reject: 'Відхилити',
      rejectNotesLabel: 'Причина відхилення (необов\'язково)',
      rejectConfirm: 'Підтвердити відхилення',
      cancel: 'Скасувати',
      back: '← Назад',
      approvedSuccess: 'Заявку затверджено.',
      rejectedSuccess: 'Заявку відхилено.',
      errorGeneric: 'Помилка. Спробуйте ще раз.',
      errorConflict: 'Цю заявку вже розглянуто.',
      stationLabel: 'Станція',
      brandLabel: 'Бренд станції',
      flagLabel: 'Причина позначки',
      confidenceLabel: 'Точність OCR',
      submittedLabel: 'Дата подання',
      contributorLabel: 'ID автора',
      unknown: 'Невідомо',
      na: 'н/д',
      photoLabel: 'Фото',
      photoExpires: 'Посилання діє 1 год',
      gpsLabel: 'GPS-локація',
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
  review: {
    flagReason: Record<string, string>;
    columns: {
      station: string;
      prices: string;
      confidence: string;
      submitted: string;
      contributor: string;
      flag: string;
    };
    noItems: string;
    approve: string;
    reject: string;
    rejectNotesLabel: string;
    rejectConfirm: string;
    cancel: string;
    back: string;
    approvedSuccess: string;
    rejectedSuccess: string;
    errorGeneric: string;
    errorConflict: string;
    stationLabel: string;
    brandLabel: string;
    flagLabel: string;
    confidenceLabel: string;
    submittedLabel: string;
    contributorLabel: string;
    unknown: string;
    na: string;
    photoLabel: string;
    photoExpires: string;
    gpsLabel: string;
  };
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
