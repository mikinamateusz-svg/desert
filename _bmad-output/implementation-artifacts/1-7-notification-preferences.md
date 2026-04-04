# Story 1.7: Notification Preferences

Status: done

## Story

As a **driver**,
I want to manage which notifications I receive from the app,
So that I only get alerts that are relevant and useful to me.

**Why:** Notification permission is one of the highest-value retention levers in the product — price drop alerts bring users back without any active effort. A value-first opt-in approach (showing the benefit before the OS dialog) maximises permission grant rates. Granular controls prevent users from disabling all notifications just to stop one they dislike.

## Acceptance Criteria

1. **Given** an authenticated driver opens the Alerts tab for the first time (OS permission not yet requested)
   **When** they view the screen
   **Then** they see the value proposition — "price drop alerts, sharp-rise warnings, monthly savings summaries" — and a single "Enable notifications" button before any OS dialog is shown

2. **Given** a driver who declined the OS notification permission
   **When** they navigate to the Alerts tab
   **Then** they see a message explaining how to enable notifications via device Settings — the app does NOT show broken toggles. A "Open Settings" link opens the device Settings app.

3. **Given** a driver with OS notifications enabled
   **When** they navigate to the Alerts tab
   **Then** they can individually toggle each notification type: price drops, sharp-rise alerts, monthly summary — and their preferences are persisted to the backend

4. **Given** a driver who has toggled a notification type off
   **When** that notification type would otherwise be triggered (Phase 2+)
   **Then** no notification is sent to that driver for that type (backend stores preference; actual sending is Phase 2)

5. **Given** a driver who declined notifications at onboarding
   **When** they later visit the Alerts tab and have at least one submission on record
   **Then** they are shown a contextual re-prompt banner "Want to know when prices drop near you?" — once, non-intrusively. The re-prompt is not shown again regardless of their choice.

6. **Given** a driver views the Alerts tab
   **When** their device language is Polish, English, or Ukrainian
   **Then** all text on the screen is displayed in that language

## Tasks / Subtasks

### Phase 1 — Database Schema

- [x] **1.1** Add `NotificationPreference` model to `packages/db/prisma/schema.prisma`:
  ```prisma
  model NotificationPreference {
    id               String   @id @default(uuid())
    user_id          String   @unique
    expo_push_token  String?
    price_drops      Boolean  @default(true)
    sharp_rise       Boolean  @default(true)
    monthly_summary  Boolean  @default(true)
    created_at       DateTime @default(now())
    updated_at       DateTime @updatedAt
    user             User     @relation(fields: [user_id], references: [id])
  }
  ```
  Also add the reverse relation on the `User` model:
  ```prisma
  notificationPreference NotificationPreference?
  ```

- [x] **1.2** Manually create the migration file (no live DATABASE_URL in dev — same approach as Story 1.6):
  Create `packages/db/prisma/migrations/20260323000001_add_notification_preferences/migration.sql`:
  ```sql
  CREATE TABLE "NotificationPreference" (
    "id"              TEXT NOT NULL,
    "user_id"         TEXT NOT NULL,
    "expo_push_token" TEXT,
    "price_drops"     BOOLEAN NOT NULL DEFAULT true,
    "sharp_rise"      BOOLEAN NOT NULL DEFAULT true,
    "monthly_summary" BOOLEAN NOT NULL DEFAULT true,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
  );

  CREATE UNIQUE INDEX "NotificationPreference_user_id_key" ON "NotificationPreference"("user_id");

  ALTER TABLE "NotificationPreference"
    ADD CONSTRAINT "NotificationPreference_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
  ```

- [x] **1.3** Run `pnpm --filter db db:generate` to regenerate the Prisma client.

### Phase 2 — API: NotificationsModule

- [x] **2.1** Create `apps/api/src/notifications/dto/update-notification-preferences.dto.ts`:
  ```ts
  import { IsBoolean, IsOptional, IsString } from 'class-validator';

  export class UpdateNotificationPreferencesDto {
    @IsOptional()
    @IsString()
    expo_push_token?: string | null;

    @IsOptional()
    @IsBoolean()
    price_drops?: boolean;

    @IsOptional()
    @IsBoolean()
    sharp_rise?: boolean;

    @IsOptional()
    @IsBoolean()
    monthly_summary?: boolean;
  }
  ```

