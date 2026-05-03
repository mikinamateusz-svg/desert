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
      home: 'Moje wnioski',
      claim: 'Zgłoś stację',
      logout: 'Wyloguj',
    },
    home: {
      title: 'Panel partnera',
      subtitle: 'Zarządzaj wnioskami o swoje stacje paliw.',
      newClaimCta: 'Zgłoś nową stację',
      yourClaimsTitle: 'Twoje wnioski',
      noClaimsYet: 'Nie masz jeszcze żadnych wniosków.',
      statusPending: 'Oczekuje na review',
      statusAwaitingDocs: 'Oczekuje na dokumenty',
      statusApproved: 'Zatwierdzony',
      statusRejected: 'Odrzucony',
      submittedLabel: 'Złożono',
      rejectionLabel: 'Powód odrzucenia',
      reviewerNotesLabel: 'Notatka moderatora',
      manageStation: 'Zarządzaj stacją →',
      retrySubmit: 'Złóż wniosek ponownie',
    },
    login: {
      title: 'Panel partnera',
      subtitle: 'Zaloguj się, aby zarządzać wnioskami o stacje.',
      emailLabel: 'E-mail',
      passwordLabel: 'Hasło',
      submitButton: 'Zaloguj się',
      registerLink: 'Nie masz konta? Zarejestruj się.',
      errorInvalid: 'Nieprawidłowe dane logowania.',
      errorGeneric: 'Błąd logowania. Spróbuj ponownie.',
    },
    register: {
      title: 'Załóż konto partnera',
      subtitle: 'Utwórz konto, aby zgłosić stacje, którymi zarządzasz.',
      emailLabel: 'E-mail',
      passwordLabel: 'Hasło',
      displayNameLabel: 'Imię / nazwa firmy',
      submitButton: 'Załóż konto',
      loginLink: 'Masz już konto? Zaloguj się.',
      errorEmailExists: 'Konto z tym e-mailem już istnieje.',
      errorWeakPassword: 'Hasło musi mieć co najmniej 8 znaków.',
      errorGeneric: 'Błąd rejestracji. Spróbuj ponownie.',
    },
    claim: {
      searchTitle: 'Znajdź swoją stację',
      searchSubtitle: 'Wyszukaj po nazwie lub adresie. Następnie wybierz stację, aby zgłosić wniosek.',
      searchPlaceholder: 'np. „Orlen Łódź ul. Główna" lub kod pocztowy',
      searchButton: 'Szukaj',
      searchEmpty: 'Brak wyników. Spróbuj innej frazy.',
      submitTitle: 'Zgłoś wniosek',
      submitSubtitle: 'Krótko opisz, kim jesteś i dlaczego zarządzasz tą stacją. Pomoże to przy weryfikacji.',
      notesLabel: 'Notatka (opcjonalna)',
      notesPlaceholder: 'np. „Jestem franczyzobiorcą tej stacji od 2018 r. Tel. kontaktowy 600 123 456."',
      submitButton: 'Zgłoś wniosek',
      backToSearch: '← Wróć do wyszukiwania',
      successTitle: 'Wniosek przyjęty',
      successAutoApproved: 'Twój wniosek został automatycznie zatwierdzony przez dopasowanie domeny e-mail. Możesz już zarządzać stacją.',
      successPending: 'Wniosek oczekuje na weryfikację. Skontaktujemy się z Tobą lub zadzwonimy na numer stacji w ciągu kilku dni roboczych.',
      goToStation: 'Przejdź do stacji →',
      backToHome: '← Wróć do moich wniosków',
      errorAlreadyClaimed: 'Ta stacja jest już zarządzana przez innego zweryfikowanego właściciela.',
      errorAlreadyPending: 'Twój wniosek dla tej stacji jest już w trakcie weryfikacji.',
      errorAlreadyApproved: 'Już zarządzasz tą stacją.',
      errorGeneric: 'Nie udało się złożyć wniosku. Spróbuj ponownie.',
    },
    station: {
      placeholderTitle: 'Stacja',
      placeholderSubtitle: 'Funkcje zarządzania stacją (zmiany cen, statystyki) będą dostępne wkrótce.',
      backToHome: '← Wróć do moich wniosków',
    },
    common: {
      loading: 'Ładowanie…',
    },
  },
  en: {
    nav: {
      home: 'My claims',
      claim: 'Claim a station',
      logout: 'Sign out',
    },
    home: {
      title: 'Partner portal',
      subtitle: 'Manage claims for your fuel stations.',
      newClaimCta: 'Claim a new station',
      yourClaimsTitle: 'Your claims',
      noClaimsYet: "You haven't submitted any claims yet.",
      statusPending: 'Pending review',
      statusAwaitingDocs: 'Awaiting documents',
      statusApproved: 'Approved',
      statusRejected: 'Rejected',
      submittedLabel: 'Submitted',
      rejectionLabel: 'Rejection reason',
      reviewerNotesLabel: 'Reviewer note',
      manageStation: 'Manage station →',
      retrySubmit: 'Re-submit claim',
    },
    login: {
      title: 'Partner portal',
      subtitle: 'Sign in to manage your station claims.',
      emailLabel: 'Email',
      passwordLabel: 'Password',
      submitButton: 'Sign in',
      registerLink: "No account? Register.",
      errorInvalid: 'Invalid email or password.',
      errorGeneric: 'Sign-in failed. Please try again.',
    },
    register: {
      title: 'Create a partner account',
      subtitle: 'Sign up to claim stations you manage.',
      emailLabel: 'Email',
      passwordLabel: 'Password',
      displayNameLabel: 'Name / business name',
      submitButton: 'Create account',
      loginLink: 'Already have an account? Sign in.',
      errorEmailExists: 'An account with this email already exists.',
      errorWeakPassword: 'Password must be at least 8 characters.',
      errorGeneric: 'Registration failed. Please try again.',
    },
    claim: {
      searchTitle: 'Find your station',
      searchSubtitle: 'Search by name or address, then pick the station to submit a claim.',
      searchPlaceholder: 'e.g. "Orlen Lodz Glowna" or a postcode',
      searchButton: 'Search',
      searchEmpty: 'No results. Try a different query.',
      submitTitle: 'Submit a claim',
      submitSubtitle: 'Briefly tell us who you are and why you manage this station. Helps verification.',
      notesLabel: 'Notes (optional)',
      notesPlaceholder: 'e.g. "I have been the franchisee of this station since 2018. Contact phone 600 123 456."',
      submitButton: 'Submit claim',
      backToSearch: '← Back to search',
      successTitle: 'Claim submitted',
      successAutoApproved: 'Your claim was auto-approved via email domain match. You can manage this station now.',
      successPending: "Your claim is awaiting review. We'll contact you or call the station's phone within a few business days.",
      goToStation: 'Go to station →',
      backToHome: '← Back to my claims',
      errorAlreadyClaimed: 'This station is already managed by another verified owner.',
      errorAlreadyPending: 'Your claim for this station is already under review.',
      errorAlreadyApproved: 'You already manage this station.',
      errorGeneric: 'Failed to submit the claim. Please try again.',
    },
    station: {
      placeholderTitle: 'Station',
      placeholderSubtitle: 'Station management features (price overrides, performance metrics) coming soon.',
      backToHome: '← Back to my claims',
    },
    common: {
      loading: 'Loading…',
    },
  },
  uk: {
    nav: {
      home: 'Мої заявки',
      claim: 'Подати заявку',
      logout: 'Вийти',
    },
    home: {
      title: 'Партнерський портал',
      subtitle: 'Керуйте заявками на ваші АЗС.',
      newClaimCta: 'Подати нову заявку',
      yourClaimsTitle: 'Ваші заявки',
      noClaimsYet: 'Ви ще не подавали заявок.',
      statusPending: 'Очікує перевірки',
      statusAwaitingDocs: 'Очікує документи',
      statusApproved: 'Затверджено',
      statusRejected: 'Відхилено',
      submittedLabel: 'Подано',
      rejectionLabel: 'Причина відхилення',
      reviewerNotesLabel: 'Нотатка модератора',
      manageStation: 'Керувати станцією →',
      retrySubmit: 'Подати знову',
    },
    login: {
      title: 'Партнерський портал',
      subtitle: 'Увійдіть, щоб керувати заявками.',
      emailLabel: 'E-mail',
      passwordLabel: 'Пароль',
      submitButton: 'Увійти',
      registerLink: 'Немає акаунта? Зареєструватися.',
      errorInvalid: 'Невірні дані для входу.',
      errorGeneric: 'Помилка входу. Спробуйте ще раз.',
    },
    register: {
      title: 'Створіть партнерський акаунт',
      subtitle: 'Зареєструйтесь, щоб подати заявки на станції.',
      emailLabel: 'E-mail',
      passwordLabel: 'Пароль',
      displayNameLabel: "Ім'я / назва компанії",
      submitButton: 'Створити акаунт',
      loginLink: 'Вже маєте акаунт? Увійдіть.',
      errorEmailExists: 'Акаунт з цим e-mail вже існує.',
      errorWeakPassword: 'Пароль повинен бути не менше 8 символів.',
      errorGeneric: 'Помилка реєстрації. Спробуйте ще раз.',
    },
    claim: {
      searchTitle: 'Знайдіть свою станцію',
      searchSubtitle: 'Шукайте за назвою або адресою, потім виберіть станцію.',
      searchPlaceholder: 'напр. «Orlen Lodz Glowna» або індекс',
      searchButton: 'Шукати',
      searchEmpty: 'Немає результатів. Спробуйте інший запит.',
      submitTitle: 'Подати заявку',
      submitSubtitle: 'Коротко опишіть, хто ви і чому керуєте цією станцією. Це допоможе верифікації.',
      notesLabel: 'Нотатка (опціонально)',
      notesPlaceholder: 'напр. «Я франчайзі цієї станції з 2018. Контактний тел. 600 123 456.»',
      submitButton: 'Подати заявку',
      backToSearch: '← Назад до пошуку',
      successTitle: 'Заявку подано',
      successAutoApproved: 'Вашу заявку автоматично затверджено через збіг домену e-mail. Ви можете керувати станцією.',
      successPending: 'Заявка очікує перевірки. Ми зв\'яжемось з вами або зателефонуємо на номер станції протягом кількох робочих днів.',
      goToStation: 'Перейти до станції →',
      backToHome: '← Назад до моїх заявок',
      errorAlreadyClaimed: 'Ця станція вже керується іншим перевіреним власником.',
      errorAlreadyPending: 'Ваша заявка на цю станцію вже на розгляді.',
      errorAlreadyApproved: 'Ви вже керуєте цією станцією.',
      errorGeneric: 'Не вдалося подати заявку. Спробуйте ще раз.',
    },
    station: {
      placeholderTitle: 'Станція',
      placeholderSubtitle: 'Функції керування станцією (зміна цін, статистика) скоро з\'являться.',
      backToHome: '← Назад до моїх заявок',
    },
    common: {
      loading: 'Завантаження…',
    },
  },
} as const;

