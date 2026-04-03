import { useState, useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Slot } from 'expo-router';
import { AuthProvider } from '../src/store/auth.store';
import { initI18n } from '../src/i18n';
import { initQueueDb } from '../src/services/queueDb';
import { startQueueProcessor, stopQueueProcessor } from '../src/services/queueProcessor';

export default function RootLayout() {
  const [i18nReady, setI18nReady] = useState(false);

  useEffect(() => {
    void initI18n().then(() => setI18nReady(true));
  }, []);

  useEffect(() => {
    initQueueDb();
    startQueueProcessor();
    return () => stopQueueProcessor();
  }, []);

  return (
    <AuthProvider>
      {!i18nReady ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" />
        </View>
      ) : (
        <Slot />
      )}
    </AuthProvider>
  );
}
