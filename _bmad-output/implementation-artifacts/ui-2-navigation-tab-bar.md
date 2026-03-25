# Story UI-2: Navigation — Bottom Tab Bar & Route Structure

Status: review

## Story

As a **driver**,
I want a focused three-tab bottom bar and in-map access to alerts and account settings,
So that the primary navigation reflects core daily use (map, contributions, fuel log) while
secondary functions stay out of the way until needed.

## Why

The current tab bar shows seven items including debug routes. The agreed navigation structure
places only high-frequency screens in the tab bar. Alerts and account settings belong in the map
chrome rather than the bottom bar — they are contextual actions, not destinations a driver switches
between repeatedly.

**Resolved navigation structure:**
- **Bottom tab bar — 3 tabs:** Map, Activity, Log (consumption & costs)
- **Map chrome — floating buttons:** Bell (→ Alerts), Hamburger (→ Account)
- **Sub-screens navigable via Account:** Privacy Settings, Feedback, Delete Account
- **Hidden from tab bar:** Alerts, Account, Feedback, Privacy Settings, Delete Account

The bell and hamburger buttons are defined here (route registration), but their visual
implementation in the map chrome is specified in Story UI-4.

## Acceptance Criteria

1. **Given** the app is open **When** the user looks at the bottom of any screen **Then** exactly
   three tabs are visible: Map, Activity, Log. No other tabs.

2. **Given** the tab bar **When** rendered **Then** background is `tokens.tabBar.background`
   (`#ffffff`), top border is `tokens.tabBar.border` (`#e5e7eb`), active tint is
   `tokens.tabBar.active` (`#f59e0b`), inactive tint is `tokens.tabBar.inactive` (`#9ca3af`).

3. **Given** each tab **When** rendered **Then** an outline icon is shown when inactive and a
   filled icon when active:
   - Map: `map-outline` / `map`
   - Activity: `time-outline` / `time`
   - Log: `bar-chart-outline` / `bar-chart`

4. **Given** the Log tab **When** tapped **Then** a placeholder screen renders with the app
   background colour and a "Coming soon" message. No crash, no blank screen.

5. **Given** the user taps the bell button in the map chrome **When** navigated
   **Then** the Alerts screen renders with a native back button. The tab bar is NOT visible
   on the Alerts screen.

6. **Given** the user taps the hamburger button in the map chrome **When** navigated
   **Then** the Account screen renders with a native back button. The tab bar is NOT visible.

7. **Given** the Account screen **When** the user navigates to Privacy Settings, Feedback,
   or Delete Account **Then** those sub-screens render with a native back button.

8. **Given** all three languages (EN, PL, UK) **When** the screen renders **Then** all tab labels
   and screen titles are localised.

9. **Given** `tsc --noEmit` **When** run **Then** zero type errors.

## Tasks / Subtasks

**Prerequisite:** UI-1 tokens must exist. Import `tokens` from `'../../src/theme'`.

### Phase 1 — Create Log placeholder screen

- [x] **1.1** Create `apps/mobile/app/(app)/log.tsx`:

```tsx
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { tokens } from '../../src/theme';

export default function LogScreen() {
  const { t } = useTranslation();
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('log.comingSoonTitle')}</Text>
      <Text style={styles.subtitle}>{t('log.comingSoonSubtitle')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: tokens.surface.page,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: tokens.brand.ink,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: tokens.neutral.n400,
    textAlign: 'center',
  },
});
```

### Phase 2 — Update `(app)/_layout.tsx`

- [x] **2.1** Replace the entire file:

```tsx
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
```

### Phase 3 — i18n keys

- [x] **3.1** Add missing keys to all three locales:

  **en.ts:**
  ```ts
  nav: {
    // existing keys...
    log: 'Log',
    alerts: 'Alerts',
    account: 'Account',
    feedback: 'Feedback',
    privacySettings: 'Privacy Settings',
    deleteAccount: 'Delete Account',
  },
  log: {
    comingSoonTitle: 'Fuel Log — Coming Soon',
    comingSoonSubtitle: 'Track your consumption and fuel costs here.',
  },
  ```

  **pl.ts:**
  ```ts
  nav: {
    log: 'Dziennik',
    alerts: 'Alerty',
    account: 'Konto',
    feedback: 'Opinia',
    privacySettings: 'Prywatność',
    deleteAccount: 'Usuń konto',
  },
  log: {
    comingSoonTitle: 'Dziennik paliwa — wkrótce',
    comingSoonSubtitle: 'Śledź zużycie i koszty paliwa.',
  },
  ```

  **uk.ts:**
  ```ts
  nav: {
    log: 'Журнал',
    alerts: 'Сповіщення',
    account: 'Акаунт',
    feedback: 'Відгук',
    privacySettings: 'Конфіденційність',
    deleteAccount: 'Видалити акаунт',
  },
  log: {
    comingSoonTitle: 'Журнал пального — незабаром',
    comingSoonSubtitle: 'Відстежуйте витрати та витрати на пальне.',
  },
  ```

### Phase 4 — Verify

- [ ] **4.1** Confirm exactly 3 tabs visible: Map, Activity, Log.
- [ ] **4.2** Tab bar is white with amber active, grey inactive, Ionicons on each tab.
- [ ] **4.3** Log tab taps through to the placeholder screen without crash.
- [ ] **4.4** `router.push('/(app)/alerts')` and `router.push('/(app)/account')` work (tested manually or via UI-4 chrome buttons once that story is implemented).
- [ ] **4.5** Tab bar is NOT visible when on Alerts or Account screens.
- [x] **4.6** `tsc --noEmit` — zero errors.

## Definition of Done

- Exactly 3 tabs: Map, Activity, Log
- Tab bar: white bg, amber active, grey inactive, correct Ionicons
- Log placeholder screen renders without crash
- Alerts and Account accessible via `router.push`, no tab bar shown on those screens
- Sub-screens (feedback, privacy-settings, delete-account) have native back button headers
- All i18n keys present in EN, PL, UK
- `tsc --noEmit` passes
