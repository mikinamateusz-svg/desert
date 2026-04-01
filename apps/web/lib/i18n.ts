export type Locale = 'pl' | 'en' | 'uk';

export function detectLocale(
  acceptLanguage: string | null,
  cookieLocale?: string | null,
): Locale {
  if (cookieLocale === 'en' || cookieLocale === 'uk' || cookieLocale === 'pl') {
    return cookieLocale;
  }
  if (!acceptLanguage) return 'pl';
  const lang = acceptLanguage.split(',')[0]?.split('-')[0]?.toLowerCase();
  if (lang === 'uk') return 'uk';
  if (lang === 'en') return 'en';
  return 'pl';
}

export function localeToHtmlLang(locale: Locale): string {
  if (locale === 'uk') return 'uk';
  if (locale === 'en') return 'en';
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
  estimated: string;
  fuelTypes: Record<string, string>;
  sidebar: {
    nearbyStations: string;
    sortedByPrice: string;
    viewDetail: string;
    noStations: string;
    addPrice: string;
  };
  nav: {
    map: string;
    about: string;
    contact: string;
    forStations: string;
    pricing: string;
    login: string;
    account: string;
    menu: string;
  };
  footer: {
    tagline: string;
    product: string;
    company: string;
    legal: string;
    about: string;
    contact: string;
    pricing: string;
    forStations: string;
    privacy: string;
    terms: string;
    copyright: string;
  };
  station: {
    prices: string;
    fuelHeader: string;
    navigate: string;
    reportPrice: string;
    source: string;
    community: string;
    estimated: string;
    lastUpdated: string;
    noPrice: string;
    backToMap: string;
    notFound: string;
    metaTitle: string;
    metaDesc: string;
  };
  about: {
    title: string;
    hero: string;
    heroSub: string;
    howTitle: string;
    step1Title: string;
    step1: string;
    step2Title: string;
    step2: string;
    step3Title: string;
    step3: string;
    whyTitle: string;
    feature1: string;
    feature2: string;
    feature3: string;
    feature4: string;
    ctaTitle: string;
    ctaSub: string;
    ctaButton: string;
  };
  contact: {
    title: string;
    subtitle: string;
    name: string;
    email: string;
    subject: string;
    message: string;
    send: string;
    sending: string;
    successTitle: string;
    successMsg: string;
    errorMsg: string;
    infoTitle: string;
    infoEmail: string;
    infoResponse: string;
  };
  pricing: {
    title: string;
    subtitle: string;
    free: string;
    freeDesc: string;
    pro: string;
    proDesc: string;
    fleet: string;
    fleetDesc: string;
    contact: string;
    comingSoon: string;
    features: {
      free: string[];
      pro: string[];
      fleet: string[];
    };
  };
  legal: {
    privacyTitle: string;
    termsTitle: string;
    stub: string;
  };
  news: {
    title: string;
    readMore: string;
    backToNews: string;
    noArticles: string;
    priceSummaryTitle: string;
    priceSummarySubtitle: string;
    noData: string;
    weekChange: string;
  };
}