- [x] **2.2** Create `apps/api/src/notifications/notifications.service.ts`:
  ```ts
  import { Injectable } from '@nestjs/common';
  import { PrismaService } from '../prisma/prisma.service.js';
  import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto.js';

  @Injectable()
  export class NotificationsService {
    constructor(private readonly prisma: PrismaService) {}

    async getPreferences(userId: string) {
      return this.prisma.notificationPreference.upsert({
        where: { user_id: userId },
        create: { user_id: userId },
        update: {},
      });
    }

    async updatePreferences(userId: string, dto: UpdateNotificationPreferencesDto) {
      return this.prisma.notificationPreference.upsert({
        where: { user_id: userId },
        create: {
          user_id: userId,
          expo_push_token: dto.expo_push_token ?? null,
          price_drops: dto.price_drops ?? true,
          sharp_rise: dto.sharp_rise ?? true,
          monthly_summary: dto.monthly_summary ?? true,
        },
        update: {
          ...(dto.expo_push_token !== undefined && { expo_push_token: dto.expo_push_token }),
          ...(dto.price_drops !== undefined && { price_drops: dto.price_drops }),
          ...(dto.sharp_rise !== undefined && { sharp_rise: dto.sharp_rise }),
          ...(dto.monthly_summary !== undefined && { monthly_summary: dto.monthly_summary }),
        },
      });
    }
  }
  ```

- [x] **2.3** Create `apps/api/src/notifications/notifications.controller.ts`:
  ```ts
  import { Body, Controller, Get, Patch } from '@nestjs/common';
  import { NotificationsService } from './notifications.service.js';
  import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto.js';
  import { CurrentUser } from '../auth/current-user.decorator.js';

  @Controller('v1/me/notifications')
  export class NotificationsController {
    constructor(private readonly notificationsService: NotificationsService) {}

    @Get()
    getPreferences(@CurrentUser('id') userId: string) {
      return this.notificationsService.getPreferences(userId);
    }

    @Patch()
    updatePreferences(
      @CurrentUser('id') userId: string,
      @Body() dto: UpdateNotificationPreferencesDto,
    ) {
      return this.notificationsService.updatePreferences(userId, dto);
    }
  }
  ```
  **Note:** No `@Roles()` decorator — any authenticated user (any role) can manage their own notification preferences. JwtAuthGuard (global APP_GUARD) enforces authentication. RolesGuard passes through when no `@Roles()` is set.

- [x] **2.4** Create `apps/api/src/notifications/notifications.module.ts`:
  ```ts
  import { Module } from '@nestjs/common';
  import { NotificationsController } from './notifications.controller.js';
  import { NotificationsService } from './notifications.service.js';

  @Module({
    controllers: [NotificationsController],
    providers: [NotificationsService],
  })
  export class NotificationsModule {}
  ```

- [x] **2.5** Register `NotificationsModule` in `apps/api/src/app.module.ts` imports array.

### Phase 3 — API Tests

- [x] **3.1** Create `apps/api/src/notifications/notifications.service.spec.ts`:
  - Mock `PrismaService.notificationPreference.upsert`
  - Test: `getPreferences` — calls upsert with `create: { user_id }` and `update: {}`
  - Test: `getPreferences` — returns the upserted row
  - Test: `updatePreferences` — partial update (only `price_drops: false`) — update object contains only `price_drops`, not other fields
  - Test: `updatePreferences` — `expo_push_token: null` is included in update when explicitly passed
  - Test: `updatePreferences` — when `expo_push_token` is undefined (not in DTO), it is NOT included in the update object

- [x] **3.2** Create `apps/api/src/notifications/notifications.controller.spec.ts`:
  - Mock `NotificationsService`
  - Test: `GET /v1/me/notifications` calls `service.getPreferences(userId)`
  - Test: `PATCH /v1/me/notifications` calls `service.updatePreferences(userId, dto)`

### Phase 4 — Mobile: Install expo-notifications

- [x] **4.1** Install the package:
  ```bash
  pnpm --filter mobile add expo-notifications
  ```

