import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';

export default function AppLayout() {
  const { t } = useTranslation();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: '#1a1a1a', borderTopColor: '#2a2a2a' },
        tabBarActiveTintColor: '#f59e0b',
        tabBarInactiveTintColor: '#aaa',
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('nav.map') }} />
      <Tabs.Screen name="activity" options={{ title: t('nav.activity') }} />
      <Tabs.Screen name="alerts" options={{ title: t('nav.alerts') }} />
      <Tabs.Screen name="account" options={{ title: t('nav.account') }} />
    </Tabs>
  );
}
