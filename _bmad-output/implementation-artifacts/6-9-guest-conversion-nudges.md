# Story 6.9: Guest Conversion Nudges

Status: ready-for-dev

## Story

As a **guest user**,
I want to discover what signing in would add to my experience at moments when it's genuinely relevant,
So that I can make an informed decision to create an account when the value is tangible.

## Acceptance Criteria

**Nudge 1 — Engagement-based in-app card**

**AC1 — Threshold trigger:**
Given a guest has opened the app 3 or more times within a rolling 7-day window (tracked device-locally in AsyncStorage)
When they open the app for the qualifying session
Then after the map has loaded, a dismissible `GuestEngagementCard` is shown:
*"You've been checking prices regularly. Sign in to get automatic alerts — so the app does the checking for you."*
And it offers: Continue with Google, Continue with Apple, Use Email, and a dismiss option

**AC2 — One-time only:**
Given the engagement card has been shown once (either dismissed or sign-up completed)
When they open the app on any subsequent session
Then the card is not shown again — AsyncStorage flag `@guest:nudge:engagement:shown` is set permanently

**AC3 — Precedence:**
Given both the engagement card and a market event banner (Nudge 2) would appear in the same session
When the app loads
Then only the market event banner is shown; the engagement card defers to the next qualifying session

**Nudge 2 — Market event (push primary, in-app fallback)**

**AC4 — Guest push registration:**
Given a guest has granted push permission (Story 1.7 requests permission before auth)
When the app starts and the user is a guest (`isGuest: true`)
Then the Expo push token is registered via `POST /v1/guest/push-token` (unauthenticated)
And the token is stored in the `GuestPushToken` table

**AC5 — Push notification on market event:**
Given Story 6.2's community confirmation threshold has been met for a regional price rise
When `CommunityRiseAlertService.evaluateAndNotify()` determines the threshold is met
Then `GuestNudgeService.maybeNotifyGuests()` is called (non-blocking) with a generated `marketEventId`
And a push notification is sent to all registered `GuestPushToken` records:
*"Fuel prices moved today. Sign in to get a heads-up next time — and fill up before it happens."*
And tapping the notification opens the app and shows the sign-in screen (`/(auth)/login`)
And a Redis key `guest:nudge:market-event:latest` is set (value: `{ eventId, triggeredAt }`, TTL 48h) — prevents re-sending within 48 hours

**AC6 — In-app banner fallback:**
Given a guest opens the app within 48 hours of a market confirmation event AND they did not receive the push (no registered `GuestPushToken` or permission not granted)
When the app loads and the user is a guest
Then `GET /v1/nudge/market-event` (unauthenticated) returns `{ active: true; eventId }` while the Redis key is live
And a dismissible `MarketEventBanner` is shown: *"Fuel prices moved today. Sign in to get a heads-up next time — and fill up before it happens."*
And the banner is shown at most once per `eventId` — AsyncStorage key `@guest:nudge:market:{eventId}` prevents repetition
And after 48 hours the Redis key expires → endpoint returns `{ active: false }` → banner never shown for that event

**AC7 — Market event copy is intentionally general:**
Given the market event nudge copy (push and banner)
When it is composed
Then it contains no specific price movement figures, percentages, fuel type names, or station details

**AC8 — Analytics events:**
Given a guest sees or interacts with either nudge
When the event occurs
Then `guest_nudge_shown`, `guest_nudge_dismissed`, `guest_nudge_cta_tapped` events are logged via `POST /v1/nudge/events` (unauthenticated) with `nudgeType: 'engagement' | 'market_event'`

## Tasks / Subtasks

- [ ] T1: Schema — `GuestPushToken` model (AC4, AC5)
  - [ ] T1a: Add `GuestPushToken` model to `packages/db/prisma/schema.prisma` (see Dev Notes)
  - [ ] T1b: Create migration `packages/db/prisma/migrations/<timestamp>_add_guest_push_token/migration.sql`

- [ ] T2: Backend — guest push token registration (AC4)
  - [ ] T2a: Create `apps/api/src/guest-nudge/guest-nudge.controller.ts` — unauthenticated (no `@Roles` guard)
  - [ ] T2b: `POST /v1/guest/push-token` — body: `{ token: string }`; validate Expo token format; upsert `GuestPushToken` (unique on `token`)
  - [ ] T2c: `GET /v1/nudge/market-event` — reads Redis key `guest:nudge:market-event:latest`; returns `{ active: boolean; eventId: string | null }`
  - [ ] T2d: `POST /v1/nudge/events` — body: `{ nudgeType: string; eventName: string; sessionId?: string }`; validate against allowlist; store as `NotificationEvent` with `user_id: null` and `event_type: nudgeType_eventName` (reuses Story 6.8 table); unauthenticated

