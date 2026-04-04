# Story 1.6: Submission History

Status: done

## Story

As a **driver**,
I want to view a list of my past price submissions,
So that I can see my contribution history and track my activity on the platform.

**Why:** Contributors need feedback that their effort landed. Without a history screen, the app feels like a black hole after submission. It also lays the data foundation for Phase 2 leaderboards and contribution streaks — capturing the data now means nothing is lost even before those features are built.

## Acceptance Criteria

1. **Given** an authenticated driver with at least one past submission
   **When** they navigate to their submission history screen (Activity tab)
   **Then** they see a chronological list of their submissions, each showing station name, fuel type(s), submitted price(s), and submission date

2. **Given** an authenticated driver with no past submissions
   **When** they navigate to the Activity tab
   **Then** they see an empty state message encouraging them to make their first contribution

3. **Given** a driver with many submissions
   **When** they scroll through their submission history
   **Then** the list paginates correctly (offset pagination, 20 items per page) and all submissions are accessible

4. **Given** a driver whose submission was rejected by the OCR pipeline
   **When** they view their submission history
   **Then** rejected submissions are shown with a clear "Not published" indicator — never shown as verified prices. Shadow-rejected submissions appear as "Processing" (driver is unaware of the shadow ban).

5. **Given** a driver views the Activity tab
   **When** their device language is Polish, English, or Ukrainian
   **Then** all text on the screen is displayed in that language (i18n already bootstrapped in Story 1.4)

## Tasks / Subtasks

### Phase 1 — Database Schema

- [x] **1.1** Add `SubmissionStatus` enum and `Station` + `Submission` models to `packages/db/prisma/schema.prisma`:
  ```prisma
  enum SubmissionStatus {
    pending
    verified
    rejected
    shadow_rejected
  }

  model Station {
    id          String       @id @default(uuid())
    name        String
    address     String?
    created_at  DateTime     @default(now())
    updated_at  DateTime     @updatedAt
    submissions Submission[]
  }

  model Submission {
    id                   String           @id @default(uuid())
    user_id              String
    station_id           String?
    price_data           Json
    photo_r2_key         String?
    ocr_confidence_score Float?
    status               SubmissionStatus @default(pending)
    created_at           DateTime         @default(now())
    updated_at           DateTime         @updatedAt
    user                 User             @relation(fields: [user_id], references: [id])
    station              Station?         @relation(fields: [station_id], references: [id])
  }
  ```
  Also add the reverse relation to the `User` model:
  ```prisma
  submissions Submission[]
  ```

- [x] **1.2** Run migration:
  ```bash
  pnpm --filter db db:migrate
  # Name: add_station_and_submission
  ```

- [x] **1.3** Run `pnpm --filter db db:generate` to regenerate the Prisma client.

### Phase 2 — API: SubmissionsModule

- [x] **2.1** Create `apps/api/src/submissions/dto/get-submissions.dto.ts`:
  ```ts
  import { IsInt, IsOptional, Min, Max } from 'class-validator';
  import { Type } from 'class-transformer';

  export class GetSubmissionsDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page: number = 1;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(50)
    limit: number = 20;
  }
  ```

- [x] **2.2** Create `apps/api/src/submissions/submissions.service.ts`:
  - Inject `PrismaService`
  - Method `getMySubmissions(userId: string, page: number, limit: number)`:
    - Query `Submission` where `user_id = userId`
    - Include `station: { select: { id: true, name: true } }`
    - Order by `created_at DESC`
    - Offset pagination: `skip = (page - 1) * limit`, `take = limit`
    - Also get `total` count: `prisma.submission.count({ where: { user_id: userId } })`
    - Map `shadow_rejected` → `pending` in the response (driver must not know about shadow bans):
      ```ts
      const mappedStatus = item.status === 'shadow_rejected' ? 'pending' : item.status;
      ```
    - Return: `{ data: MappedSubmission[], total, page, limit }`
  - `price_data` is `Json` (Prisma) — cast to typed shape in the return type:
    ```ts
    type PriceEntry = { fuel_type: string; price_per_litre: number };
    ```

