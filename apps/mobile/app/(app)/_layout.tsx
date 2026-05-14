import { useEffect } from 'react';
import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Notifications from 'expo-notifications';
import { tokens } from '../../src/theme';
import { MonthlySummaryRepromptTrigger } from '../../src/components/MonthlySummaryRepromptTrigger';
import { useAuth } from '../../src/store/auth.store';
import { apiRecordNotificationEvent } from '../../src/api/notifications';

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
  const { accessToken } = useAuth();

  // Story 6.8 — record `notification_opened` events when the user taps a
  // push notification and lands in the app. The alert services tag each
  // push with `alertType` in the `data` payload; we forward that to the
  // analytics endpoint so admin engagement metrics can compute
  // opened/sent per alert family. Best-effort, swallowed errors.
  useEffect(() => {
    if (!accessToken) return;
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as { alertType?: unknown } | null;
      const alertType =
        data && typeof data.alertType === 'string' ? data.alertType : null;
      if (!alertType) return;
      apiRecordNotificationEvent(accessToken, 'notification_opened', null, alertType).catch(
        () => {},
      );
    });
    return () => sub.remove();
  }, [accessToken]);

  return (
    <>
      {/* Story 6.6 — sibling trigger evaluates the monthly-summary
          re-prompt on app open. Renders the sheet when conditions are
          met; renders nothing otherwise. */}
      <MonthlySummaryRepromptTrigger />
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
      {/* Story 6.10 — notifications/prefs route, relocated from /alerts so the
          alerts route can become the status-banner surface tap-target from
          the bell icon. Reachable from the Account screen. */}
      <Tabs.Screen
        name="notifications"
        options={{
          href: null,
          headerShown: true,
          title: t('nav.notifications'),
          headerStyle: hiddenHeaderStyle,
          headerTintColor: tokens.brand.ink,
          headerTitleStyle: { fontWeight: '600' as const },
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          href: null,
          headerShown: false,
        }}
      />

      {/* ── Contribution flow: full-screen camera + confirmation, no tab bar ── */}
      <Tabs.Screen
        name="capture"
        options={{ href: null, headerShown: false }}
      />
      <Tabs.Screen
        name="confirm"
        options={{ href: null, headerShown: false }}
      />
      <Tabs.Screen
        name="flag-wrong-thanks"
        options={{ href: null, headerShown: false }}
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

      {/* ── Vehicle setup + edit: navigated from the Log tab ── */}
      <Tabs.Screen
        name="vehicle-setup"
        options={{ href: null, headerShown: false }}
      />
      <Tabs.Screen
        name="vehicle/[id]"
        options={{ href: null, headerShown: false }}
      />

      {/* ── Fill-up capture: Story 5.2, Phase 2-gated entry from map FAB ── */}
      <Tabs.Screen
        name="fillup-capture"
        options={{ href: null, headerShown: false }}
      />

      {/* ── Odometer capture: Story 5.4, Phase 2-gated entry from log tab ── */}
      <Tabs.Screen
        name="odometer-capture"
        options={{ href: null, headerShown: false }}
      />

      {/* ── Savings summary: Story 5.7, Phase 2-gated entry from log tab + 6.5 deep link ── */}
      <Tabs.Screen
        name="savings-summary"
        options={{ href: null, headerShown: false }}
      />

      </Tabs>
    </>
  );
}