- [ ] T3: `GuestNudgeService` (AC5, AC6)
  - [ ] T3a: Create `apps/api/src/guest-nudge/guest-nudge.service.ts`
  - [ ] T3b: Implement `maybeNotifyGuests()` — checks Redis dedup key `guest:nudge:market-event:latest`; if key exists → skip; generates `marketEventId = uuid()`; queries all `GuestPushToken` rows; sends push in chunks; sets Redis key with 48h TTL; fail-silently (errors logged as warnings, not rethrown)
  - [ ] T3c: `maybeNotifyGuests()` is called from `CommunityRiseAlertService.evaluateAndNotify()` after threshold is confirmed, wrapped in `try/catch` — non-blocking

- [ ] T4: `GuestNudgeModule` + wiring (AC4–AC6)
  - [ ] T4a: Create `apps/api/src/guest-nudge/guest-nudge.module.ts`; import `PrismaModule`, `RedisModule`; provide `EXPO_PUSH_CLIENT`; export `GuestNudgeService`
  - [ ] T4b: Import `GuestNudgeModule` in `apps/api/src/app.module.ts`
  - [ ] T4c: Import `GuestNudgeModule` in `AlertModule` (for `CommunityRiseAlertService` injection)

- [ ] T5: Extend `CommunityRiseAlertService` (AC5)
  - [ ] T5a: Inject `GuestNudgeService`; after `recordDedup()` call in `evaluateAndNotify()`, call `this.guestNudgeService.maybeNotifyGuests().catch(...)` (non-blocking)

- [ ] T6: Mobile — guest push token registration (AC4)
  - [ ] T6a: In `apps/mobile/app/_layout.tsx`: after `i18nReady`, if `isGuest` and push permission status is `'granted'`, call `getExpoPushToken()` and register via `apiRegisterGuestPushToken(token)`; best-effort, silent failure
  - [ ] T6b: Add `apiRegisterGuestPushToken(token)` to `apps/mobile/src/api/guest-nudge.ts` (new file)
  - [ ] T6c: When guest signs up → the guest push token is no longer needed; no explicit cleanup required (the `GuestPushToken` table rows expire naturally — add a 90-day `expires_at` column, cleaned by a scheduled job, or just accept orphaned rows at low volume)

- [ ] T7: Mobile — Nudge 1 session counter (AC1, AC2, AC3)
  - [ ] T7a: Create `apps/mobile/src/hooks/useGuestSessionCounter.ts` — on mount, reads `@guest:session:dates` from AsyncStorage (JSON array of ISO timestamps); removes entries older than 7 days; appends current session timestamp; writes back; returns `{ sessionCount: number }`
  - [ ] T7b: In map screen `apps/mobile/app/(app)/index.tsx`: if `isGuest` and `sessionCount >= 3` and `@guest:nudge:engagement:shown` not set → set `showEngagementCard: true` (after map loads — 2s delay, not interrupting navigation)

- [ ] T8: Mobile — Nudge 2 market event check (AC6, AC3)
  - [ ] T8a: In `apps/mobile/app/(app)/index.tsx`: if `isGuest`, on mount call `apiGetMarketEventNudge()` from `apps/mobile/src/api/guest-nudge.ts`; if `active` and `@guest:nudge:market:{eventId}` not set → set `showMarketBanner: true`; market banner takes precedence over engagement card (AC3)
  - [ ] T8b: Add `apiGetMarketEventNudge()` to `apps/mobile/src/api/guest-nudge.ts`

- [ ] T9: Mobile — `GuestEngagementCard` component (AC1, AC2)
  - [ ] T9a: Create `apps/mobile/src/components/GuestEngagementCard.tsx` — dismissible bottom sheet (same pattern as `SoftSignUpSheet`); includes Google, Apple, email sign-in buttons + dismiss; on any auth action or dismiss: set `@guest:nudge:engagement:shown = 'true'`; fire analytics events (AC8)