- [x] **2.3** Create `apps/api/src/submissions/submissions.controller.ts`:
  ```ts
  @Controller('v1/submissions')
  export class SubmissionsController {
    constructor(private readonly submissionsService: SubmissionsService) {}

    @Get()
    @Roles(UserRole.DRIVER)
    getMySubmissions(
      @CurrentUser('id') userId: string,
      @Query() dto: GetSubmissionsDto,
    ) {
      return this.submissionsService.getMySubmissions(userId, dto.page, dto.limit);
    }
  }
  ```
  Import `Roles` from `../auth/decorators/roles.decorator.js`, `UserRole` from `@prisma/client`, `CurrentUser` from `../auth/current-user.decorator.js`.

- [x] **2.4** Create `apps/api/src/submissions/submissions.module.ts`:
  ```ts
  @Module({
    controllers: [SubmissionsController],
    providers: [SubmissionsService],
  })
  export class SubmissionsModule {}
  ```

- [x] **2.5** Register `SubmissionsModule` in `apps/api/src/app.module.ts` imports array.

### Phase 3 — API Tests

- [x] **3.1** Create `apps/api/src/submissions/submissions.service.spec.ts`:
  - Test: returns paginated list of submissions for a user
  - Test: `shadow_rejected` status is mapped to `pending` in response
  - Test: respects page + limit params (verifies skip/take values)
  - Test: returns `total` count correctly
  - Test: returns empty `data: []` when user has no submissions
  - Mock `PrismaService.submission.findMany` and `PrismaService.submission.count`

- [x] **3.2** Create `apps/api/src/submissions/submissions.controller.spec.ts`:
  - Test: calls `submissionsService.getMySubmissions` with correct userId, page, limit
  - Test: uses default page=1, limit=20 when params omitted

### Phase 4 — Mobile: Tab Navigator

- [x] **4.1** Update `apps/mobile/app/(app)/_layout.tsx` — replace Stack with Tab navigator:
  ```tsx
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
  ```

- [x] **4.2** Create `apps/mobile/app/(app)/alerts.tsx` — placeholder:
  ```tsx
  import { View, Text, StyleSheet } from 'react-native';
  export default function AlertsScreen() {
    return (
      <View style={styles.container}>
        <Text>Alerts (coming soon)</Text>
      </View>
    );
  }
  const styles = StyleSheet.create({ container: { flex: 1, justifyContent: 'center', alignItems: 'center' } });
  ```

- [x] **4.3** Create `apps/mobile/app/(app)/account.tsx` — placeholder:
  ```tsx
  import { View, Text, StyleSheet } from 'react-native';
  import { useAuth } from '../../src/store/auth.store';
  import { TouchableOpacity } from 'react-native';
  export default function AccountScreen() {
    const { user, logout } = useAuth();
    return (
      <View style={styles.container}>
        <Text>{user?.display_name ?? user?.email ?? 'Guest'}</Text>
        <TouchableOpacity onPress={logout}><Text>Sign out</Text></TouchableOpacity>
      </View>
    );
  }
  const styles = StyleSheet.create({ container: { flex: 1, justifyContent: 'center', alignItems: 'center' } });
  ```

### Phase 5 — Mobile: API Client + Activity Screen

- [x] **5.1** Create `apps/mobile/src/api/submissions.ts`:
  ```ts
  import { API_BASE, request } from './client.ts'; // or inline fetch pattern matching auth.ts

  export interface PriceEntry {
    fuel_type: string;
    price_per_litre: number;
  }

  export interface Submission {
    id: string;
    station: { id: string; name: string } | null;
    price_data: PriceEntry[];
    status: 'pending' | 'verified' | 'rejected';
    created_at: string;
  }

  export interface SubmissionsResponse {
    data: Submission[];
    total: number;
    page: number;
    limit: number;
  }

  export async function apiGetSubmissions(
    accessToken: string,
    page = 1,
    limit = 20,
  ): Promise<SubmissionsResponse> {
    return request<SubmissionsResponse>(
      `/v1/submissions?page=${page}&limit=${limit}`,
      { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } },
    );
  }
  ```
  **Note:** `auth.ts` inlines the `request` helper — follow the same pattern (no shared client module yet). Duplicate the `request` + `ApiError` in `submissions.ts` or extract to a shared `client.ts` — either is acceptable. Do NOT refactor `auth.ts` unless the dev also refactors to a shared client (preferred for consistency).

