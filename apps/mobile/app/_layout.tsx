import { useState, useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Slot } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthProvider } from '../src/store/auth.store';
import { initI18n } from '../src/i18n';
import { initQueueDb } from '../src/services/queueDb';
import { startQueueProcessor, stopQueueProcessor } from '../src/services/queueProcessor';
import {
  WelcomeCarousel,
  WELCOME_COMPLETED_KEY,
} from '../src/components/onboarding/WelcomeCarousel';

export default function RootLayout() {
  const [i18nReady, setI18nReady] = useState(false);
  // Story 1.14 — first-launch welcome carousel. Three states:
  //   null     → reading AsyncStorage; render nothing yet
  //   true     → user has completed; never show carousel
  //   false    → user hasn't completed; show carousel above the rest
  // Reading the completion flag must precede the navigation tree mount
  // so the carousel covers the map underneath without a flash of map.
  const [welcomeCompleted, setWelcomeCompleted] = useState<boolean | null>(null);

  useEffect(() => {
    void initI18n().then(() => setI18nReady(true));
  }, []);

  useEffect(() => {
    initQueueDb();
    startQueueProcessor();
    return () => stopQueueProcessor();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const flag = await AsyncStorage.getItem(WELCOME_COMPLETED_KEY);
        setWelcomeCompleted(flag === 'true');
      } catch {
        // AsyncStorage failure → assume completed so a broken storage
        // layer doesn't trap the user behind the carousel forever.
        setWelcomeCompleted(true);
      }
    })();
  }, []);

  const ready = i18nReady && welcomeCompleted !== null;

  return (
    <AuthProvider>
      {!ready ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" />
        </View>
      ) : welcomeCompleted === true ? (
        <Slot />
      ) : (
        // P6 (1.14 review) — defer mounting <Slot /> until the carousel
        // completes. Otherwise the map screen mounts behind the Modal and
        // triggers location-permission prompts / fetches tiles concurrently
        // with the welcome flow. Modal-fullScreen hides this visually but
        // can't suppress the system permission prompts that may stack.
        <WelcomeCarousel
          visible
          mode="first-run"
          onComplete={() => setWelcomeCompleted(true)}
        />
      )}
    </AuthProvider>
  );
}