- [ ] T10: Mobile — `MarketEventBanner` component (AC6, AC7)
  - [ ] T10a: Create `apps/mobile/src/components/MarketEventBanner.tsx` — non-modal, inline banner (not a sheet); top of map screen below the search bar; amber background; copy from i18n; `[Sign in]` CTA → navigates to `/(auth)/login`; dismiss button (×); on show: set `@guest:nudge:market:{eventId} = 'true'`; fire analytics events (AC8)

- [ ] T11: Mobile — analytics events (AC8)
  - [ ] T11a: Add `apiLogGuestNudgeEvent(nudgeType, eventName)` to `apps/mobile/src/api/guest-nudge.ts`; best-effort, fire-and-forget
  - [ ] T11b: Call from `GuestEngagementCard` and `MarketEventBanner`: on show (nudge_shown), on dismiss (nudge_dismissed), on CTA tap (nudge_cta_tapped)

- [ ] T12: i18n — all 3 locales (AC1, AC6)
  - [ ] T12a: Add `guestNudge` section to `apps/mobile/src/i18n/locales/{en,pl,uk}.ts` (see Dev Notes)

- [ ] T13: Tests
  - [ ] T13a: `guest-nudge.service.spec.ts` — `maybeNotifyGuests`: sends push to all GuestPushToken rows; skips when Redis dedup key exists; sets Redis key after send; does not throw on push failure; handles empty GuestPushToken table
  - [ ] T13b: Full regression suite — all existing tests still pass

## Dev Notes

### GuestPushToken schema

```prisma
model GuestPushToken {
  id         String   @id @default(uuid())
  token      String   @unique
  created_at DateTime @default(now())

  @@index([created_at])
}
```

No `expires_at` in this story — orphaned rows accumulate slowly (only guests who never convert). A future cleanup job can delete rows older than 90 days. At launch scale, this is not a concern.

### Guest push notification payload

```ts
const message: ExpoPushMessage = {
  to: guestToken,
  title: 'Fuel prices moved today',
  body: 'Sign in to get a heads-up next time — and fill up before it happens.',
  data: { route: '/(auth)/login', alertType: 'guest_market_event' },
  sound: 'default' as const,
};
```

Tapping → app opens → `Notifications.addNotificationResponseReceivedListener` in `_layout.tsx` reads `data.route` → navigates to `/(auth)/login`.

Note: the existing `addNotificationResponseReceivedListener` (Story 6.8, T7a) should also handle `alertType: 'guest_market_event'` without logging it as a `notification_opened` event (user is not authenticated — skip the event call for guest push opens).

### Redis key for market event

```ts
const GUEST_MARKET_EVENT_KEY = 'guest:nudge:market-event:latest';
const GUEST_MARKET_EVENT_TTL = 48 * 3600; // 48h

// In GuestNudgeService.maybeNotifyGuests():
const existing = await this.redis.get(GUEST_MARKET_EVENT_KEY);
if (existing) return; // already sent within 48h

const marketEventId = randomUUID();
// ... send push ...
await this.redis.set(
  GUEST_MARKET_EVENT_KEY,
  JSON.stringify({ eventId: marketEventId, triggeredAt: new Date().toISOString() }),
  'EX', GUEST_MARKET_EVENT_TTL,
);
```

`GET /v1/nudge/market-event` reads this key:
```ts
const raw = await this.redis.get(GUEST_MARKET_EVENT_KEY);
if (!raw) return { active: false, eventId: null };
const { eventId } = JSON.parse(raw);
return { active: true, eventId };
```

### useGuestSessionCounter hook

```ts
const SESSION_DATES_KEY = '@guest:session:dates';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function useGuestSessionCounter(): { sessionCount: number } {
  const [sessionCount, setSessionCount] = useState(0);

  useEffect(() => {
    async function update() {
      const raw = await AsyncStorage.getItem(SESSION_DATES_KEY).catch(() => null);
      const dates: string[] = raw ? JSON.parse(raw) : [];
      const cutoff = Date.now() - SEVEN_DAYS_MS;
      const recent = dates.filter(d => new Date(d).getTime() > cutoff);
      recent.push(new Date().toISOString()); // current session
      await AsyncStorage.setItem(SESSION_DATES_KEY, JSON.stringify(recent)).catch(() => {});
      setSessionCount(recent.length);
    }
    void update();
  }, []);

  return { sessionCount };
}
```

