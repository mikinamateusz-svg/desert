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
      stationSync: 'Synchronizacja stacji',
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
      stationSync: { title: 'Synchronizacja stacji', description: 'Wyzwól synchronizację z Google Places i monitoruj status.' },
    },
    stationSync: {
      statusLabel: 'Status',
      statusIdle: 'Bezczynny',
      statusRunning: 'Synchronizacja w toku…',
      statusFailed: 'Ostatnia synchronizacja nie powiodła się',
      lastCompleted: 'Ostatnia udana synchronizacja',
      lastFailed: 'Ostatni błąd',
      stationCount: 'Stacji w bazie',
      triggerButton: 'Uruchom synchronizację',
      syncRunning: 'Synchronizacja w toku…',
      alreadyRunningTooltip: 'Synchronizacja już trwa',
      errorBanner: 'Ostatnia synchronizacja nie powiodła się — sprawdź logi Railway.',
      dismissError: 'Zamknij',
      never: 'Nigdy',
    },
    users: {
      trustScore: 'Wynik zaufania',
      shadowBanned: 'Zablokowany',
      shadowBan: 'Nałóż shadow ban',
      removeBan: 'Zdejmij blokadę',
      confirmBan: 'Czy na pewno nałożyć shadow ban na tego użytkownika?',
      confirmUnban: 'Czy na pewno zdjąć blokadę z tego użytkownika?',
      alertsLabel: 'Alerty anomalii',
      dismissAlert: 'Odrzuć alert',
      noAlerts: 'Brak aktywnych alertów.',
      alertTypes: {
        high_frequency: 'Wysoka częstotliwość',
        price_variance: 'Odchylenie cen',
        station_spread: 'Rozprzestrzenienie po stacjach',
      },
      submissionStatuses: {
        pending: 'Oczekujące',
        verified: 'Zweryfikowane',
        rejected: 'Odrzucone',
        shadow_rejected: 'Shadow odrzucone',
      },
      nameColumn: 'Użytkownik',
      statusColumn: 'Status',
      submissionsColumn: 'Zgłoszenia',
      alertsColumn: 'Alerty',
      joinedColumn: 'Dołączył/a',
      activeStatus: 'Aktywny',
      searchPlaceholder: 'Szukaj po e-mail lub nazwie…',
      searchButton: 'Szukaj',
      noUsersFound: 'Nie znaleziono użytkowników.',
    },
    deadLetter: {
      title: 'Kolejka błędów',
      description: 'Przeglądaj nieprzetworzone zadania.',
      columns: {
        submissionId: 'ID zgłoszenia',
        station: 'Stacja',
        failureReason: 'Przyczyna błędu',
        attempts: 'Próby',
        lastAttempt: 'Ostatnia próba',
      },
      retry: 'Ponów',
      discard: 'Odrzuć',
      confirmDiscard: 'Czy na pewno odrzucić to zadanie? Zdjęcie zostanie usunięte.',
      noItems: 'Brak zadań w kolejce błędów.',
      retrySuccess: 'Zadanie zostało ponownie dodane do kolejki.',
      discardSuccess: 'Zadanie zostało odrzucone.',
      errorGeneric: 'Błąd. Spróbuj ponownie.',
      unknownStation: 'Nieznana',
      unknownReason: 'Nieznany',
    },
    stations: {
      searchPlaceholder: 'Szukaj po nazwie lub adresie…',
      searchButton: 'Szukaj',
      nameColumn: 'Nazwa',
      addressColumn: 'Adres',
      brandColumn: 'Marka',
      noResults: 'Nie znaleziono stacji.',
      pricesTitle: 'Aktualne ceny',
      fuelTypeColumn: 'Rodzaj paliwa',
      priceColumn: 'Cena (PLN/l)',
      sourceColumn: 'Źródło',
      lastUpdatedColumn: 'Ostatnia aktualizacja',
      sources: {
        community: 'Społeczność',
        admin_override: 'Nadpisanie admina',
        seeded: 'Zainicjowane',
      },
      overrideTitle: 'Nadpisz cenę',
      fuelTypeLabel: 'Rodzaj paliwa',
      priceLabel: 'Cena (PLN/l)',
      reasonLabel: 'Powód',
      reasonPlaceholder: 'Podaj powód nadpisania…',
      submitOverride: 'Zapisz nadpisanie',
      refreshCache: 'Odśwież cache',
      confirmRefresh: 'Czy na pewno odświeżyć cache dla tej stacji?',
      overrideSuccess: 'Cena została nadpisana.',
      refreshSuccess: 'Cache został odświeżony.',
      errorGeneric: 'Błąd. Spróbuj ponownie.',
      errorNotFound: 'Stacja nie została znaleziona.',
      detailAction: 'Szczegóły',
    },
    metrics: {
      tabs: { pipeline: 'Zdrowie pipeline', funnel: 'Lejek zgłoszeń', product: 'Metryki produktu', cost: 'Koszty API', freshness: 'Świeżość danych' },
      period: { today: 'Dziś', '7d': 'Ostatnie 7 dni', '30d': 'Ostatnie 30 dni' },
      pipeline: {
        successRate: 'Skuteczność (ostatnia godz.)',
        processingP50: 'Czas przetwarzania p50',
        processingP95: 'Czas przetwarzania p95',
        queueDepth: 'Głębokość kolejki',
        activeJobs: 'Aktywne zadania',
        dlqCount: 'Kolejka błędów (DLQ)',
        errorBreakdown: 'Rozkład błędów (ostatnia godz.)',
        noErrors: 'Brak błędów w ostatniej godzinie.',
        seconds: 's',
        noData: 'Brak danych (brak zgłoszeń w ostatniej godzinie).',
        autoRefresh: 'Odśwież',
      },
      funnel: {
        total: 'Wszystkich zgłoszeń',
        verified: 'Zweryfikowanych',
        rejected: 'Odrzuconych',
        shadowRejected: 'Shadow odrzuconych',
        pending: 'Oczekujących',
        dlq: 'W kolejce błędów',
        rejectionBreakdown: 'Rozkład odrzuceń',
        drilldownTitle: 'Zgłoszenia — ',
        backToFunnel: '← Powrót',
        columnId: 'ID',
        columnStation: 'Stacja',
        columnDate: 'Data',
        columnReason: 'Powód',
        noSubmissions: 'Brak zgłoszeń dla wybranego powodu.',
      },
      product: {
        totalMapViews: 'Łączne odsłony mapy',
        avgAuthPct: 'Udział zalogowanych',
        totalNewRegs: 'Nowe rejestracje',
        date: 'Data',
        mapViews: 'Odsłony mapy',
        authPct: '% zalogowanych',
        newRegs: 'Rejestracje',
      },
      flagReasons: {
        logo_mismatch: 'Niezgodność logo',
        low_trust: 'Niskie zaufanie',
        price_validation_failed: 'Błąd walidacji ceny',
        gps_no_match: 'Brak dopasowania GPS',
        low_confidence: 'Niska pewność OCR',
        dead_letter_discarded: 'Odrzucone z DLQ',
      },
      cost: {
        today: 'Dziś',
        currentWeek: 'Bieżący tydzień',
        currentMonth: 'Bieżący miesiąc',
        last3Months: 'Ostatnie 3 miesiące',
        imagesLabel: 'Zdjęcia',
        noData: 'Brak danych.',
      },
      freshness: {
        allRegions: 'Wszystkie regiony',
        sortBy: 'Sortuj po',
        colName: 'Stacja',
        colAddress: 'Adres',
        colVoivodeship: 'Województwo',
        colSource: 'Źródło ceny',
        colLastUpdated: 'Ostatnia aktualizacja',
        colStatus: 'Status',
        stale: 'Przestarzałe',
        noData: 'Brak danych',
        staleCount: 'Stacji bez aktualizacji (30 dni)',
        sources: {
          community: 'Społeczność',
          admin_override: 'Nadpisanie admina',
          seeded: 'Zainicjowane',
        },
        noResults: 'Brak stacji.',
      },
      errorGeneric: 'Błąd ładowania. Spróbuj ponownie.',
    },
    review: {
      flagReason: {
        logo_mismatch: 'Niezgodność logo',
        low_trust: 'Niskie zaufanie',
        pb98_below_pb95: 'PB98 < PB95',
        on_premium_below_on: 'ON Premium < ON',
      },
      columns: {
        station: 'Stacja',
        prices: 'Ceny',
        confidence: 'Pewność OCR',
        submitted: 'Zgłoszono',
        contributor: 'Zgłaszający',
        flag: 'Powód flagi',
      },
      filterLabel: 'Filtruj:',
      filterAll: 'Wszystkie',
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
      errorNoStation: 'Brak dopasowanej stacji — wyszukaj i przypisz stację przed zatwierdzeniem.',
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
      priceOverrideLabel: 'Korekta cen (opcjonalna)',
      stationReassignLabel: 'Zmień stację',
      stationSearchPlaceholder: 'Szukaj po nazwie...',
      stationSearchError: 'Błąd wyszukiwania. Spróbuj ponownie.',
      stationSelected: 'Wybrano:',
      stationClear: 'Wyczyść',
    },
  },
  en: {
    nav: {
      submissions: 'Submissions',
      users: 'Users',
      deadLetter: 'Dead-Letter Queue',
      stations: 'Stations',
      metrics: 'Metrics',
      stationSync: 'Station Sync',
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
      stationSync: { title: 'Station Sync', description: 'Trigger a Google Places sync and monitor progress.' },
    },
    stationSync: {
      statusLabel: 'Status',
      statusIdle: 'Idle',
      statusRunning: 'Sync running…',
      statusFailed: 'Last sync failed',
      lastCompleted: 'Last completed',
      lastFailed: 'Last failed',
      stationCount: 'Stations in database',
      triggerButton: 'Run Sync Now',
      syncRunning: 'Sync running…',
      alreadyRunningTooltip: 'Sync already in progress',
      errorBanner: 'Last sync failed — check Railway logs.',
      dismissError: 'Dismiss',
      never: 'Never',
    },
    users: {
      trustScore: 'Trust score',
      shadowBanned: 'Shadow banned',
      shadowBan: 'Shadow ban',
      removeBan: 'Remove ban',
      confirmBan: 'Are you sure you want to shadow ban this user?',
      confirmUnban: 'Are you sure you want to remove the ban from this user?',
      alertsLabel: 'Anomaly alerts',
      dismissAlert: 'Dismiss alert',
      noAlerts: 'No active alerts.',
      alertTypes: {
        high_frequency: 'High frequency',
        price_variance: 'Price variance',
        station_spread: 'Station spread',
      },
      submissionStatuses: {
        pending: 'Pending',
        verified: 'Verified',
        rejected: 'Rejected',
        shadow_rejected: 'Shadow rejected',
      },
      nameColumn: 'User',
      statusColumn: 'Status',
      submissionsColumn: 'Submissions',
      alertsColumn: 'Alerts',
      joinedColumn: 'Joined',
      activeStatus: 'Active',
      searchPlaceholder: 'Search by email or name…',
      searchButton: 'Search',
      noUsersFound: 'No users found.',
    },
    deadLetter: {
      title: 'Dead-Letter Queue',
      description: 'Review unprocessed jobs.',
      columns: {
        submissionId: 'Submission ID',
        station: 'Station',
        failureReason: 'Failure reason',
        attempts: 'Attempts',
        lastAttempt: 'Last attempt',
      },
      retry: 'Retry',
      discard: 'Discard',
      confirmDiscard: 'Are you sure you want to discard this job? The photo will be deleted.',
      noItems: 'No jobs in the dead-letter queue.',
      retrySuccess: 'Job re-queued successfully.',
      discardSuccess: 'Job discarded.',
      errorGeneric: 'Something went wrong. Try again.',
      unknownStation: 'Unknown',
      unknownReason: 'Unknown',
    },
    stations: {
      searchPlaceholder: 'Search by name or address…',
      searchButton: 'Search',
      nameColumn: 'Name',
      addressColumn: 'Address',
      brandColumn: 'Brand',
      noResults: 'No stations found.',
      pricesTitle: 'Current prices',
      fuelTypeColumn: 'Fuel type',
      priceColumn: 'Price (PLN/l)',
      sourceColumn: 'Source',
      lastUpdatedColumn: 'Last updated',
      sources: {
        community: 'Community',
        admin_override: 'Admin override',
        seeded: 'Seeded',
      },
      overrideTitle: 'Override price',
      fuelTypeLabel: 'Fuel type',
      priceLabel: 'Price (PLN/l)',
      reasonLabel: 'Reason',
      reasonPlaceholder: 'Enter reason for override…',
      submitOverride: 'Save override',
      refreshCache: 'Refresh cache',
      confirmRefresh: 'Are you sure you want to refresh the cache for this station?',
      overrideSuccess: 'Price overridden successfully.',
      refreshSuccess: 'Cache refreshed successfully.',
      errorGeneric: 'Something went wrong. Try again.',
      errorNotFound: 'Station not found.',
      detailAction: 'View',
    },
    metrics: {
      tabs: { pipeline: 'Pipeline Health', funnel: 'Contribution Funnel', product: 'Product Metrics', cost: 'API Cost', freshness: 'Data Freshness' },
      period: { today: 'Today', '7d': 'Last 7 days', '30d': 'Last 30 days' },
      pipeline: {
        successRate: 'Success rate (last 1h)',
        processingP50: 'Processing time p50',
        processingP95: 'Processing time p95',
        queueDepth: 'Queue depth',
        activeJobs: 'Active jobs',
        dlqCount: 'Dead-letter queue',
        errorBreakdown: 'Error breakdown (last 1h)',
        noErrors: 'No errors in the last hour.',
        seconds: 's',
        noData: 'No data (no submissions processed in the last hour).',
        autoRefresh: 'Refresh',
      },
      funnel: {
        total: 'Total submissions',
        verified: 'Verified',
        rejected: 'Rejected',
        shadowRejected: 'Shadow rejected',
        pending: 'Pending',
        dlq: 'Dead-letter queue',
        rejectionBreakdown: 'Rejection breakdown',
        drilldownTitle: 'Submissions — ',
        backToFunnel: '← Back',
        columnId: 'ID',
        columnStation: 'Station',
        columnDate: 'Date',
        columnReason: 'Reason',
        noSubmissions: 'No submissions for the selected reason.',
      },
      product: {
        totalMapViews: 'Total map views',
        avgAuthPct: 'Authenticated share',
        totalNewRegs: 'New registrations',
        date: 'Date',
        mapViews: 'Map views',
        authPct: '% authenticated',
        newRegs: 'Registrations',
      },
      flagReasons: {
        logo_mismatch: 'Logo mismatch',
        low_trust: 'Low trust score',
        price_validation_failed: 'Price validation failed',
        gps_no_match: 'GPS no match',
        low_confidence: 'Low OCR confidence',
        dead_letter_discarded: 'Discarded from DLQ',
      },
      cost: {
        today: 'Today',
        currentWeek: 'This week',
        currentMonth: 'This month',
        last3Months: 'Last 3 months',
        imagesLabel: 'Images',
        noData: 'No data.',
      },
      freshness: {
        allRegions: 'All regions',
        sortBy: 'Sort by',
        colName: 'Station',
        colAddress: 'Address',
        colVoivodeship: 'Voivodeship',
        colSource: 'Price source',
        colLastUpdated: 'Last updated',
        colStatus: 'Status',
        stale: 'Stale',
        noData: 'No data',
        staleCount: 'Stations without update (30 days)',
        sources: {
          community: 'Community',
          admin_override: 'Admin override',
          seeded: 'Seeded',
        },
        noResults: 'No stations found.',
      },
      errorGeneric: 'Failed to load. Try again.',
    },
    review: {
      flagReason: {
        logo_mismatch: 'Logo mismatch',
        low_trust: 'Low trust score',
        pb98_below_pb95: 'PB98 < PB95',
        on_premium_below_on: 'ON Premium < ON',
      },
      columns: {
        station: 'Station',
        prices: 'Prices',
        confidence: 'OCR confidence',
        submitted: 'Submitted',
        contributor: 'Contributor',
        flag: 'Flag reason',
      },
      filterLabel: 'Filter:',
      filterAll: 'All',
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
      errorNoStation: 'No station matched — search and assign a station before approving.',
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
      priceOverrideLabel: 'Price correction (optional)',
      stationReassignLabel: 'Reassign station',
      stationSearchPlaceholder: 'Search by name...',
      stationSearchError: 'Search failed. Try again.',
      stationSelected: 'Selected:',
      stationClear: 'Clear',
    },
  },
  uk: {
    nav: {
      submissions: 'Заявки',
      users: 'Користувачі',
      deadLetter: 'Черга помилок',
      stations: 'Станції',
      metrics: 'Метрики',
      stationSync: 'Синхронізація станцій',
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
      stationSync: { title: 'Синхронізація станцій', description: 'Запустіть синхронізацію з Google Places та відстежуйте статус.' },
    },
    stationSync: {
      statusLabel: 'Статус',
      statusIdle: 'Бездіяльний',
      statusRunning: 'Синхронізація…',
      statusFailed: 'Остання синхронізація не вдалася',
      lastCompleted: 'Остання успішна',
      lastFailed: 'Остання помилка',
      stationCount: 'Станцій у базі',
      triggerButton: 'Запустити синхронізацію',
      syncRunning: 'Синхронізація…',
      alreadyRunningTooltip: 'Синхронізація вже виконується',
      errorBanner: 'Остання синхронізація не вдалася — перевірте логи Railway.',
      dismissError: 'Закрити',
      never: 'Ніколи',
    },
    users: {
      trustScore: 'Рейтинг довіри',
      shadowBanned: 'Тіньово заблокований',
      shadowBan: 'Тіньовий бан',
      removeBan: 'Зняти блокування',
      confirmBan: 'Ви впевнені, що хочете накласти тіньовий бан на цього користувача?',
      confirmUnban: 'Ви впевнені, що хочете зняти блокування з цього користувача?',
      alertsLabel: 'Сповіщення про аномалії',
      dismissAlert: 'Відхилити сповіщення',
      noAlerts: 'Немає активних сповіщень.',
      alertTypes: {
        high_frequency: 'Висока частота',
        price_variance: 'Відхилення цін',
        station_spread: 'Розповсюдження по станціях',
      },
      submissionStatuses: {
        pending: 'Очікується',
        verified: 'Підтверджено',
        rejected: 'Відхилено',
        shadow_rejected: 'Тіньово відхилено',
      },
      nameColumn: 'Користувач',
      statusColumn: 'Статус',
      submissionsColumn: 'Заявки',
      alertsColumn: 'Сповіщення',
      joinedColumn: 'Приєднався',
      activeStatus: 'Активний',
      searchPlaceholder: 'Пошук за email або іменем…',
      searchButton: 'Пошук',
      noUsersFound: 'Користувачів не знайдено.',
    },
    deadLetter: {
      title: 'Черга помилок',
      description: 'Перегляд необроблених задач.',
      columns: {
        submissionId: 'ID заявки',
        station: 'Станція',
        failureReason: 'Причина помилки',
        attempts: 'Спроби',
        lastAttempt: 'Остання спроба',
      },
      retry: 'Повторити',
      discard: 'Відхилити',
      confirmDiscard: 'Ви впевнені, що хочете відхилити цю задачу? Фото буде видалено.',
      noItems: 'Черга помилок порожня.',
      retrySuccess: 'Задачу знову додано до черги.',
      discardSuccess: 'Задачу відхилено.',
      errorGeneric: 'Помилка. Спробуйте ще раз.',
      unknownStation: 'Невідомо',
      unknownReason: 'Невідомо',
    },
    stations: {
      searchPlaceholder: 'Пошук за назвою або адресою…',
      searchButton: 'Пошук',
      nameColumn: 'Назва',
      addressColumn: 'Адреса',
      brandColumn: 'Бренд',
      noResults: 'Станцій не знайдено.',
      pricesTitle: 'Поточні ціни',
      fuelTypeColumn: 'Вид пального',
      priceColumn: 'Ціна (PLN/л)',
      sourceColumn: 'Джерело',
      lastUpdatedColumn: 'Остання оновлення',
      sources: {
        community: 'Спільнота',
        admin_override: 'Перевизначення адміна',
        seeded: 'Ініціалізовано',
      },
      overrideTitle: 'Перевизначити ціну',
      fuelTypeLabel: 'Вид пального',
      priceLabel: 'Ціна (PLN/л)',
      reasonLabel: 'Причина',
      reasonPlaceholder: 'Вкажіть причину перевизначення…',
      submitOverride: 'Зберегти перевизначення',
      refreshCache: 'Оновити кеш',
      confirmRefresh: 'Ви впевнені, що хочете оновити кеш для цієї станції?',
      overrideSuccess: 'Ціну успішно перевизначено.',
      refreshSuccess: 'Кеш успішно оновлено.',
      errorGeneric: 'Помилка. Спробуйте ще раз.',
      errorNotFound: 'Станцію не знайдено.',
      detailAction: 'Деталі',
    },
    metrics: {
      tabs: { pipeline: 'Здоров\'я pipeline', funnel: 'Воронка внесків', product: 'Метрики продукту', cost: 'Витрати API', freshness: 'Актуальність даних' },
      period: { today: 'Сьогодні', '7d': 'Останні 7 днів', '30d': 'Останні 30 днів' },
      pipeline: {
        successRate: 'Ефективність (остання год.)',
        processingP50: 'Час обробки p50',
        processingP95: 'Час обробки p95',
        queueDepth: 'Глибина черги',
        activeJobs: 'Активні завдання',
        dlqCount: 'Черга помилок (DLQ)',
        errorBreakdown: 'Розподіл помилок (остання год.)',
        noErrors: 'Помилок за останню годину немає.',
        seconds: 'с',
        noData: 'Немає даних (немає оброблених заявок за останню годину).',
        autoRefresh: 'Оновити',
      },
      funnel: {
        total: 'Всього заявок',
        verified: 'Підтверджено',
        rejected: 'Відхилено',
        shadowRejected: 'Тіньово відхилено',
        pending: 'Очікується',
        dlq: 'Черга помилок',
        rejectionBreakdown: 'Розподіл відхилень',
        drilldownTitle: 'Заявки — ',
        backToFunnel: '← Назад',
        columnId: 'ID',
        columnStation: 'Станція',
        columnDate: 'Дата',
        columnReason: 'Причина',
        noSubmissions: 'Немає заявок для вибраної причини.',
      },
      product: {
        totalMapViews: 'Всього переглядів карти',
        avgAuthPct: 'Частка авторизованих',
        totalNewRegs: 'Нові реєстрації',
        date: 'Дата',
        mapViews: 'Перегляди карти',
        authPct: '% авторизованих',
        newRegs: 'Реєстрації',
      },
      flagReasons: {
        logo_mismatch: 'Невідповідність логотипу',
        low_trust: 'Низький рейтинг довіри',
        price_validation_failed: 'Помилка валідації ціни',
        gps_no_match: 'Немає збігу GPS',
        low_confidence: 'Низька точність OCR',
        dead_letter_discarded: 'Відхилено з DLQ',
      },
      cost: {
        today: 'Сьогодні',
        currentWeek: 'Поточний тиждень',
        currentMonth: 'Поточний місяць',
        last3Months: 'Останні 3 місяці',
        imagesLabel: 'Зображення',
        noData: 'Немає даних.',
      },
      freshness: {
        allRegions: 'Всі регіони',
        sortBy: 'Сортувати за',
        colName: 'Станція',
        colAddress: 'Адреса',
        colVoivodeship: 'Воєводство',
        colSource: 'Джерело ціни',
        colLastUpdated: 'Остання оновлення',
        colStatus: 'Статус',
        stale: 'Застарілий',
        noData: 'Немає даних',
        staleCount: 'Станцій без оновлення (30 днів)',
        sources: {
          community: 'Спільнота',
          admin_override: 'Перевизначення адміна',
          seeded: 'Ініціалізовано',
        },
        noResults: 'Станцій не знайдено.',
      },
      errorGeneric: 'Помилка завантаження. Спробуйте ще раз.',
    },
    review: {
      flagReason: {
        logo_mismatch: 'Невідповідність логотипу',
        low_trust: 'Низький рейтинг довіри',
        pb98_below_pb95: 'PB98 < PB95',
        on_premium_below_on: 'ON Premium < ON',
      },
      columns: {
        station: 'Станція',
        prices: 'Ціни',
        confidence: 'Точність OCR',
        submitted: 'Подано',
        contributor: 'Автор',
        flag: 'Причина позначки',
      },
      filterLabel: 'Фільтр:',
      filterAll: 'Усі',
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
      errorNoStation: 'Станцію не знайдено — знайдіть і призначте станцію перед затвердженням.',
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
      priceOverrideLabel: 'Корекція цін (необов\'язково)',
      stationReassignLabel: 'Змінити станцію',
      stationSearchPlaceholder: 'Пошук за назвою...',
      stationSearchError: 'Помилка пошуку. Спробуйте ще раз.',
      stationSelected: 'Вибрано:',
      stationClear: 'Очистити',
    },
  },
} as const;