export interface Translations {
  nav: { home: string; claim: string; logout: string };
  home: {
    title: string;
    subtitle: string;
    newClaimCta: string;
    yourClaimsTitle: string;
    noClaimsYet: string;
    statusPending: string;
    statusAwaitingDocs: string;
    statusApproved: string;
    statusRejected: string;
    submittedLabel: string;
    rejectionLabel: string;
    reviewerNotesLabel: string;
    manageStation: string;
    retrySubmit: string;
  };
  login: {
    title: string;
    subtitle: string;
    emailLabel: string;
    passwordLabel: string;
    submitButton: string;
    registerLink: string;
    errorInvalid: string;
    errorGeneric: string;
  };
  register: {
    title: string;
    subtitle: string;
    emailLabel: string;
    passwordLabel: string;
    displayNameLabel: string;
    submitButton: string;
    loginLink: string;
    errorEmailExists: string;
    errorWeakPassword: string;
    errorGeneric: string;
  };
  claim: {
    searchTitle: string;
    searchSubtitle: string;
    searchPlaceholder: string;
    searchButton: string;
    searchEmpty: string;
    submitTitle: string;
    submitSubtitle: string;
    notesLabel: string;
    notesPlaceholder: string;
    submitButton: string;
    backToSearch: string;
    successTitle: string;
    successAutoApproved: string;
    successPending: string;
    goToStation: string;
    backToHome: string;
    errorAlreadyClaimed: string;
    errorAlreadyPending: string;
    errorAlreadyApproved: string;
    errorGeneric: string;
  };
  station: {
    placeholderTitle: string;
    placeholderSubtitle: string;
    backToHome: string;
  };
  common: { loading: string };
}

export function getTranslations(locale: Locale): Translations {
  return translations[locale];
}