- [x] **4.2** Update `apps/mobile/app.json` — add notification permissions:
  ```json
  {
    "expo": {
      "plugins": [
        [
          "expo-notifications",
          {
            "icon": "./assets/notification-icon.png",
            "color": "#f59e0b",
            "sounds": [],
            "androidMode": "default"
          }
        ]
      ],
      "ios": {
        "infoPlist": {
          "NSUserNotificationUsageDescription": "We'll alert you when fuel prices drop near you."
        }
      },
      "android": {
        "permissions": ["android.permission.POST_NOTIFICATIONS"]
      }
    }
  }
  ```
  **Note:** If `assets/notification-icon.png` does not exist, omit the `icon` key for now or use an existing asset. The plugin itself is required even without all options.

### Phase 5 — Mobile: API Client

- [x] **5.1** Create `apps/mobile/src/api/notifications.ts`:
  ```ts
  const API_BASE = process.env['EXPO_PUBLIC_API_URL'] ?? 'http://localhost:3000';

  export interface NotificationPreferences {
    id: string;
    user_id: string;
    expo_push_token: string | null;
    price_drops: boolean;
    sharp_rise: boolean;
    monthly_summary: boolean;
  }

  export interface UpdateNotificationPreferencesPayload {
    expo_push_token?: string | null;
    price_drops?: boolean;
    sharp_rise?: boolean;
    monthly_summary?: boolean;
  }

  class ApiError extends Error {
    constructor(
      message: string,
      public readonly statusCode: number,
      public readonly error: string,
    ) {
      super(message);
      this.name = 'ApiError';
    }
  }

  async function request<T>(path: string, options: RequestInit): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
    });
    const body = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      const message = typeof body['message'] === 'string' ? body['message'] : 'An error occurred';
      const errorCode = typeof body['error'] === 'string' ? body['error'] : 'UNKNOWN_ERROR';
      throw new ApiError(message, res.status, errorCode);
    }
    return body as T;
  }

  export async function apiGetNotificationPreferences(
    accessToken: string,
  ): Promise<NotificationPreferences> {
    return request<NotificationPreferences>('/v1/me/notifications', {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }

  export async function apiUpdateNotificationPreferences(
    accessToken: string,
    payload: UpdateNotificationPreferencesPayload,
  ): Promise<NotificationPreferences> {
    return request<NotificationPreferences>('/v1/me/notifications', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(payload),
    });
  }
  ```

### Phase 6 — Mobile: useNotificationPermission Hook

- [x] **6.1** Create `apps/mobile/src/hooks/useNotificationPermission.ts`:
  ```ts
  import { useState, useEffect, useCallback } from 'react';
  import * as Notifications from 'expo-notifications';
  import { Platform } from 'react-native';

  export type PermissionStatus = 'undetermined' | 'granted' | 'denied';

  export function useNotificationPermission() {
    const [status, setStatus] = useState<PermissionStatus>('undetermined');
    const [isChecking, setIsChecking] = useState(true);

    useEffect(() => {
      void (async () => {
        const { status: current } = await Notifications.getPermissionsAsync();
        if (current === 'granted') setStatus('granted');
        else if (current === 'denied') setStatus('denied');
        else setStatus('undetermined');
        setIsChecking(false);
      })();
    }, []);

    const requestPermission = useCallback(async (): Promise<PermissionStatus> => {
      const { status: result } = await Notifications.requestPermissionsAsync();
      const mapped: PermissionStatus =
        result === 'granted' ? 'granted' : result === 'denied' ? 'denied' : 'undetermined';
      setStatus(mapped);
      return mapped;
    }, []);

    const getExpoPushToken = useCallback(async (): Promise<string | null> => {
      if (Platform.OS === 'web') return null;
      try {
        // projectId is required for Expo push — gracefully skip if not configured
        const { Constants } = await import('expo-constants');
        const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
        if (!projectId) return null;
        const token = await Notifications.getExpoPushTokenAsync({ projectId });
        return token.data;
      } catch {
        return null;
      }
    }, []);

    return { status, isChecking, requestPermission, getExpoPushToken };
  }
  ```

### Phase 7 — Mobile: Alerts Screen