export interface MetricsTranslations {
  tabs: { pipeline: string; funnel: string; product: string; cost: string; freshness: string };
  period: { today: string; '7d': string; '30d': string };
  pipeline: {
    successRate: string;
    processingP50: string;
    processingP95: string;
    queueDepth: string;
    activeJobs: string;
    dlqCount: string;
    errorBreakdown: string;
    noErrors: string;
    seconds: string;
    noData: string;
    autoRefresh: string;
  };
  funnel: {
    total: string;
    verified: string;
    rejected: string;
    shadowRejected: string;
    pending: string;
    dlq: string;
    rejectionBreakdown: string;
    drilldownTitle: string;
    backToFunnel: string;
    columnId: string;
    columnStation: string;
    columnDate: string;
    columnReason: string;
    noSubmissions: string;
  };
  product: {
    totalMapViews: string;
    avgAuthPct: string;
    totalNewRegs: string;
    date: string;
    mapViews: string;
    authPct: string;
    newRegs: string;
  };
  flagReasons: Record<string, string>;
  cost: {
    today: string;
    currentWeek: string;
    currentMonth: string;
    last3Months: string;
    imagesLabel: string;
    noData: string;
  };
  freshness: {
    allRegions: string;
    sortBy: string;
    colName: string;
    colAddress: string;
    colVoivodeship: string;
    colSource: string;
    colLastUpdated: string;
    colStatus: string;
    stale: string;
    noData: string;
    staleCount: string;
    sources: { community: string; admin_override: string; seeded: string };
    noResults: string;
  };
  errorGeneric: string;
}