### Market event banner placement

The `MarketEventBanner` renders inline in `index.tsx` (the map screen), positioned absolutely or in a top-of-screen container, appearing after the map tiles have loaded (existing `mapReady` state). It does not block map interaction.

```tsx
// In index.tsx — below map, above floating controls:
{isGuest && showMarketBanner && marketEventId && (
  <MarketEventBanner
    eventId={marketEventId}
    onDismiss={() => {
      setShowMarketBanner(false);
      void AsyncStorage.setItem(`@guest:nudge:market:${marketEventId}`, 'true');
      void apiLogGuestNudgeEvent('market_event', 'nudge_dismissed');
    }}
    onSignIn={() => {
      void apiLogGuestNudgeEvent('market_event', 'nudge_cta_tapped');
      router.push('/(auth)/login');
    }}
    t={t}
  />
)}
```

### Engagement card timing

The engagement card is shown with a 2-second delay after the map loads to avoid interrupting navigation:

```tsx
useEffect(() => {
  if (!shouldShowEngagementCard) return;
  const timer = setTimeout(() => setShowEngagementCard(true), 2000);
  return () => clearTimeout(timer);
}, [shouldShowEngagementCard]);
```

`shouldShowEngagementCard` is `isGuest && sessionCount >= 3 && !engagementShown && !showMarketBanner`.

### i18n strings

Add `guestNudge` section to all 3 locales:

```
engagement:
  title:    'You've been checking prices regularly' | 'Regularnie sprawdzasz ceny' | 'Ви регулярно перевіряєте ціни'
  subtitle: 'Sign in to get automatic alerts — so the app does the checking for you.' | 'Zaloguj się, aby otrzymywać automatyczne alerty.' | 'Увійдіть, щоб отримувати автоматичні сповіщення.'
  dismiss:  'Not now' | 'Nie teraz' | 'Не зараз'

marketEvent:
  banner:   'Fuel prices moved today. Sign in to get a heads-up next time.' | 'Ceny paliwa zmieniły się dziś. Zaloguj się, aby być na bieżąco.' | 'Ціни на пальне змінились сьогодні. Увійдіть, щоб отримувати сповіщення.'
  signIn:   'Sign in' | 'Zaloguj się' | 'Увійти'
  dismiss:  'Dismiss' | 'Zamknij' | 'Закрити'
```

### `POST /v1/guest/push-token` validation

```ts
// GuestNudgeController
@Post('/v1/guest/push-token')
async registerGuestToken(@Body() body: { token: string }) {
  const token = String(body.token ?? '').trim().slice(0, 500);
  if (!this.expoPush.isValidToken(token)) {
    throw new BadRequestException('Invalid Expo push token');
  }
  await this.prisma.guestPushToken.upsert({
    where: { token },
    create: { token },
    update: {}, // no-op update — token already registered
  });
}
```

No auth guard on this endpoint. Rate limiting (if applied globally via NestJS throttler) is sufficient protection — an invalid token is rejected by `isValidToken()`.

### Guest token registration timing in `_layout.tsx`

```ts
// In RootLayout, after i18nReady:
useEffect(() => {
  if (!isGuest) return;
  async function registerGuestPush() {
    const { status } = await Notifications.getPermissionsAsync().catch(() => ({ status: 'denied' }));
    if (status !== 'granted') return;
    const token = await getExpoPushToken().catch(() => null);
    if (!token) return;
    await apiRegisterGuestPushToken(token).catch(() => {}); // best-effort
  }
  void registerGuestPush();
}, [isGuest]);
```

Note: `getExpoPushToken` from `useNotificationPermission` requires the hook to be inside a component — hoist to `RootLayout` or extract a standalone utility function that doesn't need the hook context.

### Dependency on Story 6.2

`GuestNudgeService.maybeNotifyGuests()` is called from `CommunityRiseAlertService`. This means `GuestNudgeModule` must be imported by `AlertModule`. This creates a one-way dependency: `AlertModule → GuestNudgeModule`. No circular dependency since `GuestNudgeModule` doesn't import `AlertModule`.

### Story 4.9 analytics note

The spec mentions: *"Analytics: `guest_nudge_shown`, `guest_nudge_dismissed`, `guest_nudge_cta_tapped` events defined in Story 4.9."* Since 4.9 is blocked, Story 6.9 stores these events in the same `NotificationEvent` table from Story 6.8 (`user_id: null`, `event_type: 'guest_nudge_shown'`, `trigger: 'engagement' | 'market_event'`). When 4.9 ships, the `POST /v1/nudge/events` endpoint can dual-write to the external platform.