- [x] **7.1** Replace `apps/mobile/app/(app)/alerts.tsx` with the full notifications preferences screen.

  **Screen states:**
  - `isChecking`: show `<ActivityIndicator>` while permission status loads
  - Not authenticated (`!accessToken`): show "Sign in to manage notifications" prompt
  - `permissionStatus === 'undetermined'`: show value-prop screen
  - `permissionStatus === 'denied'`: show "notifications off" state with "Open Settings" link
  - `permissionStatus === 'granted'`: show preference toggles (loaded from API)

  **Value-prop screen** (undetermined state):
  - Title: `t('notifications.valuePropTitle')`
  - Three benefit lines: `t('notifications.feature1')`, `t('notifications.feature2')`, `t('notifications.feature3')`
  - CTA button: `t('notifications.enableButton')` → calls `requestPermission()` → on grant, gets Expo push token → calls `apiUpdateNotificationPreferences` with token → fetches prefs → transitions to toggle state
  - On denial: transitions to denied state

  **Denied state:**
  - Title: `t('notifications.permissionDeniedTitle')`
  - Body: `t('notifications.permissionDeniedBody')`
  - Link button: `t('notifications.openSettings')` → calls `Linking.openSettings()`

  **Granted state (toggle list):**
  - Load preferences from API on mount (show spinner while loading)
  - Three toggle rows: price drops, sharp-rise alerts, monthly summary
  - `Switch` component for each toggle; on change, immediately call `apiUpdateNotificationPreferences` with the changed key only (optimistic: update local state instantly, revert on error)
  - Error banner if API update fails

  **Contextual re-prompt banner** (denied state only, shown once):
  - On mount, if `permissionStatus === 'denied'` AND `accessToken` is set:
    - Check AsyncStorage key `desert:notifRepromptShown` — if not set:
      - Call `apiGetSubmissions(accessToken, 1, 1)` (lightweight: 1 item) — if `total > 0`:
        - Show inline banner: `t('notifications.repromptTitle')` + `t('notifications.repromptSubtitle')`
        - Two buttons: `t('notifications.repromptEnable')` → opens Settings, `t('notifications.repromptDismiss')`
        - After either action: set `desert:notifRepromptShown = 'true'` in AsyncStorage
  - **Important:** `apiGetSubmissions` is already in `apps/mobile/src/api/submissions.ts` — import it from there

  **Key implementation details:**
  - Use `Linking.openSettings()` from `react-native` (not expo-linking)
  - `Switch` onValueChange must call the update API with only the changed field — do NOT send all three fields (partial update semantics)
  - Never show toggles when `permissionStatus !== 'granted'`
  - Show the auth loading spinner (from `useAuth().isLoading`) before showing sign-in prompt — prevents auth flash (same pattern as `activity.tsx`)

### Phase 8 — Mobile: i18n Keys

- [x] **8.1** Add to `apps/mobile/src/i18n/locales/en.ts`:
  ```ts
  notifications: {
    valuePropTitle: 'Stay ahead of fuel prices',
    feature1: 'Price drop alerts near you',
    feature2: 'Sharp-rise warnings before you fill up',
    feature3: 'Monthly savings summary',
    enableButton: 'Enable notifications',
    permissionDeniedTitle: 'Notifications are off',
    permissionDeniedBody: 'Enable notifications in your device Settings to get price drop alerts.',
    openSettings: 'Open Settings',
    priceDrop: 'Price drop alerts',
    sharpRise: 'Sharp-rise warnings',
    monthlySummary: 'Monthly savings summary',
    repromptTitle: 'Want to know when prices drop near you?',
    repromptSubtitle: 'Enable notifications to get alerted without opening the app.',
    repromptEnable: 'Enable',
    repromptDismiss: 'No thanks',
    signInPrompt: 'Sign in to manage your notification preferences',
    errorLoading: 'Failed to load preferences',
    errorSaving: 'Failed to save preferences',
    retry: 'Retry',
  },
  ```