export interface StationsTranslations {
  searchPlaceholder: string;
  searchButton: string;
  nameColumn: string;
  addressColumn: string;
  brandColumn: string;
  noResults: string;
  pricesTitle: string;
  fuelTypeColumn: string;
  priceColumn: string;
  sourceColumn: string;
  lastUpdatedColumn: string;
  sources: {
    community: string;
    admin_override: string;
    seeded: string;
  };
  overrideTitle: string;
  fuelTypeLabel: string;
  priceLabel: string;
  reasonLabel: string;
  reasonPlaceholder: string;
  submitOverride: string;
  refreshCache: string;
  confirmRefresh: string;
  overrideSuccess: string;
  refreshSuccess: string;
  errorGeneric: string;
  errorNotFound: string;
  detailAction: string;
}

export interface StationSyncTranslations {
  statusLabel: string;
  statusIdle: string;
  statusRunning: string;
  statusFailed: string;
  lastCompleted: string;
  lastFailed: string;
  stationCount: string;
  triggerButton: string;
  syncRunning: string;
  alreadyRunningTooltip: string;
  errorBanner: string;
  dismissError: string;
  never: string;
}

export interface Translations {
  nav: { submissions: string; users: string; deadLetter: string; stations: string; metrics: string; stationSync: string };
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
  stations: StationsTranslations;
  metrics: MetricsTranslations;
  stationSync: StationSyncTranslations;
  users: {
    trustScore: string;
    shadowBanned: string;
    shadowBan: string;
    removeBan: string;
    confirmBan: string;
    confirmUnban: string;
    alertsLabel: string;
    dismissAlert: string;
    noAlerts: string;
    alertTypes: Record<string, string>;
    submissionStatuses: Record<string, string>;
    nameColumn: string;
    statusColumn: string;
    submissionsColumn: string;
    alertsColumn: string;
    joinedColumn: string;
    activeStatus: string;
    searchPlaceholder: string;
    searchButton: string;
    noUsersFound: string;
  };
  deadLetter: {
    title: string;
    description: string;
    columns: {
      submissionId: string;
      station: string;
      failureReason: string;
      attempts: string;
      lastAttempt: string;
    };
    retry: string;
    discard: string;
    confirmDiscard: string;
    noItems: string;
    retrySuccess: string;
    discardSuccess: string;
    errorGeneric: string;
    unknownStation: string;
    unknownReason: string;
  };
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
    filterLabel: string;
    filterAll: string;
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
    errorNoStation: string;
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
    priceOverrideLabel: string;
    stationReassignLabel: string;
    stationSearchPlaceholder: string;
    stationSearchError: string;
    stationSelected: string;
    stationClear: string;
  };
  sections: {
    submissions: { title: string; description: string };
    users: { title: string; description: string };
    deadLetter: { title: string; description: string };
    stations: { title: string; description: string };
    metrics: { title: string; description: string };
    stationSync: { title: string; description: string };
  };
}

export function getTranslations(locale: Locale): Translations {
  return translations[locale];
}