### Project Structure Notes

- `packages/db/prisma/schema.prisma` (modified — `GuestPushToken` model)
- `packages/db/prisma/migrations/<timestamp>_add_guest_push_token/migration.sql` (new)
- New directory: `apps/api/src/guest-nudge/`
  - `guest-nudge.service.ts` (new)
  - `guest-nudge.controller.ts` (new)
  - `guest-nudge.module.ts` (new)
  - `guest-nudge.service.spec.ts` (new)
- `apps/api/src/app.module.ts` (modified — import `GuestNudgeModule`)
- `apps/api/src/alert/alert.module.ts` (modified — import `GuestNudgeModule`, inject into `CommunityRiseAlertService`)
- `apps/api/src/alert/community-rise-alert.service.ts` (modified — call `guestNudgeService.maybeNotifyGuests()`)
- `apps/mobile/src/api/guest-nudge.ts` (new — `apiRegisterGuestPushToken`, `apiGetMarketEventNudge`, `apiLogGuestNudgeEvent`)
- `apps/mobile/src/hooks/useGuestSessionCounter.ts` (new)
- `apps/mobile/src/components/GuestEngagementCard.tsx` (new)
- `apps/mobile/src/components/MarketEventBanner.tsx` (new)
- `apps/mobile/app/(app)/index.tsx` (modified — guest nudge logic)
- `apps/mobile/app/_layout.tsx` (modified — guest push token registration)
- `apps/mobile/src/i18n/locales/en.ts` (modified)
- `apps/mobile/src/i18n/locales/pl.ts` (modified)
- `apps/mobile/src/i18n/locales/uk.ts` (modified)

### References

- `SoftSignUpSheet` (sign-in sheet pattern): [apps/mobile/src/components/SoftSignUpSheet.tsx](apps/mobile/src/components/SoftSignUpSheet.tsx)
- `isGuest` + auth store: [apps/mobile/src/store/auth.store.ts](apps/mobile/src/store/auth.store.ts)
- `useNotificationPermission` hook: [apps/mobile/src/hooks/useNotificationPermission.ts](apps/mobile/src/hooks/useNotificationPermission.ts)
- Map screen (nudge host): [apps/mobile/app/(app)/index.tsx](apps/mobile/app/(app)/index.tsx)
- Story 6.2: `CommunityRiseAlertService.evaluateAndNotify()` — calls `maybeNotifyGuests()` here
- Story 6.8: `NotificationEvent` table reused for guest analytics events
- Story 4.9: future event platform for dual-writing
- Story epics spec: [_bmad-output/planning-artifacts/epics.md](_bmad-output/planning-artifacts/epics.md) — Story 6.9 (line ~2800)

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List

- `packages/db/prisma/schema.prisma` (modified)
- `packages/db/prisma/migrations/<timestamp>_add_guest_push_token/migration.sql` (new)
- `apps/api/src/guest-nudge/guest-nudge.service.ts` (new)
- `apps/api/src/guest-nudge/guest-nudge.controller.ts` (new)
- `apps/api/src/guest-nudge/guest-nudge.module.ts` (new)
- `apps/api/src/guest-nudge/guest-nudge.service.spec.ts` (new)
- `apps/api/src/app.module.ts` (modified)
- `apps/api/src/alert/alert.module.ts` (modified)
- `apps/api/src/alert/community-rise-alert.service.ts` (modified)
- `apps/mobile/src/api/guest-nudge.ts` (new)
- `apps/mobile/src/hooks/useGuestSessionCounter.ts` (new)
- `apps/mobile/src/components/GuestEngagementCard.tsx` (new)
- `apps/mobile/src/components/MarketEventBanner.tsx` (new)
- `apps/mobile/app/(app)/index.tsx` (modified)
- `apps/mobile/app/_layout.tsx` (modified)
- `apps/mobile/src/i18n/locales/en.ts` (modified)
- `apps/mobile/src/i18n/locales/pl.ts` (modified)
- `apps/mobile/src/i18n/locales/uk.ts` (modified)
- `_bmad-output/implementation-artifacts/6-9-guest-conversion-nudges.md` (this file)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)
