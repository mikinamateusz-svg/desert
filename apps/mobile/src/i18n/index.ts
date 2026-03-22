import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';

import en from './locales/en';
import pl from './locales/pl';
import uk from './locales/uk';

const deviceLocale = Localization.getLocales()[0]?.languageCode ?? 'en';
const supportedLocales = ['en', 'pl', 'uk'];
const lng = supportedLocales.includes(deviceLocale) ? deviceLocale : 'en';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      pl: { translation: pl },
      uk: { translation: uk },
    },
    lng,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });

export default i18n;