- [x] **5.2** Create `apps/mobile/app/(app)/activity.tsx` — Activity screen:
  - State: `submissions: Submission[]`, `total: number`, `page: number`, `isLoading: boolean`, `isLoadingMore: boolean`, `error: string | null`
  - On mount: fetch page 1
  - FlatList with each row showing: station name (or "Processing..."), fuel types + prices, date, status badge
  - Status badge: `pending` → "Processing", `verified` → nothing (it's published), `rejected` → "Not published" (amber/muted text, never looks like a price)
  - Empty state when `total === 0`: encouraging message to make first submission
  - Load more: "Load more" button at bottom OR auto-trigger `onEndReached` — load more if `page * limit < total`
  - Error state: retry button
  - Guest users (no `accessToken`): show prompt to sign in (same sign-up gate pattern)
  - Use `useTranslation()` for all visible strings

### Phase 6 — Mobile: i18n Keys

- [x] **6.1** Add to `apps/mobile/src/i18n/locales/en.ts`:
  ```ts
  nav: {
    map: 'Map',
    activity: 'Activity',
    alerts: 'Alerts',
    account: 'Account',
  },
  submissions: {
    title: 'Activity',
    emptyTitle: 'No submissions yet',
    emptySubtitle: 'Submit a fuel price to see your history here',
    statusPending: 'Processing',
    statusRejected: 'Not published',
    stationUnknown: 'Processing...',
    loadMore: 'Load more',
    errorLoading: 'Failed to load submissions',
    retry: 'Retry',
    signInPrompt: 'Sign in to see your submission history',
  },
  ```

- [x] **6.2** Add to `apps/mobile/src/i18n/locales/pl.ts`:
  ```ts
  nav: {
    map: 'Mapa',
    activity: 'Aktywność',
    alerts: 'Alerty',
    account: 'Konto',
  },
  submissions: {
    title: 'Aktywność',
    emptyTitle: 'Brak zgłoszeń',
    emptySubtitle: 'Prześlij cenę paliwa, aby zobaczyć tutaj swoją historię',
    statusPending: 'Przetwarzanie',
    statusRejected: 'Nie opublikowano',
    stationUnknown: 'Przetwarzanie...',
    loadMore: 'Załaduj więcej',
    errorLoading: 'Nie udało się załadować zgłoszeń',
    retry: 'Spróbuj ponownie',
    signInPrompt: 'Zaloguj się, aby zobaczyć historię zgłoszeń',
  },
  ```

- [x] **6.3** Add to `apps/mobile/src/i18n/locales/uk.ts`:
  ```ts
  nav: {
    map: 'Карта',
    activity: 'Активність',
    alerts: 'Сповіщення',
    account: 'Акаунт',
  },
  submissions: {
    title: 'Активність',
    emptyTitle: 'Немає подань',
    emptySubtitle: 'Подайте ціну на пальне, щоб побачити тут свою історію',
    statusPending: 'Обробляється',
    statusRejected: 'Не опубліковано',
    stationUnknown: 'Обробляється...',
    loadMore: 'Завантажити ще',
    errorLoading: 'Не вдалося завантажити подання',
    retry: 'Спробувати знову',
    signInPrompt: 'Увійдіть, щоб переглянути історію подань',
  },
  ```

## Dev Notes

### File Locations (Critical — do NOT create files elsewhere)

```
packages/db/prisma/
  schema.prisma                  ← MODIFY (add Station, Submission, SubmissionStatus)

apps/api/src/submissions/
  dto/
    get-submissions.dto.ts       ← NEW
  submissions.service.ts         ← NEW
  submissions.service.spec.ts    ← NEW
  submissions.controller.ts      ← NEW
  submissions.controller.spec.ts ← NEW
  submissions.module.ts          ← NEW
apps/api/src/app.module.ts       ← MODIFY (import SubmissionsModule)

apps/mobile/app/(app)/
  _layout.tsx                    ← MODIFY (Stack → Tabs)
  activity.tsx                   ← NEW
  alerts.tsx                     ← NEW (placeholder)
  account.tsx                    ← NEW (placeholder)
apps/mobile/src/api/
  submissions.ts                 ← NEW
apps/mobile/src/i18n/locales/
  en.ts                          ← MODIFY (add nav + submissions keys)
  pl.ts                          ← MODIFY (add nav + submissions keys)
  uk.ts                          ← MODIFY (add nav + submissions keys)
```

### Architecture Compliance

- **RBAC:** `GET /v1/submissions` uses `@Roles(UserRole.DRIVER)` — only DRIVER role can see their own submissions. JwtAuthGuard loads full User from DB; `@CurrentUser('id')` extracts `user.id` from `req.currentUser`.
- **No `@Public()`** on the submissions endpoint — auth is mandatory.
- **Shadow ban is invisible to user:** `shadow_rejected` → mapped to `pending` in API response. The driver sees "Processing" indefinitely — they never learn their submissions are being discarded.
- **Global guards** (`JwtAuthGuard` + `RolesGuard`) are already registered via `APP_GUARD` in `AppModule` — no `@UseGuards()` needed in the controller.

### Prisma Schema — Critical Notes

- `price_data` is `Json` type — the runtime shape is `{ fuel_type: string; price_per_litre: number }[]`. Prisma does not enforce this shape; the service casts it.
- `user_id` is **non-nullable** (architecture Decision 2: retained permanently for GDPR legitimate interest / moderation). Do NOT add `onDelete: Cascade` — submissions survive user deletion.
- `station_id` **is nullable** — the OCR worker fills this in asynchronously after submission. Submissions may exist with `station_id = null` while in `pending` status.
- `photo_r2_key` is nullable — will be null after OCR processing completes (deleted from R2).
- Add `@@index([user_id, created_at])` to `Submission` for the history query performance.

### Migration

Run from repo root:
```bash
pnpm --filter db db:migrate
# Prompt: Name your migration: add_station_and_submission
pnpm --filter db db:generate
```

### API — Import Conventions

All imports in `apps/api/src` use `.js` extension (ES module resolution with TypeScript):
```ts
import { PrismaService } from '../prisma/prisma.service.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
```
`@prisma/client` imports have no `.js` extension:
```ts
import { UserRole } from '@prisma/client';
```

### Mobile — API Client Pattern

`auth.ts` inlines the `request` helper and `ApiError` class. `submissions.ts` must follow the same pattern — do NOT introduce a new shared client module unless also refactoring `auth.ts` to use it (preferred to keep consistent, but scope accordingly — if refactoring auth.ts, update its spec too).

Existing pattern from `auth.ts`:
```ts
const API_BASE = process.env['EXPO_PUBLIC_API_URL'] ?? 'http://localhost:3000';
// ...request() helper inline
```

### Mobile — Tab Navigator (Expo Router)

Expo Router v3 (already in the project). In `(app)/_layout.tsx`, use `<Tabs>` from `expo-router`. Each `<Tabs.Screen name="...">` maps to a file in the `(app)/` directory:
- `name="index"` → `(app)/index.tsx` (Map)
- `name="activity"` → `(app)/activity.tsx`
- `name="alerts"` → `(app)/alerts.tsx`
- `name="account"` → `(app)/account.tsx`

The current `(app)/_layout.tsx` returns `<Stack screenOptions={{ headerShown: false }} />`. Replace the Stack entirely with Tabs. The existing `index.tsx` (MapScreen) stays unchanged — only the layout changes.

**Check what version of expo-router is installed before writing code:**
```bash
grep expo-router apps/mobile/package.json
```

### Mobile — Guest Users on Activity Tab

Guests (no `accessToken`) landing on the Activity tab: show a prompt to sign in. Do NOT redirect automatically — let the user tap to navigate to auth. Same pattern used in `SoftSignUpSheet`.

### i18n — Already Bootstrapped

i18n is fully set up from Story 1.4:
- Library: `i18next` + `react-i18next` + `expo-localization`
- Locales: `apps/mobile/src/i18n/locales/{en,pl,uk}.ts`
- Initialized in: `apps/mobile/src/i18n/index.ts` (imported in root `_layout.tsx`)
- Usage: `const { t } = useTranslation()` then `t('submissions.title')`

Only add keys — do NOT change the file structure or initialization.

### Fuel Type Display

`price_data` contains entries like `{ fuel_type: 'petrol_95', price_per_litre: 1.89 }`. Display as:
- `petrol_95` → "Petrol 95" / "Benzyna 95" / "Бензин 95"
- `petrol_98` → "Petrol 98" / "Benzyna 98" / "Бензин 98"
- `diesel` → "Diesel" / "Diesel" / "Дизель"
- `lpg` → "LPG" / "LPG" / "LPG"

Add these as i18n keys under `submissions.fuelTypes.*` or format inline — either is acceptable. Keep it simple.

### Previous Story Patterns (from Stories 1.1–1.5)

- All new `.ts` files in `apps/api/src` use `.js` extension on local imports
- Tests use Jest with `mockResolvedValueOnce` / `mockReturnValueOnce` patterns (not spies)
- `PrismaService` is injected (not imported directly) — mocked in tests via `{ provide: PrismaService, useValue: mockPrismaService }`
- Guards are global — no `@UseGuards()` on controllers
- `@CurrentUser('id')` extracts `user.id` from the full Prisma `User` on `req.currentUser`
- Module naming: PascalCase class, kebab-case file

### Existing Tests That Must Keep Passing

- `apps/api/src/auth/**/*.spec.ts` — 39 tests (do not modify auth module)
- `apps/api/src/health/health.controller.spec.ts`
- `apps/api/src/redis/redis.module.spec.ts`
- `apps/api/src/storage/storage.service.spec.ts`

Run `pnpm --filter api test` to confirm all 39+ tests pass after implementation.

### Out of Scope (do NOT implement)

- `POST /v1/submissions` — submission creation flow comes in Epic 2
- POI sync / Google Places integration
- OCR pipeline (BullMQ worker)
- Full Station model with PostGIS coordinates (comes in Station/POI story)
- Fill-up log on Activity tab (Phase 2)
- Leaderboard / streaks (Phase 2)
- Push notification for submission outcome (explicitly excluded per architecture Decision 4)
- The Alerts tab screen (placeholder only)
- The full Account tab screen (placeholder with sign-out button is sufficient)

## Review Notes (2026-04-04)

No patches applied. One P-1 bug found but already fixed in a later commit.

**P-1 (fixed in e56aa9a):** `FUEL_TYPE_KEYS` in `activity.tsx` used lowercase keys (`petrol_95`, `diesel`) that never matched stored uppercase values (`PB_95`, `ON`). Also missing `ON_PREMIUM`. The `formatFuelType` fallback `?? fuelType` meant users always saw raw codes. Fixed in commit `e56aa9a` (UI polish) which replaced the mapping with i18n (`t('fuelTypes.${p.fuel_type}', { defaultValue: p.fuel_type })`).

**D1:** `ApiError` class is duplicated between `apps/mobile/src/api/submissions.ts` and `apps/mobile/src/api/auth.ts`. DRY issue, not a bug — acceptable for MVP. Extract to shared `apps/mobile/src/api/client.ts` in a future cleanup.

**D2:** `@Roles(UserRole.DRIVER)` limits `GET /v1/submissions` to drivers only. Admins/fleet managers cannot query their own submissions via this endpoint. Acceptable for MVP scope; admin views come in a future epic.