- [x] **8.2** Add to `apps/mobile/src/i18n/locales/pl.ts`:
  ```ts
  notifications: {
    valuePropTitle: 'Wyprzedź ceny paliwa',
    feature1: 'Alerty o spadkach cen w pobliżu',
    feature2: 'Ostrzeżenia o nagłych wzrostach przed tankowaniem',
    feature3: 'Miesięczne podsumowanie oszczędności',
    enableButton: 'Włącz powiadomienia',
    permissionDeniedTitle: 'Powiadomienia są wyłączone',
    permissionDeniedBody: 'Włącz powiadomienia w ustawieniach urządzenia, aby otrzymywać alerty o spadkach cen.',
    openSettings: 'Otwórz ustawienia',
    priceDrop: 'Alerty o spadkach cen',
    sharpRise: 'Ostrzeżenia o nagłych wzrostach',
    monthlySummary: 'Miesięczne podsumowanie oszczędności',
    repromptTitle: 'Chcesz wiedzieć, kiedy ceny spadają w pobliżu?',
    repromptSubtitle: 'Włącz powiadomienia, aby być na bieżąco bez otwierania aplikacji.',
    repromptEnable: 'Włącz',
    repromptDismiss: 'Nie, dziękuję',
    signInPrompt: 'Zaloguj się, aby zarządzać preferencjami powiadomień',
    errorLoading: 'Nie udało się załadować preferencji',
    errorSaving: 'Nie udało się zapisać preferencji',
    retry: 'Spróbuj ponownie',
  },
  ```

- [x] **8.3** Add to `apps/mobile/src/i18n/locales/uk.ts`:
  ```ts
  notifications: {
    valuePropTitle: 'Будьте попереду цін на пальне',
    feature1: 'Сповіщення про зниження цін поруч',
    feature2: 'Попередження про різкі підвищення перед заправкою',
    feature3: 'Щомісячний звіт про заощадження',
    enableButton: 'Увімкнути сповіщення',
    permissionDeniedTitle: 'Сповіщення вимкнено',
    permissionDeniedBody: 'Увімкніть сповіщення в налаштуваннях пристрою, щоб отримувати сповіщення про зниження цін.',
    openSettings: 'Відкрити налаштування',
    priceDrop: 'Сповіщення про зниження цін',
    sharpRise: 'Попередження про різкі підвищення',
    monthlySummary: 'Щомісячний звіт про заощадження',
    repromptTitle: 'Хочете знати, коли ціни знижуються поруч?',
    repromptSubtitle: 'Увімкніть сповіщення, щоб отримувати попередження без відкриття застосунку.',
    repromptEnable: 'Увімкнути',
    repromptDismiss: 'Ні, дякую',
    signInPrompt: 'Увійдіть, щоб керувати налаштуваннями сповіщень',
    errorLoading: 'Не вдалося завантажити налаштування',
    errorSaving: 'Не вдалося зберегти налаштування',
    retry: 'Спробувати знову',
  },
  ```

## Dev Notes

### File Locations (Critical — do NOT create files elsewhere)

```
packages/db/prisma/
  schema.prisma                  ← MODIFY (add NotificationPreference model, User relation)
  migrations/
    20260323000001_add_notification_preferences/
      migration.sql              ← NEW (manual, no live DB)

apps/api/src/notifications/
  dto/
    update-notification-preferences.dto.ts  ← NEW
  notifications.service.ts                  ← NEW
  notifications.service.spec.ts             ← NEW
  notifications.controller.ts               ← NEW
  notifications.controller.spec.ts          ← NEW
  notifications.module.ts                   ← NEW
apps/api/src/app.module.ts                  ← MODIFY (import NotificationsModule)

apps/mobile/src/api/
  notifications.ts               ← NEW
apps/mobile/src/hooks/
  useNotificationPermission.ts   ← NEW
apps/mobile/app/(app)/
  alerts.tsx                     ← REPLACE (was placeholder)
apps/mobile/src/i18n/locales/
  en.ts                          ← MODIFY (add notifications namespace)
  pl.ts                          ← MODIFY (add notifications namespace)
  uk.ts                          ← MODIFY (add notifications namespace)
```

### Architecture Compliance

- **No `@Roles()` on notification endpoints** — any authenticated user (any UserRole) can manage their own notification preferences. The global JwtAuthGuard enforces auth. The global RolesGuard passes through when no `@Roles()` metadata is set.
- **Global guards already registered** via `APP_GUARD` in `AppModule` — no `@UseGuards()` needed in controller.
- **`@CurrentUser('id')`** extracts `user.id` from `req.currentUser` (full User loaded by JwtAuthGuard). Import from `../auth/current-user.decorator.js`.
- **All imports in `apps/api/src` use `.js` extension** (ES module resolution with TypeScript). Exception: `@prisma/client` has no `.js`.
- **Push notifications are fire-and-forget (NFR26)** — backend stores the token and preferences; actual sending is Phase 2 (Stories 6.x). This story only establishes the preferences infrastructure.
- **FCM is the delivery mechanism** — but that integration is Phase 2. In this story, we capture the Expo push token in the DB so Phase 2 doesn't require user re-engagement.

