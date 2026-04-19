# Story 6.6: Smart Notification Re-prompting

Status: ready-for-dev

## Story

As a **driver**,
I want the app to remind me about the value of notifications at the right moment,
So that I don't permanently miss out on alerts just because I dismissed the permission dialog at onboarding.

## Acceptance Criteria

**AC1 — Photo submission re-prompt:**
Given a driver has no OS notification permission (no `expo_push_token` stored in their `NotificationPreference`)
When they successfully submit a price board photo and see the confirmation screen
Then a `NotificationRepromptSheet` appears after a 1-second delay with: "Want to know when prices drop near you? Enable alerts"
And a single "Enable" CTA that triggers `Notifications.requestPermissionsAsync()`
And a "No thanks" dismiss option

**AC2 — Monthly summary re-prompt:**
Given a driver has no OS notification permission
And Story 6.5 has calculated a monthly summary for that driver (Redis key exists: `monthly:summary:calculated:{userId}`)
When the driver next opens the app
Then a `NotificationRepromptSheet` appears with personalized copy: "You saved 94 PLN last month — enable notifications to get your summary delivered automatically"
And the savings amount is loaded from `GET /v1/me/notifications/summary-reprompt`

**AC3 — Show only once per trigger:**
Given a re-prompt has been shown for a trigger (photo or monthly)
When that trigger condition occurs again
Then the prompt is not shown — AsyncStorage flag `@reprompt:photo_shown` / `@reprompt:monthly_shown` prevents repetition

**AC4 — Two-strike rule:**
Given both photo and monthly re-prompts have been shown
When any further re-prompt opportunity arises
Then no further prompts are shown — the driver's decision is respected permanently

**AC5 — Permission granted flow:**
Given a driver taps "Enable" on either re-prompt
When `Notifications.requestPermissionsAsync()` returns `'granted'`
Then the Expo push token is retrieved and saved via `PATCH /v1/me/notifications` (same flow as `alerts.tsx`)
And the driver is navigated to `/(app)/alerts` (the alert preferences panel from Story 6.4)
And the AsyncStorage flag for that trigger is set

**AC6 — Permission denied or dismissed:**
Given a driver taps "No thanks" or taps "Enable" but the OS grants denied
When the sheet closes
Then the AsyncStorage flag for that trigger is set (no further re-prompt for that trigger)
And the driver remains on their current screen

**AC7 — Language-aware:**
Given a driver's selected language is Polish, English, or Ukrainian
When the re-prompt sheet is shown
Then all text is in that language

## Tasks / Subtasks

- [ ] T1: Backend — `GET /v1/me/notifications/summary-reprompt` (AC2)
  - [ ] T1a: Add endpoint to `NotificationsController`
  - [ ] T1b: Implement in `NotificationsService`: check Redis key `monthly:summary:calculated:{userId}` exists; if yes, query previous month's total savings from `FillUp` (same aggregate as Story 6.5's `aggregateSavings()`); return `{ pending: boolean; savedPln: number | null }`
  - [ ] T1c: If Redis key absent or user already has `expo_push_token` → return `{ pending: false, savedPln: null }`

- [ ] T2: Mobile — `NotificationRepromptSheet` component (AC1, AC2, AC5, AC6, AC7)
  - [ ] T2a: Create `apps/mobile/src/components/NotificationRepromptSheet.tsx` — bottom sheet modal (similar structure to `SoftSignUpSheet`); accepts `variant: 'photo' | 'monthly'` prop; accepts `savedPln?: number` for monthly copy
  - [ ] T2b: "Enable" button: calls `requestPermission()` from `useNotificationPermission`; on `'granted'` → calls `getExpoPushToken()` → saves token via `apiUpdateNotificationPreferences`; navigates to `/(app)/alerts`; in all cases calls `onDismiss(triggerKey)` to set AsyncStorage flag
  - [ ] T2c: "No thanks" button: calls `onDismiss(triggerKey)` only — no navigation

