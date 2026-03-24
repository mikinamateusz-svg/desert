# Story 1.12: In-App Feedback & Feature Requests

Status: review

## Story

As a **driver**,
I want to send feedback or suggest a feature directly from the app,
so that I can share ideas and problems without leaving the app to find a support channel.

## Why

The cheapest and most reliable product research is a feedback button shipped on day one. Real drivers telling us what they need — in their own words, in context — is worth more than any survey. This also signals to early adopters that the team is listening, which builds loyalty. Lean implementation: a text field that lands in a tool the team already monitors. No custom infrastructure needed.

## Acceptance Criteria

1. **Given** a driver opens the Account screen,
   **When** they view it,
   **Then** they see a "Send feedback" entry point (button or row) below the existing account options.

2. **Given** a driver taps the feedback entry point,
   **When** the feedback screen opens,
   **Then** they see a free-text field (max 1000 characters) and a send button,
   **And** their app version and OS are automatically attached to the submission (not shown to the user, used for triage).

3. **Given** a driver submits feedback,
   **When** it is sent successfully,
   **Then** they see a brief confirmation: "Thanks — we read every message",
   **And** the feedback is delivered to the team's designated inbox via a Slack webhook (configured via `FEEDBACK_WEBHOOK_URL` env var).

4. **Given** a driver submits feedback,
   **When** it is processed,
   **Then** no personal data beyond app version and OS is attached — feedback is anonymous by default.

5. **Given** a driver views the feedback screen in their selected language,
   **When** it is Polish, English, or Ukrainian,
   **Then** all labels and confirmation messages are displayed in that language.

6. **Given** `FEEDBACK_WEBHOOK_URL` is not set in the API environment,
   **When** a feedback submission arrives,
   **Then** the API logs a warning and returns 202 (feedback is not silently dropped — the warning is observable).

## Tasks / Subtasks

### Phase 1 — API: FeedbackModule (AC: 2, 3, 4, 6)

- [x] **1.1** Create `apps/api/src/feedback/dto/submit-feedback.dto.ts`:

  ```ts
  import { IsString, MaxLength, MinLength } from 'class-validator';

  export class SubmitFeedbackDto {
    @IsString()
    @MinLength(1)
    @MaxLength(1000)
    message!: string;

    @IsString()
    @MaxLength(100)
    app_version!: string;

    @IsString()
    @MaxLength(100)
    os!: string;
  }
  ```