### Prisma Schema — Critical Notes

- `user_id` on `NotificationPreference` is `@unique` — one row per user, enforced at DB level.
- No `onDelete: Cascade` — if user is deleted (soft delete via `deleted_at`), their notification preference row is preserved (consistent with Story 1.6 submissions approach — legitimate interest).
- `expo_push_token` is nullable — will be null if user denied permission or if EAS project ID is not configured during development.

### Migration — Manual Approach (No Live DATABASE_URL)

Same approach as Story 1.6:
1. Write migration SQL manually (see Task 1.2)
2. Run `pnpm --filter db db:generate` — no DB connection needed for Prisma client generation
3. Actual migration runs on Railway/Neon in CI/CD

### expo-notifications — Key API

```ts
import * as Notifications from 'expo-notifications';

// Check current permission status (no dialog)
const { status } = await Notifications.getPermissionsAsync();
// status: 'undetermined' | 'granted' | 'denied'

// Request permission (shows OS dialog on first call)
const { status: result } = await Notifications.requestPermissionsAsync();

// Get Expo push token (requires EAS project ID — optional for dev)
const token = await Notifications.getExpoPushTokenAsync({ projectId: 'your-eas-project-id' });
// token.data is the string token

// Open device Settings (React Native core — no expo-linking needed)
import { Linking } from 'react-native';
await Linking.openSettings();
```

**Versions:** `expo-notifications` is a first-party Expo package. For Expo SDK 55, the compatible version is `~0.29.0`. Use `pnpm --filter mobile add expo-notifications` and Expo will resolve the correct version.

### Mobile — API Pattern (Consistent with submissions.ts)

Inline the `request()` helper and `ApiError` class in `notifications.ts` — same pattern as `auth.ts` and `submissions.ts`. Do NOT introduce a shared client module unless also refactoring the other API files.

### Mobile — Re-prompt Mechanism

The re-prompt uses an AsyncStorage flag `desert:notifRepromptShown`. It is:
- Checked on Alerts screen mount when `permissionStatus === 'denied'`
- Set to `'true'` after re-prompt is shown (regardless of user choice)
- Never reset (re-prompt is one-time only, per AC)

The re-prompt checks `apiGetSubmissions(accessToken, 1, 1)` — the lightest possible check. If API call fails, silently skip the re-prompt (no error shown).

**The submission camera story (Phase 2+) is NOT required** to trigger the re-prompt. We check the API instead: if submissions exist, the user has contributed at least once.

### Mobile — Toggle Optimistic Updates

Toggles must feel instant. Pattern:
1. `onValueChange(newValue)` → immediately update local state
2. Call `apiUpdateNotificationPreferences(accessToken, { [key]: newValue })`
3. On error: revert local state + show `t('notifications.errorSaving')` banner

Send ONLY the changed key in the PATCH payload. Do NOT serialize all three booleans — honour the partial-update DTO semantics.

### Mobile — authLoading Guard

Show `<ActivityIndicator>` while `useAuth().isLoading` is true — prevents the sign-in prompt flashing briefly for authenticated users on cold start. Same pattern as `activity.tsx`.

## Review Notes (2026-04-04)

2 patches applied.

**P-3:** `UpdateNotificationPreferencesDto.expo_push_token` had no `@MaxLength` — unbounded string input. Added `@MaxLength(300)` (Expo push tokens are ~150–200 chars).

**P-3:** `NotificationsController` had no `@Roles()` on either endpoint — violates Story 1.5 AC6 (every route must have explicit `@Roles()` or `@Public()`). Added `@Roles(...ALL_ROLES)` (all 5 role types) on `GET` and `PATCH`.

**D1:** `ApiError` class now duplicated across `auth.ts`, `submissions.ts`, and `notifications.ts`. Extract to shared `apps/mobile/src/api/client.ts` in a future cleanup.

**D2:** Re-prompt logic calls `apiGetSubmissions` on every mount when permission is denied (before `REPROMPT_KEY` is set). Single lightweight call (`limit=1`), acceptable for MVP.