- [ ] T3: Mobile — photo submission trigger in `confirm.tsx` (AC1, AC3, AC4)
  - [ ] T3a: After confirmation screen mounts: check `@reprompt:photo_shown` in AsyncStorage; if set → skip; also check `@reprompt:monthly_shown` — if both set → skip (AC4)
  - [ ] T3b: Check if user has push token (`NotificationPreference.expo_push_token` — available from user profile or auth store); if token exists → skip
  - [ ] T3c: After 1-second delay: show `<NotificationRepromptSheet variant="photo" />`

- [ ] T4: Mobile — monthly summary trigger in `_layout.tsx` (AC2, AC3, AC4)
  - [ ] T4a: On app mount (after auth check): check AsyncStorage for `@reprompt:photo_shown` and `@reprompt:monthly_shown`; if both set → skip all checks (AC4)
  - [ ] T4b: Check if user has push token; if exists → skip
  - [ ] T4c: If `@reprompt:monthly_shown` not set: call `GET /v1/me/notifications/summary-reprompt`; if `pending: true` → show `<NotificationRepromptSheet variant="monthly" savedPln={response.savedPln} />`

- [ ] T5: Mobile — API client (AC2)
  - [ ] T5a: Add `apiGetSummaryReprompt(accessToken): Promise<{ pending: boolean; savedPln: number | null }>` to `apps/mobile/src/api/notifications.ts`

- [ ] T6: i18n — all 3 locales (AC1, AC2, AC7)
  - [ ] T6a: Extend `notifications` section in `apps/mobile/src/i18n/locales/{en,pl,uk}.ts` (see Dev Notes); the existing `repromptTitle`, `repromptSubtitle`, `repromptEnable`, `repromptDismiss` keys cover the photo variant — add monthly-specific keys

- [ ] T7: Tests
  - [ ] T7a: `notifications.service.spec.ts` additions — `getSummaryReprompt`: returns `pending: true` with savedPln when Redis key exists and user has no token; returns `pending: false` when Redis key absent; returns `pending: false` when user already has push token
  - [ ] T7b: Full regression suite — all existing tests still pass

## Dev Notes

### GET /v1/me/notifications/summary-reprompt

```ts
// NotificationsService
async getSummaryReprompt(userId: string): Promise<{ pending: boolean; savedPln: number | null }> {
  // 1. Check if user already has a push token — no re-prompt needed
  const pref = await this.prisma.notificationPreference.findUnique({
    where: { user_id: userId },
    select: { expo_push_token: true },
  });
  if (pref?.expo_push_token) return { pending: false, savedPln: null };

  // 2. Check Redis key set by Story 6.5
  let hasPendingKey = false;
  try {
    hasPendingKey = (await this.redis.get(`monthly:summary:calculated:${userId}`)) !== null;
  } catch {
    // Redis unavailable — fail-closed: don't show re-prompt on error
  }
  if (!hasPendingKey) return { pending: false, savedPln: null };

  // 3. Compute previous month savings for personalized copy
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const monthEnd   = new Date(now.getFullYear(), now.getMonth(), 1);

  const result = await this.prisma.$queryRaw<[{ total_savings: number | null }]>`
    SELECT SUM((area_avg_at_fillup - price_per_litre_pln) * litres)::float AS total_savings
    FROM "FillUp"
    WHERE user_id = ${userId}
      AND filled_at >= ${monthStart}
      AND filled_at <  ${monthEnd}
      AND area_avg_at_fillup IS NOT NULL
  `;

  const savedPln = result[0]?.total_savings ?? null;
  return { pending: true, savedPln: savedPln && savedPln > 0 ? Math.round(savedPln) : null };
}
```

### NotificationRepromptSheet component