- [x] **1.2** Create `apps/api/src/feedback/feedback.service.ts`:

  ```ts
  import { Injectable, Logger } from '@nestjs/common';
  import { ConfigService } from '@nestjs/config';
  import { SubmitFeedbackDto } from './dto/submit-feedback.dto.js';

  @Injectable()
  export class FeedbackService {
    private readonly logger = new Logger(FeedbackService.name);

    constructor(private readonly config: ConfigService) {}

    async submitFeedback(dto: SubmitFeedbackDto): Promise<void> {
      const webhookUrl = this.config.get<string>('FEEDBACK_WEBHOOK_URL');
      if (!webhookUrl) {
        this.logger.warn('FEEDBACK_WEBHOOK_URL not set — feedback received but not forwarded');
        return;
      }

      const text = `*New feedback*\n>${dto.message}\n_App: ${dto.app_version} | OS: ${dto.os}_`;

      try {
        const res = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) {
          this.logger.error(`Slack webhook returned ${res.status}`);
        }
      } catch (err) {
        this.logger.error('Failed to post feedback to webhook', err);
      }
    }
  }
  ```

  **Key decisions:**
  - `fetch` is available natively in Node 18+ — no additional http library needed.
  - Slack Incoming Webhook format: POST JSON body `{ text: "..." }`. Simple text with `>` for block quote. [Slack docs](https://api.slack.com/messaging/webhooks).
  - Service never throws — failure is logged, not propagated. The AC says feedback must not be silently dropped (AC 6 requires a log warning), but the 202 still returns.
  - No personal data (no user ID, email, display name) — feedback is anonymous (AC 4).

- [x] **1.3** Create `apps/api/src/feedback/feedback.controller.ts`:

  ```ts
  import { Body, Controller, HttpCode, Post } from '@nestjs/common';
  import { Throttle } from '@nestjs/throttler';
  import { FeedbackService } from './feedback.service.js';
  import { SubmitFeedbackDto } from './dto/submit-feedback.dto.js';

  @Controller('v1/feedback')
  export class FeedbackController {
    constructor(private readonly feedbackService: FeedbackService) {}

    @Post()
    @HttpCode(202)
    @Throttle({ default: { ttl: 3600, limit: 5 } })
    async submitFeedback(@Body() dto: SubmitFeedbackDto): Promise<{ message: string }> {
      await this.feedbackService.submitFeedback(dto);
      return { message: 'Feedback received' };
    }
  }
  ```

  **Key decisions:**
  - Endpoint: `POST /v1/feedback` — follows existing `/v1/` prefix convention.
  - Rate limit: 5 per hour per IP. More generous than export (3/hr) since this is lower-cost. Uses `@Throttle` decorator to override global default (global default in `app.module.ts` is `{ ttl: 3600, limit: 3 }`).
  - Returns 202 to indicate async processing (webhook delivery is fire-and-forget internally).
  - **This endpoint is authenticated** — `JwtAuthGuard` is applied globally via `APP_GUARD`. Feedback is tied to a session but the payload contains no user identity. The mobile client must include `Authorization: Bearer <token>` header. This provides spam protection without attaching user identity to the message content.
  - `@Body()` requires `ValidationPipe` to be active globally — it already is (verify in `main.ts`).

- [x] **1.4** Create `apps/api/src/feedback/feedback.module.ts`:

  ```ts
  import { Module } from '@nestjs/common';
  import { FeedbackController } from './feedback.controller.js';
  import { FeedbackService } from './feedback.service.js';

  @Module({
    controllers: [FeedbackController],
    providers: [FeedbackService],
  })
  export class FeedbackModule {}
  ```

- [x] **1.5** Register `FeedbackModule` in `apps/api/src/app.module.ts`:

  Add `import { FeedbackModule } from './feedback/feedback.module.js';` to imports.
  Add `FeedbackModule` to the `imports: []` array alongside existing modules.

  **Warning:** Do NOT remove or reorder existing modules. The file currently imports: `HealthModule`, `StorageModule`, `RedisModule`, `AuthModule`, `SubmissionsModule`, `NotificationsModule`, `UserModule`. Add `FeedbackModule` at the end of the list.

- [x] **1.6** Add `FEEDBACK_WEBHOOK_URL` to `apps/api/.env.example`:

  Add below the `RESEND_API_KEY` line (or at the bottom of the file):
  ```
  # Feedback webhook (Slack Incoming Webhook URL — optional, feedback logged if not set)
  FEEDBACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
  ```

  **Note:** `RESEND_API_KEY` is used in `user.service.ts` but missing from `.env.example`. Add both entries.

### Phase 2 — API Tests (AC: 3, 4, 6)

- [x] **2.1** Create `apps/api/src/feedback/feedback.service.spec.ts`:

  ```ts
  // Mock global fetch
  global.fetch = jest.fn();

  // Test: submitFeedback() posts correct Slack payload when FEEDBACK_WEBHOOK_URL is set
  //   - verify fetch called with webhookUrl, method POST, Content-Type application/json
  //   - verify body contains message text, app_version, os
  //   - verify no user identity fields in body

  // Test: submitFeedback() logs warn and returns (no throw) when FEEDBACK_WEBHOOK_URL is not set

  // Test: submitFeedback() logs error (no throw) when fetch returns non-ok status (e.g. 500)

  // Test: submitFeedback() logs error (no throw) when fetch throws (network error)
  ```

  **Pattern:** Match `user.service.spec.ts` — inject `mockConfigService`, use `jest.fn()` for all external calls.

- [x] **2.2** Create `apps/api/src/feedback/feedback.controller.spec.ts`:

  ```ts
  // Test: POST /v1/feedback with valid dto calls feedbackService.submitFeedback and returns 202 { message: 'Feedback received' }
  // Test: POST /v1/feedback with message > 1000 chars → ValidationPipe rejects (400 BadRequest)
  // Test: POST /v1/feedback with empty message → ValidationPipe rejects (400 BadRequest)
  ```

  **Pattern:** Match `user.controller.spec.ts` — use `Test.createTestingModule`, mock `FeedbackService`, `{ provide: FeedbackService, useValue: mockFeedbackService }`.

  **Important:** The controller test does NOT test rate limiting or JWT — those are guard-level concerns already tested elsewhere.

### Phase 3 — Mobile: API client function (AC: 2, 3)

- [x] **3.1** Add `apiSubmitFeedback` to `apps/mobile/src/api/user.ts`:

  ```ts
  export async function apiSubmitFeedback(
    accessToken: string,
    payload: { message: string; app_version: string; os: string },
  ): Promise<{ message: string }> {
    return request<{ message: string }>('/v1/feedback', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(payload),
    });
  }
  ```

  **Why `user.ts`?** This file contains all user-facing API calls (`apiDeleteAccount`, `apiRequestDataExport`, `apiGetConsents`, `apiWithdrawConsent`). Feedback is user-facing. Do not create a new `feedback.ts` file — keep related calls co-located.

### Phase 4 — Mobile: Feedback screen (AC: 1, 2, 3, 4, 5)

- [x] **4.1** Create `apps/mobile/app/(app)/feedback.tsx`:

  **Full implementation:**
  ```tsx
  import { useState } from 'react';
  import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
  import { router } from 'expo-router';
  import { useTranslation } from 'react-i18next';
  import Constants from 'expo-constants';
  import { useAuth } from '../../src/store/auth.store';
  import { apiSubmitFeedback } from '../../src/api/user';

  export default function FeedbackScreen() {
    const { t } = useTranslation();
    const { accessToken } = useAuth();
    const [message, setMessage] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const appVersion = (Constants.expoConfig?.version ?? 'unknown');
    const os = Platform.OS;

    async function handleSubmit() {
      if (!accessToken || !message.trim()) return;
      setIsSubmitting(true);
      setError(null);
      try {
        await apiSubmitFeedback(accessToken, {
          message: message.trim(),
          app_version: appVersion,
          os,
        });
        setSubmitted(true);
      } catch {
        setError(t('feedback.errorSubmitting'));
      } finally {
        setIsSubmitting(false);
      }
    }

    if (submitted) {
      return (
        <View style={styles.center}>
          <Text style={styles.thankYouText}>{t('feedback.thankYou')}</Text>
          <TouchableOpacity style={styles.doneButton} onPress={() => router.back()}>
            <Text style={styles.doneButtonText}>{t('feedback.done')}</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>{t('feedback.label')}</Text>
          <TextInput
            style={styles.input}
            value={message}
            onChangeText={setMessage}
            placeholder={t('feedback.placeholder')}
            placeholderTextColor="#aaa"
            multiline
            maxLength={1000}
            textAlignVertical="top"
          />
          <Text style={styles.charCount}>{message.length}/1000</Text>
          {error && <Text style={styles.errorText}>{error}</Text>}
          <TouchableOpacity
            style={[styles.submitButton, (isSubmitting || !message.trim()) && styles.submitButtonDisabled]}
            onPress={() => void handleSubmit()}
            disabled={isSubmitting || !message.trim()}
          >
            {isSubmitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.submitButtonText}>{t('feedback.submit')}</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  const styles = StyleSheet.create({
    flex: { flex: 1, backgroundColor: '#fff' },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#fff' },
    container: { padding: 24 },
    label: { fontSize: 15, color: '#333', marginBottom: 12 },
    input: {
      borderWidth: 1,
      borderColor: '#ccc',
      borderRadius: 8,
      padding: 12,
      fontSize: 15,
      color: '#1a1a1a',
      minHeight: 140,
      marginBottom: 8,
    },
    charCount: { fontSize: 12, color: '#999', textAlign: 'right', marginBottom: 16 },
    errorText: { fontSize: 14, color: '#ef4444', marginBottom: 12 },
    submitButton: {
      backgroundColor: '#f59e0b',
      paddingVertical: 14,
      borderRadius: 10,
      alignItems: 'center',
    },
    submitButtonDisabled: { opacity: 0.5 },
    submitButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
    thankYouText: { fontSize: 18, fontWeight: '600', color: '#1a1a1a', marginBottom: 24, textAlign: 'center' },
    doneButton: {
      paddingHorizontal: 32,
      paddingVertical: 12,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: '#f59e0b',
    },
    doneButtonText: { color: '#f59e0b', fontSize: 15, fontWeight: '500' },
  });
  ```

  **Key implementation notes:**
  - `expo-constants` is already used in the project (`useNotificationPermission.ts` imports it). No new dependency needed. Access: `Constants.expoConfig?.version` — returns the version from `app.json` (`"1.0.0"`).
  - `Platform.OS` is from `react-native` — already imported everywhere, no new import.
  - `KeyboardAvoidingView` + `ScrollView` pattern: same as `delete-account.tsx` — prevents keyboard from obscuring the input.
  - Guest mode: if `!accessToken`, the button is disabled. However, the feedback entry point on account screen is visible to all users (AC 1 says "a driver opens the app settings menu"). The screen gracefully handles unauthenticated state by disabling submit. Consider: the account screen currently shows `'Guest'` for unauthenticated users — the feedback button can be shown but submit is gated on `accessToken`.
  - `void handleSubmit()` pattern — consistent with all other screens (`void handleExportData()`, etc.).
  - `router.back()` — navigate back to account screen after success.

- [x] **4.2** Add "Send feedback" entry point to `apps/mobile/app/(app)/account.tsx`:

  **Current state of account.tsx** (as implemented after Story 1.11):
  - Imports: `useAuth`, `apiRequestDataExport`, `changeLanguage`, `SUPPORTED_LOCALES`, `SupportedLocale`, `useTranslation`
  - Buttons in order: language selector, Sign out, Download my data, Privacy settings, Delete my account

  **Change:** Add a feedback `TouchableOpacity` row after the "Privacy settings" button and before the "Delete my account" row.

  `router` is already imported at line 3 of `account.tsx`: `import { router } from 'expo-router';` — no new import needed.

  Add button after the privacySettings `TouchableOpacity`:
  ```tsx
  <TouchableOpacity style={styles.button} onPress={() => router.push('/(app)/feedback')}>
    <Text style={styles.buttonText}>{t('account.sendFeedback')}</Text>
  </TouchableOpacity>
  ```

  **No new styles needed** — uses existing `styles.button` and `styles.buttonText`.

  **Warning:** Do NOT remove the existing `router.push` calls for `/(app)/privacy-settings` and `/(app)/delete-account`. Simply add the feedback button between privacy-settings and delete-account.

### Phase 5 — i18n: Add feedback keys (AC: 5)

- [x] **5.1** Add `feedback` namespace to `apps/mobile/src/i18n/locales/en.ts`:

  Append before `} as const` (after the `notifications` block):
  ```ts
  feedback: {
    label: 'Your message',
    placeholder: 'Tell us what you think or suggest a feature...',
    submit: 'Send feedback',
    thankYou: 'Thanks — we read every message',
    done: 'Done',
    errorSubmitting: 'Failed to send feedback. Please try again.',
  },
  ```

- [x] **5.2** Add `feedback` namespace to `apps/mobile/src/i18n/locales/pl.ts`:

  Append before `} as const` (after the `notifications` block):
  ```ts
  feedback: {
    label: 'Twoja wiadomość',
    placeholder: 'Napisz, co myślisz, lub zaproponuj funkcję...',
    submit: 'Wyślij opinię',
    thankYou: 'Dzięki — czytamy każdą wiadomość',
    done: 'Gotowe',
    errorSubmitting: 'Nie udało się wysłać opinii. Spróbuj ponownie.',
  },
  ```

- [x] **5.3** Add `feedback` namespace to `apps/mobile/src/i18n/locales/uk.ts`:

  Append before `} as const` (after the `notifications` block):
  ```ts
  feedback: {
    label: 'Ваше повідомлення',
    placeholder: 'Розкажіть, що ви думаєте, або запропонуйте функцію...',
    submit: 'Надіслати відгук',
    thankYou: 'Дякуємо — ми читаємо кожне повідомлення',
    done: 'Готово',
    errorSubmitting: 'Не вдалося надіслати відгук. Спробуйте ще раз.',
  },
  ```

- [x] **5.4** Add `account.sendFeedback` key to all three locale files:

  In `en.ts` — inside the existing `account` object, add:
  ```ts
  sendFeedback: 'Send feedback',
  ```

  In `pl.ts` — inside the existing `account` object, add:
  ```ts
  sendFeedback: 'Wyślij opinię',
  ```

  In `uk.ts` — inside the existing `account` object, add:
  ```ts
  sendFeedback: 'Надіслати відгук',
  ```

  **Warning:** The `account` object is already defined in all three files. Do NOT re-define it — add the new key inside the existing `account` block alongside `signOut`, `deleteAccountButton`, etc. See Story 1.11 for precedent (added `language.*` keys the same way).

### Phase 6 — Register feedback screen in Expo Router (AC: 1, 2)

- [x] **6.1** The `apps/mobile/app/(app)/` directory uses file-based routing via Expo Router. Creating `feedback.tsx` in that directory automatically registers it as the route `/(app)/feedback`. No additional configuration needed — Expo Router discovers it automatically.

  **Verify:** The `(app)/_layout.tsx` defines `<Tabs>` with 4 named screens (`index`, `activity`, `alerts`, `account`). The `feedback` screen should NOT appear as a tab — it is a push route. Since `feedback` is not listed in `<Tabs.Screen>`, it will be rendered as a stack-style screen within the `(app)` group. This is the same pattern as `delete-account.tsx` and `privacy-settings.tsx`.

  **Back navigation:** `router.back()` in the success state returns to the account screen. This works because the user navigated to feedback via `router.push('/(app)/feedback')`.

### Review Follow-ups (AI)

- [x] **P1** Add `@MinLength(1)` to `app_version` and `os` fields in `SubmitFeedbackDto` — prevents empty-string values passing validation
- [x] **P2** Wrap `fetch()` in `feedback.service.ts` with `AbortController` + 5 s timeout — clears timeout in `finally` block; catch handles both `AbortError` and network failure without throwing
- [x] **P3** Add `|| !accessToken` to `disabled` prop and style condition on Submit button in `feedback.tsx` — submit handler early-return guard was already present

## Dev Notes

### Architecture Decisions for This Story

**No database table for feedback.** The epics spec says "lean implementation — no custom infrastructure needed." Feedback goes directly to a Slack webhook (or similar). No `Feedback` model in Prisma schema — do not add one.

**Endpoint is authenticated but anonymous.** The `JwtAuthGuard` (global `APP_GUARD`) requires a valid JWT. This prevents spam without attaching user identity to the message text. The service layer receives only `{ message, app_version, os }` — no user ID is passed to `FeedbackService.submitFeedback()`.

**Webhook delivery is fire-and-forget from the API perspective.** The controller awaits `submitFeedback()` which catches all errors internally. The 202 response always returns to the mobile client. Slack delivery failures are logged with `Logger.error` for observability.

**`fetch` in NestJS/Node 18+.** Native `fetch` is available globally in Node 18+. The project uses Node 18+ (confirmed by Railway deployment). Do not install `node-fetch` or `axios`. The existing codebase uses native `fetch` in mobile (e.g., `apps/mobile/src/api/user.ts`) but the API has not needed it until now. For the service spec test, mock `global.fetch`.

**`expo-constants` is already available.** It is a transitive dependency of `expo` and is already imported in `apps/mobile/src/hooks/useNotificationPermission.ts`. No new package needed. `Constants.expoConfig?.version` returns the `version` field from `app.json` (`"1.0.0"`).

**Throttle rate.** The feedback endpoint uses `@Throttle({ default: { ttl: 3600, limit: 5 } })`. This overrides the global `ThrottlerModule.forRoot([{ ttl: 3600, limit: 3 }])` — same pattern as `user.controller.ts` `requestDataExport` endpoint. Feedback is cheaper than data export so slightly higher limit is appropriate.

**`ValidationPipe` is already globally configured.** `apps/api/src/main.ts` has `app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))`. No changes needed to `main.ts`.

**API uses Fastify, not Express.** The NestJS app is created with `FastifyAdapter`. This is transparent to the `FeedbackModule` — NestJS decorators (`@Controller`, `@Post`, `@Body`, etc.) work identically. `fetch` is Node.js native, not HTTP-framework-dependent.

### Source Tree — Files to Create

**New API files:**
- `apps/api/src/feedback/dto/submit-feedback.dto.ts`
- `apps/api/src/feedback/feedback.service.ts`
- `apps/api/src/feedback/feedback.controller.ts`
- `apps/api/src/feedback/feedback.module.ts`
- `apps/api/src/feedback/feedback.service.spec.ts`
- `apps/api/src/feedback/feedback.controller.spec.ts`

**New mobile files:**
- `apps/mobile/app/(app)/feedback.tsx`

**Modified API files:**
- `apps/api/src/app.module.ts` — add `FeedbackModule` import and registration
- `apps/api/.env.example` — add `FEEDBACK_WEBHOOK_URL` and `RESEND_API_KEY` entries

**Modified mobile files:**
- `apps/mobile/src/api/user.ts` — add `apiSubmitFeedback`
- `apps/mobile/app/(app)/account.tsx` — add "Send feedback" button
- `apps/mobile/src/i18n/locales/en.ts` — add `feedback.*` namespace + `account.sendFeedback`
- `apps/mobile/src/i18n/locales/pl.ts` — same
- `apps/mobile/src/i18n/locales/uk.ts` — same

**NOT modified:**
- `packages/db/prisma/schema.prisma` — no DB table for feedback
- Any other existing module files

### i18n Key Integrity Rules (from Story 1.11 — must follow)

1. Preserve `as const` at the end of every locale file.
2. All three locale files must have identical key structure — `feedback.*` must be defined in `en.ts`, `pl.ts`, and `uk.ts`.
3. `account.sendFeedback` must be added to all three files inside the existing `account` object.
4. Do NOT remove existing keys.
5. Every key defined must be used in a component — `feedback.*` keys are used in `feedback.tsx`; `account.sendFeedback` is used in `account.tsx`.
6. `feedback` becomes a new top-level namespace sibling to `auth`, `nav`, `submissions`, `account`, `privacy`, `notifications`, `map`, `fuelTypes`.

### Existing i18n Key Structure (after Story 1.11)

```
en.ts (and pl.ts, uk.ts mirror this exactly):
├── auth.*
├── nav.*
├── submissions.*
├── map.*
├── fuelTypes.*
├── account.*          ← add sendFeedback here
├── privacy.*
├── notifications.*
└── feedback.*         ← NEW top-level namespace (this story)
    ├── label
    ├── placeholder
    ├── submit
    ├── thankYou
    ├── done
    └── errorSubmitting
```

### NestJS Module Pattern

All existing modules follow this structure:
- `*.module.ts` — declares controllers + providers
- `*.controller.ts` — `@Controller('v1/...')` route prefix
- `*.service.ts` — `@Injectable()` business logic
- `dto/*.dto.ts` — request body validation
- `*.controller.spec.ts` + `*.service.spec.ts` — Jest unit tests

FeedbackModule follows exactly this pattern. File path: `apps/api/src/feedback/`.

### API Endpoint Summary

| Method | Path | Auth | Rate Limit | Response |
|--------|------|------|------------|----------|
| POST | `/v1/feedback` | JWT required | 5/hr | 202 `{ message: 'Feedback received' }` |

### Previous Story Learnings

**From Story 1.11 (P1):** Always grep for hardcoded strings before marking done. All feedback screen strings go through `t()` — no hardcoded English text in JSX.

**From Story 1.11 (P3):** Double-init guard for i18n — not relevant here, but the `initI18n()` is already properly guarded.

**From Story 1.10 (P1):** Check every string in every new component before finishing — use grep for literal string quotes in JSX.

**From Story 1.10 (P2):** Do not hardcode values that should come from parameters. In this story: webhook URL comes from config, not hardcoded.

**From Story 1.9 (F2):** Ensure controller tests assert `sendExportEmail` was called — similarly here: ensure `feedback.controller.spec.ts` asserts `feedbackService.submitFeedback` was called with the correct DTO.

**From Story 1.8 (P4):** Use `KeyboardAvoidingView` for screens with text inputs. Applied: `feedback.tsx` uses `KeyboardAvoidingView` with `behavior={Platform.OS === 'ios' ? 'padding' : 'height'}`.

### Existing Styling Reference

The app uses a consistent visual language:
- Background: `#fff`
- Primary accent: `#f59e0b` (amber — used for buttons, active states)
- Primary text: `#1a1a1a`
- Secondary text: `#444`, `#666`, `#999`
- Error: `#ef4444`, `#dc2626`
- Border: `#ccc`
- Button border radius: `8–10px`
- Active/selected state: `#f59e0b` border + `#fffbeb` background

The `feedback.tsx` styles defined above follow these conventions.

### Guest / Unauthenticated User Handling

The account screen shows `user?.display_name ?? user?.email ?? 'Guest'`. Guest users can navigate to the feedback screen (button is visible). However `handleSubmit()` checks `!accessToken` and returns early — the submit button is disabled when `!accessToken` is true (the `disabled` prop). This is consistent with other account-screen actions (export, notifications).

The feedback entry point should always be visible (no conditional rendering based on auth state) to encourage engagement.

### Project Structure Notes

- New feedback module lives in `apps/api/src/feedback/` — parallel to `apps/api/src/user/`, `apps/api/src/notifications/`, etc.
- New mobile screen lives in `apps/mobile/app/(app)/feedback.tsx` — parallel to `delete-account.tsx`, `privacy-settings.tsx`.
- No changes to `packages/` — this feature is self-contained within `apps/api` and `apps/mobile`.

### References

- Story 1.9 (data export): `apps/api/src/user/user.controller.ts` — throttle decorator pattern [Source: apps/api/src/user/user.controller.ts]
- Story 1.10 (consent): `apps/api/src/app.module.ts` — module registration pattern [Source: apps/api/src/app.module.ts]
- Story 1.11 (i18n): i18n key structure and `as const` rules [Source: _bmad-output/implementation-artifacts/1-11-i18n-foundation.md]
- Delete account screen: `KeyboardAvoidingView` pattern [Source: apps/mobile/app/(app)/delete-account.tsx]
- Existing account screen: full current state [Source: apps/mobile/app/(app)/account.tsx]
- Locale files: current key structure [Source: apps/mobile/src/i18n/locales/en.ts, pl.ts, uk.ts]
- Throttler: global config + per-endpoint override [Source: apps/api/src/app.module.ts + apps/api/src/user/user.controller.ts]
- epics.md Story 1.12 [Source: _bmad-output/planning-artifacts/epics.md#Story-1.12]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

None — all tasks completed without issues on first run.

### Completion Notes List

- Task 1.2: Used `import type` for `SubmitFeedbackDto` in `feedback.service.ts` per `verbatimModuleSyntax` rule. Controller uses regular import (value needed at runtime for DI metadata).
- Task 1.6: Also added `RESEND_API_KEY` entry to `.env.example` as noted in the story — it was missing.
- Task 2.2: ValidationPipe tests use the pipe directly (instantiated in the test) rather than via HTTP — consistent with unit testing approach. Controller-level test confirms `submitFeedback` is called with correct DTO and returns `{ message: 'Feedback received' }`.
- Phase 6: Confirmed `feedback` not listed in `_layout.tsx` Tabs — renders as stack/push route within `(app)` group, same pattern as `delete-account.tsx` and `privacy-settings.tsx`.
- Full test suite result: 106 tests, 14 suites, all passing.

### File List

**New API files:**
- `apps/api/src/feedback/dto/submit-feedback.dto.ts`
- `apps/api/src/feedback/feedback.service.ts`
- `apps/api/src/feedback/feedback.controller.ts`
- `apps/api/src/feedback/feedback.module.ts`
- `apps/api/src/feedback/feedback.service.spec.ts`
- `apps/api/src/feedback/feedback.controller.spec.ts`

**New mobile files:**
- `apps/mobile/app/(app)/feedback.tsx`

**Modified API files:**
- `apps/api/src/app.module.ts`
- `apps/api/.env.example`

**Modified mobile files:**
- `apps/mobile/src/api/user.ts`
- `apps/mobile/app/(app)/account.tsx`
- `apps/mobile/src/i18n/locales/en.ts`
- `apps/mobile/src/i18n/locales/pl.ts`
- `apps/mobile/src/i18n/locales/uk.ts`

**Patch files (review follow-up):**
- `apps/api/src/feedback/dto/submit-feedback.dto.ts` — P1: added `@MinLength(1)` to `app_version` and `os`
- `apps/api/src/feedback/feedback.service.ts` — P2: added AbortController + 5 s timeout around fetch
- `apps/mobile/app/(app)/feedback.tsx` — P3: added `|| !accessToken` to `disabled` prop and style condition

### Review Action Items

- [x] **P1** — DTO `@MinLength(1)`: added `@MinLength(1)` decorator to `app_version` and `os` fields in `submit-feedback.dto.ts`; `MinLength` was already imported
- [x] **P2** — fetch timeout: wrapped `fetch()` in `feedback.service.ts` with `AbortController` + `setTimeout(5000)`; timeout cleared in `finally` block; `AbortError` caught and logged by existing `catch (err)` handler
- [x] **P3** — guest disable: added `|| !accessToken` to `disabled` prop and style condition in `feedback.tsx`; early-return guard `if (!accessToken || !message.trim()) return` was already present in `handleSubmit`

## Senior Developer Review (AI)

**Review date:** 2026-03-24
**Reviewer model:** claude-sonnet-4-6
**Review mode:** full (spec + all changed files)
**Diff scope:** uncommitted working-tree changes (8 modified files + 3 untracked: `apps/api/src/feedback/`, `apps/mobile/app/(app)/feedback.tsx`, `_bmad-output/implementation-artifacts/1-12-in-app-feedback.md`)

### Acceptance Criteria Verification

| AC | Result | Notes |
|----|--------|-------|
| AC 1 — "Send feedback" entry point on Account screen | Pass | `account.tsx:69-71` |
| AC 2 — Free-text field (max 1000), app version + OS attached | Pass | `feedback.tsx` + `SubmitFeedbackDto` |
| AC 3 — Confirmation + Slack webhook delivery | Pass | en.ts `thankYou` = exact spec text; `FeedbackService` posts to webhook |
| AC 4 — No personal data beyond app version and OS | Pass | Service receives `{message, app_version, os}` only — no user ID traverses the stack |
| AC 5 — All labels in PL/EN/UK | Pass | All 6 `feedback.*` keys + `account.sendFeedback` present in all three locale files |
| AC 6 — Missing webhook URL logs warning and returns 202 | Pass | `feedback.service.ts:13-16`; controller always returns 202 |

### Security Audit

- **No user PII in Slack payload.** The `text` string contains only `dto.message`, `dto.app_version`, and `dto.os` — no user ID, email, or display name passes through `FeedbackService`. Service receives no user context by design.
- **Webhook URL not logged.** `this.logger.warn` and `this.logger.error` calls do not log the webhook URL. No credential leakage in logs.
- **Rate limiting wired but not enforced (pre-existing).** `@Throttle({ default: { ttl: 3600, limit: 5 } })` is set, but `ThrottlerGuard` is not registered as `APP_GUARD` in `app.module.ts`. This is a pre-existing defect from Story 1.9 (also affects the data export endpoint). The decorator is non-functional. Classified as deferred — not introduced by this story.
- **JWT guard active.** `FeedbackController` is covered by the global `JwtAuthGuard` via `APP_GUARD`. Valid bearer token required — spam prevention is present at the auth layer even while throttling is inoperative.

### verbatimModuleSyntax Compliance

- `feedback.service.ts:3` — `import type { SubmitFeedbackDto }` — correct; DTO used only as a type annotation in the method signature.
- `feedback.controller.ts:4` — `import { SubmitFeedbackDto }` — correct; DTO is referenced as a value by NestJS reflection metadata at runtime.
- `feedback.service.spec.ts:5` — `import type { SubmitFeedbackDto }` — correct; used only as a type annotation for `mockDto`.
- All three locale files: no type-only imports involved.

### FeedbackService — Graceful Failure Verification

The service never throws to the controller:
- Path 1 (no webhook URL): early `return` — no throw.
- Path 2 (fetch ok): returns without throw.
- Path 3 (fetch non-ok): `this.logger.error(...)` inside `try` block — no throw.
- Path 4 (fetch throws): `catch (err)` block logs and swallows — no throw.

Controller `await this.feedbackService.submitFeedback(dto)` will not propagate exceptions under any of these four paths. The 202 always returns. Correct per AC 3/AC 6 intent.

### Test Coverage

**`feedback.service.spec.ts`** — 6 tests covering:
- Correct Slack payload (URL, method, Content-Type, body text) — Pass
- No user identity fields in webhook body — Pass
- No-URL path: logs warn, no fetch call, no throw — Pass (split across two tests)
- Non-ok fetch response: logs error, no throw — Pass
- Network error (fetch throws): logs error, no throw — Pass

All 4 failure modes from the review checklist are covered.

**`feedback.controller.spec.ts`** — 5 tests covering:
- Happy path: service called with DTO, returns `{ message: 'Feedback received' }` — Pass
- Error propagation test (documents behavior if service contract breaks) — Pass
- ValidationPipe: message > 1000 chars rejected — Pass
- ValidationPipe: empty message rejected — Pass
- ValidationPipe: valid DTO accepted — Pass

The ValidationPipe tests correctly instantiate the pipe directly — consistent with project pattern from `user.controller.spec.ts`.

### i18n Completeness

All 6 `feedback.*` keys defined in en/pl/uk. `account.sendFeedback` defined in all three locale files inside the existing `account` object. `as const` preserved in all three files. Key structure is identical across locales. All keys consumed by components (`feedback.tsx` uses `feedback.*`; `account.tsx` uses `account.sendFeedback`). No unused keys.

---

### Findings

#### Patch Findings (3)

**P1 — DTO: `app_version` and `os` have no `@MinLength(1)`**
- Location: `apps/api/src/feedback/dto/submit-feedback.dto.ts:9-15`
- Detail: `app_version` and `os` fields have `@MaxLength(100)` but no `@MinLength`. An API client (or future regression) could send `app_version: ""` and `os: ""`, producing a Slack message reading `App:  | OS: `. The mobile client always sends non-empty values for these, but the DTO doesn't enforce it. Fix: add `@MinLength(1)` to both fields alongside the existing `@MaxLength`.

**P2 — No fetch timeout on Slack webhook call**
- Location: `apps/api/src/feedback/feedback.service.ts:21-25`
- Detail: The `fetch()` call to the Slack webhook has no `AbortController` timeout. If the Slack endpoint becomes unresponsive, the Node.js request will wait for the default socket timeout (potentially several minutes), tying up an event loop turn. While the effect is limited (fire-and-forget from the controller's perspective, since the controller already returned 202), this is a hygiene issue for a production service. Fix: wrap the fetch with an `AbortController` and `setTimeout` (e.g., 5000 ms), calling `controller.abort()` in the timeout.

**P3 — Guest user can type feedback and tap Send with no feedback (silent no-op)**
- Location: `apps/mobile/app/(app)/feedback.tsx:20-21, 68-71`
- Detail: The submit button is disabled only when `isSubmitting || !message.trim()`. When `!accessToken` (guest mode), a user who types a message sees the button as active, taps it, and `handleSubmit` returns early (`if (!accessToken || !message.trim()) return`) with no visible response — no error message, no indication that sign-in is required. This violates basic UX contract (interactive button that does nothing). Fix: either (a) add `!accessToken` to the `disabled` prop: `disabled={isSubmitting || !message.trim() || !accessToken}`, or (b) show an inline error/prompt when `!accessToken && !isSubmitting`.

---

#### Deferred Findings (2)

**D1 — `ThrottlerGuard` not registered as `APP_GUARD` — rate limiting non-functional**
- Pre-existing since Story 1.9 (affects both `POST /v1/me/export` and `POST /v1/feedback`). The `@Throttle()` decorator on `FeedbackController.submitFeedback` is decorative only. No action for this story.

**D2 — Whitespace-only message passes DTO validation**
- `@MinLength(1)` on `message` is satisfied by a single space character. Direct API clients (not the mobile app) could submit `message: " "`. The mobile client guards this with `.trim()`, so end-to-end the app behaves correctly. Low-severity API hygiene issue; not worth a follow-up patch.

---

### Summary

**3 patch, 0 intent_gap, 0 bad_spec, 2 deferred. 5 findings rejected as noise.**

P1 and P2 are low-severity but straightforward to address. P3 is the most user-facing: a guest driver can reach the feedback screen, type a message, tap Send, and see nothing happen. Recommend applying all three patches before shipping.

All acceptance criteria pass. Security properties (no PII, no credential leak, JWT gated) are correct. `verbatimModuleSyntax` compliance is correct. All 4 service failure modes are tested.

---

## Change Log

| Date | Change |
|------|--------|
| 2026-03-24 | Story implemented — all 6 phases complete, 106/106 tests passing |
| 2026-03-24 | Senior developer review completed — 3 patch, 2 deferred, 5 rejected |
| 2026-03-24 | Review patches applied — P1-P3 all applied, 106/106 tests passing, tsc clean |
