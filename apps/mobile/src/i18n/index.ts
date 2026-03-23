import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';

import en from './locales/en';
import pl from './locales/pl';
import uk from './locales/uk';

const LANGUAGE_KEY = 'desert:language';
const SUPPORTED = ['en', 'pl', 'uk'] as const;
type SupportedLocale = (typeof SUPPORTED)[number];

function isSupportedLocale(lang: string | null): lang is SupportedLocale {
  return SUPPORTED.includes(lang as SupportedLocale);
}

// TODO: No mobile Jest test infrastructure set up yet — unit tests for initI18n/changeLanguage
// are deferred until Jest is configured for the mobile app (separate story).

/** Call once at app startup (before first render). Reads persisted language, falls back to device locale, then 'en'. */
export async function initI18n(): Promise<void> {
  // P3: Guard against double invocation (React Native New Architecture / StrictMode double-effect)
  if (i18n.isInitialized) return;

  const deviceLocale = Localization.getLocales()[0]?.languageCode ?? 'en';

  // P1: Wrap AsyncStorage read in try/catch — storage corruption or quota errors must not
  // leave the app stuck on the loading spinner. Fall back to device locale / 'en'.
  let savedLang: string | null = null;
  try {
    savedLang = await AsyncStorage.getItem(LANGUAGE_KEY);
  } catch {
    savedLang = null;
  }

  const lng: SupportedLocale = isSupportedLocale(savedLang)
    ? savedLang
    : isSupportedLocale(deviceLocale)
      ? deviceLocale
      : 'en';

  await i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      pl: { translation: pl },
      uk: { translation: uk },
    },
    lng,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });
}

/** Persists language selection and calls i18n.changeLanguage(). */
export async function changeLanguage(lang: SupportedLocale): Promise<void> {
  // P2: Wrap AsyncStorage write in try/catch — persistence failure must not prevent the
  // in-memory language change. Warn so the issue is visible in logs without crashing.
  try {
    await AsyncStorage.setItem(LANGUAGE_KEY, lang);
  } catch (err) {
    console.warn('[i18n] Failed to persist language preference:', err);
  }
  await i18n.changeLanguage(lang);
}

export { SUPPORTED as SUPPORTED_LOCALES };
export type { SupportedLocale };
export default i18n;