```tsx
// apps/mobile/src/components/NotificationRepromptSheet.tsx
interface Props {
  visible: boolean;
  variant: 'photo' | 'monthly';
  savedPln?: number;  // only for monthly variant
  onDismiss: () => void;
}

export function NotificationRepromptSheet({ visible, variant, savedPln, onDismiss }: Props) {
  const { t } = useTranslation();
  const { requestPermission, getExpoPushToken } = useNotificationPermission();
  const { accessToken } = useAuth();
  const router = useRouter();

  async function handleEnable() {
    const status = await requestPermission();
    if (status === 'granted') {
      const token = await getExpoPushToken();
      if (token && accessToken) {
        await apiUpdateNotificationPreferences(accessToken, { expo_push_token: token })
          .catch(() => {}); // best-effort — token saved on next alerts screen load
      }
      onDismiss();
      router.push('/(app)/alerts');
    } else {
      onDismiss(); // denied by OS — record as shown
    }
  }

  const title = variant === 'photo'
    ? t('notifications.repromptTitle')               // existing key
    : t('notifications.repromptMonthlyTitle', { amount: savedPln ?? '?' });

  const subtitle = variant === 'photo'
    ? t('notifications.repromptSubtitle')            // existing key
    : t('notifications.repromptMonthlySubtitle');

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onDismiss}>
      <Pressable style={styles.overlay} onPress={onDismiss} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
        <TouchableOpacity style={styles.enableButton} onPress={() => void handleEnable()}>
          <Text style={styles.enableText}>{t('notifications.repromptEnable')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.dismissButton} onPress={onDismiss}>
          <Text style={styles.dismissText}>{t('notifications.repromptDismiss')}</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}
```

### AsyncStorage keys + two-strike logic

```ts
const REPROMPT_PHOTO_KEY   = '@reprompt:photo_shown';
const REPROMPT_MONTHLY_KEY = '@reprompt:monthly_shown';

// Check before showing either prompt
async function shouldSkipAllReprompts(): Promise<boolean> {
  const [photo, monthly] = await Promise.all([
    AsyncStorage.getItem(REPROMPT_PHOTO_KEY),
    AsyncStorage.getItem(REPROMPT_MONTHLY_KEY),
  ]);
  return photo !== null && monthly !== null; // both shown → no more prompts
}

// Call when prompt is dismissed (regardless of user response)
async function recordRepromptShown(key: string): Promise<void> {
  await AsyncStorage.setItem(key, 'true').catch(() => {}); // best-effort
}
```

### confirm.tsx changes

```tsx
// After successful submission (after "thank you" state is shown):
useEffect(() => {
  if (!submissionSuccessful) return;

  const checkAndShowReprompt = async () => {
    if (await shouldSkipAllReprompts()) return;
    const alreadyShown = await AsyncStorage.getItem(REPROMPT_PHOTO_KEY);
    if (alreadyShown) return;
    if (userHasPushToken) return; // already has permission

    // 1s delay — let the "thank you" UI settle
    await new Promise(resolve => setTimeout(resolve, 1000));
    setShowPhotoReprompt(true);
  };

  void checkAndShowReprompt();
}, [submissionSuccessful]);
```

`userHasPushToken` is derived from `NotificationPreference.expo_push_token` — available from the auth store or user profile (already loaded at this point).

### _layout.tsx changes

```tsx
// In the root layout, after auth is confirmed:
useEffect(() => {
  if (!accessToken || !userId) return;

  const checkMonthlyReprompt = async () => {
    if (await shouldSkipAllReprompts()) return;
    const alreadyShown = await AsyncStorage.getItem(REPROMPT_MONTHLY_KEY);
    if (alreadyShown) return;
    if (userHasPushToken) return;

    const result = await apiGetSummaryReprompt(accessToken).catch(() => null);
    if (result?.pending) {
      setMonthlyRepromptData({ savedPln: result.savedPln ?? undefined });
    }
  };

  void checkMonthlyReprompt();
}, [accessToken, userId]);
```

The `NotificationRepromptSheet` for the monthly trigger is rendered at root layout level so it can appear on any screen.

### i18n strings

The photo trigger reuses existing keys:
- `repromptTitle` — already in all 3 locales
- `repromptSubtitle` — already in all 3 locales
- `repromptEnable` — already in all 3 locales
- `repromptDismiss` — already in all 3 locales

Add monthly-specific keys to all 3 locales:

```
repromptMonthlyTitle:    'You saved {{amount}} PLN last month' | 'Zaoszczędziłeś {{amount}} PLN w zeszłym miesiącu' | 'Ви заощадили {{amount}} PLN минулого місяця'
repromptMonthlySubtitle: 'Enable notifications to get your monthly summary delivered automatically' | 'Włącz powiadomienia, aby automatycznie otrzymywać miesięczne podsumowanie' | 'Увімкніть сповіщення, щоб автоматично отримувати щомісячне зведення'
```

### Redis key consumption