export const translations: Record<Locale, Translations> = {
  pl: {
    pageTitle: 'Litro — ceny paliw w Polsce',
    contribute: 'Dodaj cenę',
    contributePrompt: 'Utwórz konto, aby dodawać aktualne ceny paliw w swojej okolicy.',
    contributePromptTitle: 'Zaloguj się, aby dodać cenę',
    close: 'Zamknij',
    noData: 'Brak danych o cenach',
    updatedAt: 'Zaktualizowano',
    estimated: 'szacunkowa',
    fuelTypes: {
      PB_95: 'PB 95',
      PB_98: 'PB 98',
      ON: 'ON',
      ON_PREMIUM: 'ON Premium',
      LPG: 'LPG',
    },
    sidebar: {
      nearbyStations: 'Stacje w pobliżu',
      sortedByPrice: 'PB 95 · posortowane po cenie',
      viewDetail: 'Szczegóły',
      noStations: 'Brak stacji w okolicy',
      addPrice: 'Dodaj cenę',
    },
    nav: {
      map: 'Mapa',
      about: 'O nas',
      contact: 'Kontakt',
      forStations: 'Dla stacji',
      pricing: 'Cennik',
      login: 'Zaloguj się',
      account: 'Konto',
      menu: 'Menu',
    },
    footer: {
      tagline: 'Ceny paliw od społeczności',
      product: 'Produkt',
      company: 'Firma',
      legal: 'Prawo',
      about: 'O nas',
      contact: 'Kontakt',
      pricing: 'Cennik',
      forStations: 'Dla stacji',
      privacy: 'Polityka prywatności',
      terms: 'Regulamin',
      copyright: '© 2026 Litro. Wszelkie prawa zastrzeżone.',
    },
    station: {
      prices: 'Ceny paliw',
      fuelHeader: 'Rodzaj paliwa',
      navigate: 'Nawiguj',
      reportPrice: 'Zgłoś cenę',
      source: 'Źródło',
      community: 'Społeczność',
      estimated: 'Szacunkowa',
      lastUpdated: 'Ostatnia aktualizacja',
      noPrice: 'Brak danych',
      backToMap: '← Powrót do mapy',
      notFound: 'Stacja nie istnieje lub nie została jeszcze zsynchronizowana.',
      metaTitle: 'Ceny paliw',
      metaDesc: 'Sprawdź aktualne ceny paliw na stacji',
    },
    about: {
      title: 'O Litro',
      hero: 'Zawsze wiesz, gdzie jest najtaniej',
      heroSub: 'Litro to aplikacja tworzona przez kierowców dla kierowców. Zbieramy ceny paliw z całej Polski w czasie rzeczywistym — dzięki społeczności, która dzieli się informacjami po każdym tankowaniu.',
      howTitle: 'Jak to działa?',
      step1Title: 'Znajdź stację',
      step1: 'Przeglądaj mapę i sprawdź aktualne ceny paliw na stacjach w okolicy.',
      step2Title: 'Zatankuj taniej',
      step2: 'Filtruj po rodzaju paliwa i wybierz najtańszą opcję na trasie.',
      step3Title: 'Podziel się ceną',
      step3: 'Po tankowaniu dodaj aktualną cenę — pomożesz innym i zbudujesz historię cen.',
      whyTitle: 'Dlaczego Litro?',
      feature1: 'Ceny aktualizowane przez społeczność w czasie rzeczywistym',
      feature2: 'Szacunkowe ceny gdy brak danych — nigdy nie jesteś bez informacji',
      feature3: 'Historia cen i trendy regionalne',
      feature4: 'Darmowe dla kierowców — zawsze',
      ctaTitle: 'Dołącz do społeczności',
      ctaSub: 'Pobierz aplikację i zacznij oszczędzać na każdym tankowaniu.',
      ctaButton: 'Pobierz aplikację',
    },
    contact: {
      title: 'Kontakt',
      subtitle: 'Masz pytanie, zgłoszenie błędu lub propozycję współpracy? Napisz do nas.',
      name: 'Imię i nazwisko',
      email: 'Adres e-mail',
      subject: 'Temat',
      message: 'Wiadomość',
      send: 'Wyślij',
      sending: 'Wysyłanie...',
      successTitle: 'Wiadomość wysłana',
      successMsg: 'Dziękujemy za kontakt. Odpowiemy w ciągu 2 dni roboczych.',
      errorMsg: 'Nie udało się wysłać wiadomości. Spróbuj ponownie lub napisz bezpośrednio na e-mail.',
      infoTitle: 'Dane kontaktowe',
      infoEmail: 'kontakt@litro.app',
      infoResponse: 'Odpowiadamy w ciągu 2 dni roboczych.',
    },
    pricing: {
      title: 'Cennik',
      subtitle: 'Litro jest darmowe dla kierowców. Płatne plany dla firm i flot — wkrótce.',
      free: 'Kierowca',
      freeDesc: 'Przeglądaj ceny, dodawaj zgłoszenia, śledź historię tankowania.',
      pro: 'Pro',
      proDesc: 'Powiadomienia o cenach, eksport danych, priorytetowe wsparcie.',
      fleet: 'Flota',
      fleetDesc: 'Zarządzanie wieloma pojazdami, raporty kosztów, integracja z systemami FK.',
      contact: 'Skontaktuj się z nami',
      comingSoon: 'Wkrótce',
      features: {
        free: ['Mapa cen paliw', 'Szacunkowe ceny', 'Dodawanie cen', 'Historia tankowania'],
        pro: ['Wszystko z planu Kierowca', 'Powiadomienia push o cenach', 'Eksport danych CSV', 'Priorytetowe wsparcie'],
        fleet: ['Wszystko z planu Pro', 'Wiele pojazdów', 'Raporty kosztów', 'Integracja z systemami FK', 'Dedykowany opiekun'],
      },
    },
    legal: {
      privacyTitle: 'Polityka prywatności',
      termsTitle: 'Regulamin',
      stub: 'Dokument w przygotowaniu. Skontaktuj się z nami w razie pytań.',
    },
    news: {
      title: 'Aktualności',
      readMore: 'Czytaj więcej',
      backToNews: '← Aktualności',
      noArticles: 'Brak artykułów.',
      priceSummaryTitle: 'Tygodniowe ceny paliw ORLEN',
      priceSummarySubtitle: 'Ceny hurtowe ORLEN (PLN/litr)',
      noData: 'Dane w przygotowaniu.',
      weekChange: 'zmiana tyg.',
    },
  },

  en: {
    pageTitle: 'Litro — fuel prices in Poland',
    contribute: 'Add price',
    contributePrompt: 'Create an account to contribute current fuel prices in your area.',
    contributePromptTitle: 'Sign in to add a price',
    close: 'Close',
    noData: 'No price data',
    updatedAt: 'Updated',
    estimated: 'estimated',
    fuelTypes: {
      PB_95: 'Petrol 95',
      PB_98: 'Petrol 98',
      ON: 'Diesel',
      ON_PREMIUM: 'Premium Diesel',
      LPG: 'LPG',
    },
    sidebar: {
      nearbyStations: 'Nearby stations',
      sortedByPrice: 'Petrol 95 · sorted by price',
      viewDetail: 'Details',
      noStations: 'No stations nearby',
      addPrice: 'Add price',
    },
    nav: {
      map: 'Map',
      about: 'About',
      contact: 'Contact',
      forStations: 'For stations',
      pricing: 'Pricing',
      login: 'Sign in',
      account: 'Account',
      menu: 'Menu',
    },
    footer: {
      tagline: 'Community fuel prices',
      product: 'Product',
      company: 'Company',
      legal: 'Legal',
      about: 'About',
      contact: 'Contact',
      pricing: 'Pricing',
      forStations: 'For stations',
      privacy: 'Privacy policy',
      terms: 'Terms of service',
      copyright: '© 2026 Litro. All rights reserved.',
    },
    station: {
      prices: 'Fuel prices',
      fuelHeader: 'Fuel type',
      navigate: 'Navigate',
      reportPrice: 'Report price',
      source: 'Source',
      community: 'Community',
      estimated: 'Estimated',
      lastUpdated: 'Last updated',
      noPrice: 'No data',
      backToMap: '← Back to map',
      notFound: 'Station not found or not yet synced.',
      metaTitle: 'Fuel prices',
      metaDesc: 'Check current fuel prices at this station',
    },
    about: {
      title: 'About Litro',
      hero: 'Always know where fuel is cheapest',
      heroSub: 'Litro is built by drivers, for drivers. We collect real-time fuel prices across Poland — powered by a community that shares prices after every fill-up.',
      howTitle: 'How it works',
      step1Title: 'Find a station',
      step1: 'Browse the map and check current fuel prices at nearby stations.',
      step2Title: 'Fill up cheaper',
      step2: 'Filter by fuel type and choose the cheapest option on your route.',
      step3Title: 'Share a price',
      step3: 'After filling up, add the current price — help others and build price history.',
      whyTitle: 'Why Litro?',
      feature1: 'Community-updated prices in real time',
      feature2: 'Estimated prices when data is missing — never left without information',
      feature3: 'Price history and regional trends',
      feature4: 'Free for drivers — always',
      ctaTitle: 'Join the community',
      ctaSub: 'Download the app and start saving on every fill-up.',
      ctaButton: 'Download the app',
    },
    contact: {
      title: 'Contact',
      subtitle: 'Have a question, bug report, or partnership inquiry? Write to us.',
      name: 'Full name',
      email: 'Email address',
      subject: 'Subject',
      message: 'Message',
      send: 'Send',
      sending: 'Sending...',
      successTitle: 'Message sent',
      successMsg: 'Thank you for reaching out. We will reply within 2 business days.',
      errorMsg: 'Could not send message. Please try again or email us directly.',
      infoTitle: 'Contact details',
      infoEmail: 'contact@litro.app',
      infoResponse: 'We reply within 2 business days.',
    },
    pricing: {
      title: 'Pricing',
      subtitle: 'Litro is free for drivers. Paid plans for businesses and fleets — coming soon.',
      free: 'Driver',
      freeDesc: 'Browse prices, submit reports, track fill-up history.',
      pro: 'Pro',
      proDesc: 'Price alerts, data export, priority support.',
      fleet: 'Fleet',
      fleetDesc: 'Multi-vehicle management, cost reports, accounting system integration.',
      contact: 'Contact us',
      comingSoon: 'Coming soon',
      features: {
        free: ['Fuel price map', 'Estimated prices', 'Add prices', 'Fill-up history'],
        pro: ['Everything in Driver', 'Push price alerts', 'CSV data export', 'Priority support'],
        fleet: ['Everything in Pro', 'Multiple vehicles', 'Cost reports', 'Accounting integration', 'Dedicated manager'],
      },
    },
    legal: {
      privacyTitle: 'Privacy policy',
      termsTitle: 'Terms of service',
      stub: 'Document in preparation. Contact us if you have questions.',
    },
    news: {
      title: 'News',
      readMore: 'Read more',
      backToNews: '← News',
      noArticles: 'No articles yet.',
      priceSummaryTitle: 'Weekly ORLEN fuel prices',
      priceSummarySubtitle: 'ORLEN wholesale prices (PLN/l)',
      noData: 'Data not yet available.',
      weekChange: 'wk change',
    },
  },

  uk: {
    pageTitle: 'Litro — ціни на пальне в Польщі',
    contribute: 'Додати ціну',
    contributePrompt: 'Створіть обліковий запис, щоб додавати актуальні ціни на пальне у вашому районі.',
    contributePromptTitle: 'Увійдіть, щоб додати ціну',
    close: 'Закрити',
    noData: 'Немає даних про ціни',
    updatedAt: 'Оновлено',
    estimated: 'орієнтовна',
    fuelTypes: {
      PB_95: 'Бензин 95',
      PB_98: 'Бензин 98',
      ON: 'Дизель',
      ON_PREMIUM: 'Преміум дизель',
      LPG: 'LPG',
    },
    sidebar: {
      nearbyStations: 'Станції поруч',
      sortedByPrice: 'Бензин 95 · за зростанням ціни',
      viewDetail: 'Деталі',
      noStations: 'Немає станцій поруч',
      addPrice: 'Додати ціну',
    },
    nav: {
      map: 'Карта',
      about: 'Про нас',
      contact: 'Контакт',
      forStations: 'Для станцій',
      pricing: 'Ціни',
      login: 'Увійти',
      account: 'Кабінет',
      menu: 'Меню',
    },
    footer: {
      tagline: 'Ціни на пальне від спільноти',
      product: 'Продукт',
      company: 'Компанія',
      legal: 'Право',
      about: 'Про нас',
      contact: 'Контакт',
      pricing: 'Ціни',
      forStations: 'Для станцій',
      privacy: 'Політика конфіденційності',
      terms: 'Умови використання',
      copyright: '© 2026 Litro. Всі права захищені.',
    },
    station: {
      prices: 'Ціни на пальне',
      fuelHeader: 'Вид пального',
      navigate: 'Навігація',
      reportPrice: 'Додати ціну',
      source: 'Джерело',
      community: 'Спільнота',
      estimated: 'Орієнтовна',
      lastUpdated: 'Останнє оновлення',
      noPrice: 'Немає даних',
      backToMap: '← Назад до карти',
      notFound: 'Станцію не знайдено або ще не синхронізовано.',
      metaTitle: 'Ціни на пальне',
      metaDesc: 'Перевірте актуальні ціни на пальне на цій станції',
    },
    about: {
      title: 'Про Litro',
      hero: 'Завжди знайте, де дешевше',
      heroSub: 'Litro створено водіями для водіїв. Ми збираємо актуальні ціни на пальне по всій Польщі — завдяки спільноті, яка ділиться цінами після кожної заправки.',
      howTitle: 'Як це працює?',
      step1Title: 'Знайдіть станцію',
      step1: 'Переглядайте карту і перевіряйте актуальні ціни на пальне на найближчих станціях.',
      step2Title: 'Заправтесь дешевше',
      step2: 'Фільтруйте за видом пального і обирайте найдешевший варіант на маршруті.',
      step3Title: 'Поділіться ціною',
      step3: 'Після заправки додайте актуальну ціну — допоможіть іншим і сформуйте історію цін.',
      whyTitle: 'Чому Litro?',
      feature1: 'Ціни оновлюються спільнотою в реальному часі',
      feature2: 'Орієнтовні ціни коли немає даних — ніколи не залишитесь без інформації',
      feature3: 'Історія цін та регіональні тенденції',
      feature4: 'Безкоштовно для водіїв — назавжди',
      ctaTitle: 'Приєднуйтесь до спільноти',
      ctaSub: 'Завантажте додаток і починайте заощаджувати на кожній заправці.',
      ctaButton: 'Завантажити додаток',
    },
    contact: {
      title: 'Контакт',
      subtitle: 'Маєте питання, повідомлення про помилку або пропозицію? Напишіть нам.',
      name: "Ім'я та прізвище",
      email: 'Електронна пошта',
      subject: 'Тема',
      message: 'Повідомлення',
      send: 'Надіслати',
      sending: 'Надсилання...',
      successTitle: 'Повідомлення надіслано',
      successMsg: 'Дякуємо за звернення. Ми відповімо протягом 2 робочих днів.',
      errorMsg: 'Не вдалося надіслати повідомлення. Спробуйте ще раз або напишіть нам безпосередньо.',
      infoTitle: 'Контактні дані',
      infoEmail: 'contact@litro.app',
      infoResponse: 'Відповідаємо протягом 2 робочих днів.',
    },
    pricing: {
      title: 'Ціни',
      subtitle: 'Litro безкоштовний для водіїв. Платні плани для бізнесу та флоту — незабаром.',
      free: 'Водій',
      freeDesc: 'Переглядайте ціни, додавайте звіти, відстежуйте заправки.',
      pro: 'Pro',
      proDesc: 'Сповіщення про ціни, експорт даних, пріоритетна підтримка.',
      fleet: 'Флот',
      fleetDesc: 'Управління кількома автомобілями, звіти витрат, інтеграція з бухгалтерськими системами.',
      contact: "Зв'яжіться з нами",
      comingSoon: 'Незабаром',
      features: {
        free: ['Карта цін на пальне', 'Орієнтовні ціни', 'Додавання цін', 'Історія заправок'],
        pro: ['Все з плану Водій', 'Push-сповіщення про ціни', 'Експорт даних CSV', 'Пріоритетна підтримка'],
        fleet: ['Все з плану Pro', 'Кілька автомобілів', 'Звіти витрат', 'Інтеграція з бухгалтерією', 'Персональний менеджер'],
      },
    },
    legal: {
      privacyTitle: 'Політика конфіденційності',
      termsTitle: 'Умови використання',
      stub: "Документ у підготовці. Зв'яжіться з нами, якщо маєте питання.",
    },
    news: {
      title: 'Новини',
      readMore: 'Читати далі',
      backToNews: '← Новини',
      noArticles: 'Немає статей.',
      priceSummaryTitle: 'Тижневі ціни на пальне ORLEN',
      priceSummarySubtitle: 'Оптові ціни ORLEN (PLN/л)',
      noData: 'Дані ще не доступні.',
      weekChange: 'зміна за тижд.',
    },
  },
};
