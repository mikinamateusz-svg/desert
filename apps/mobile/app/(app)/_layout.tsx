import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import { tokens } from '../../src/theme';

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

function tabIcon(outlineName: IoniconsName, filledName: IoniconsName) {
  return ({ color, focused }: { color: string; focused: boolean }) => (
    <Ionicons name={focused ? filledName : outlineName} size={24} color={color} />
  );
}

const hiddenHeaderStyle = {
  backgroundColor: tokens.surface.card,
  shadowColor: 'transparent',
  elevation: 0,
  borderBottomWidth: 1,
  borderBottomColor: tokens.neutral.n200,
} as const;

export default function AppLayout() {
  const { t } = useTranslation();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: tokens.tabBar.background,
          borderTopColor: tokens.tabBar.border,
          borderTopWidth: 1,
        },
        tabBarActiveTintColor: tokens.tabBar.active,
        tabBarInactiveTintColor: tokens.tabBar.inactive,
      }}
    >
      {/* ── Bottom tab bar: three core screens ──────────────────── */}
      <Tabs.Screen
        name="index"
        options={{
          title: t('nav.map'),
          tabBarIcon: tabIcon('map-outline', 'map'),
        }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          title: t('nav.activity'),
          tabBarIcon: tabIcon('time-outline', 'time'),
        }}
      />
      <Tabs.Screen
        name="log"
        options={{
          title: t('nav.log'),
          tabBarIcon: tabIcon('bar-chart-outline', 'bar-chart'),
        }}
      />

      {/* ── Map chrome screens: hidden from tab bar, accessed via map buttons ── */}
      <Tabs.Screen
        name="alerts"
        options={{
          href: null,
          headerShown: true,
          title: t('nav.alerts'),
          headerStyle: hiddenHeaderStyle,
          headerTintColor: tokens.brand.ink,
          headerTitleStyle: { fontWeight: '600' as const },
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          href: null,
          headerShown: true,
          title: t('nav.account'),
          headerStyle: hiddenHeaderStyle,
          headerTintColor: tokens.brand.ink,
          headerTitleStyle: { fontWeight: '600' as const },
        }}
      />

      {/* ── Sub-screens: navigated from Account ── */}
      <Tabs.Screen
        name="feedback"
        options={{
          href: null,
          headerShown: true,
          title: t('nav.feedback'),
          headerStyle: hiddenHeaderStyle,
          headerTintColor: tokens.brand.ink,
          headerTitleStyle: { fontWeight: '600' as const },
        }}
      />
      <Tabs.Screen
        name="privacy-settings"
        options={{
          href: null,
          headerShown: true,
          title: t('nav.privacySettings'),
          headerStyle: hiddenHeaderStyle,
          headerTintColor: tokens.brand.ink,
          headerTitleStyle: { fontWeight: '600' as const },
        }}
      />
      <Tabs.Screen
        name="delete-account"
        options={{
          href: null,
          headerShown: true,
          title: t('nav.deleteAccount'),
          headerStyle: hiddenHeaderStyle,
          headerTintColor: tokens.brand.ink,
          headerTitleStyle: { fontWeight: '600' as const },
        }}
      />

      {/* ── Web-only: hidden on native ── */}
      <Tabs.Screen
        name="index.web"
        options={{ href: null }}
      />
    </Tabs>
  );
}