Story 6.6 reads — but does not write or delete — the `monthly:summary:calculated:{userId}` key set by Story 6.5. The key expires naturally after 45 days (set by Story 6.5). Story 6.6 does not clear it after showing the prompt — natural expiry ensures the window is consistent with the monthly cadence.

### Dependency on user's push token status

`userHasPushToken` is needed mobile-side to decide whether to show re-prompts. This is available via the existing `GET /v1/me/user` response which includes `notificationPreference.expo_push_token` (mapped to a boolean — don't expose the token itself to the client). If the auth store already carries this, use it directly; otherwise add `hasPushToken: boolean` to the user profile response.

Check: `apps/api/src/user/user.service.ts` line 28 already selects `monthly_summary: boolean` from `notificationPreference` — extend this to include `hasPushToken: boolean` (i.e. `expo_push_token IS NOT NULL`).

### No new DB schema

Story 6.6 introduces no schema changes. The Redis key from Story 6.5 and AsyncStorage flags on mobile are sufficient for state tracking. The two-strike rule is enforced mobile-side in AsyncStorage — acceptable for this use case (reinstall resets, but that's rare and acceptable).

### Project Structure Notes

- `apps/api/src/notifications/notifications.service.ts` (modified — add `getSummaryReprompt()`)
- `apps/api/src/notifications/notifications.controller.ts` (modified — add `GET /v1/me/notifications/summary-reprompt`)
- `apps/api/src/user/user.service.ts` (modified — add `hasPushToken: boolean` to user profile response)
- `apps/mobile/src/components/NotificationRepromptSheet.tsx` (new)
- `apps/mobile/app/(app)/confirm.tsx` (modified — photo trigger)
- `apps/mobile/app/(app)/_layout.tsx` (modified — monthly trigger)
- `apps/mobile/src/api/notifications.ts` (modified — add `apiGetSummaryReprompt`)
- `apps/mobile/src/i18n/locales/en.ts` (modified — monthly reprompt strings)
- `apps/mobile/src/i18n/locales/pl.ts` (modified)
- `apps/mobile/src/i18n/locales/uk.ts` (modified)
- **No schema changes**

### References

- `SoftSignUpSheet` (bottom sheet modal pattern): [apps/mobile/src/components/SoftSignUpSheet.tsx](apps/mobile/src/components/SoftSignUpSheet.tsx)
- `useNotificationPermission` hook: [apps/mobile/src/hooks/useNotificationPermission.ts](apps/mobile/src/hooks/useNotificationPermission.ts)
- Existing `reprompt*` i18n keys: [apps/mobile/src/i18n/locales/en.ts](apps/mobile/src/i18n/locales/en.ts#L207)
- `alerts.tsx` (Linking.openSettings + permission request pattern): [apps/mobile/app/(app)/alerts.tsx](apps/mobile/app/(app)/alerts.tsx)
- `confirm.tsx` (trigger point for photo re-prompt): [apps/mobile/app/(app)/confirm.tsx](apps/mobile/app/(app)/confirm.tsx)
- Story 6.4: `/(app)/alerts` screen (destination after permission granted)
- Story 6.5: sets `monthly:summary:calculated:{userId}` Redis key consumed here
- Story epics spec: [_bmad-output/planning-artifacts/epics.md](_bmad-output/planning-artifacts/epics.md) — Story 6.6 (line ~2700)

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List

- `apps/api/src/notifications/notifications.service.ts` (modified)
- `apps/api/src/notifications/notifications.controller.ts` (modified)
- `apps/api/src/user/user.service.ts` (modified — hasPushToken in profile)
- `apps/mobile/src/components/NotificationRepromptSheet.tsx` (new)
- `apps/mobile/app/(app)/confirm.tsx` (modified)
- `apps/mobile/app/(app)/_layout.tsx` (modified)
- `apps/mobile/src/api/notifications.ts` (modified)
- `apps/mobile/src/i18n/locales/en.ts` (modified)
- `apps/mobile/src/i18n/locales/pl.ts` (modified)
- `apps/mobile/src/i18n/locales/uk.ts` (modified)
- `_bmad-output/implementation-artifacts/6-6-smart-notification-reprompting.md` (this file)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)
