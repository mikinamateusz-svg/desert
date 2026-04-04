# Story 1.9: Personal Data Export

Status: done

## Story

As a **driver**,
I want to download a copy of all my personal data held by the platform,
so that I can exercise my GDPR right to data portability.

## Why

GDPR Article 20 (right to data portability) is a legal requirement for EU-facing products. Implementing at launch avoids costly retrofitting and demonstrates good faith to regulators. It also builds user trust — drivers contributing data feel safer knowing they can take it with them.

## Acceptance Criteria

1. **Given** an authenticated driver navigates to account settings,
   **When** they tap "Download my data",
   **Then** they see an in-app confirmation that their export is being prepared and will be sent to their registered email address.

2. **Given** the export is prepared by the API,
   **When** it is ready (synchronous — generated in the same request),
   **Then** the driver receives an email containing a time-limited download link (valid 24 hours) to a JSON file containing all their personal data: account details, submission history, and notification preferences.

3. **Given** a driver clicks the download link in the email,
   **When** they open the downloaded file,
   **Then** it contains only their own data — no other user's data is included — structured as a single JSON document with `account`, `submissions`, and `notification_preferences` keys.

4. **Given** a driver requests an export after account deletion is initiated,
   **When** the request is processed,
   **Then** the export reflects the data at the time of request — the system does not block export during the deletion flow (if email is already nulled the export request cannot proceed — endpoint returns 400).

5. **Given** the export download link,
   **When** more than 24 hours have passed since generation,
   **Then** the link is expired — the R2 presigned URL TTL enforces this automatically (no database tracking required).

6. **Given** a driver requests a data export,
   **When** their selected language is Polish, English, or Ukrainian,
   **Then** all in-app confirmation messages are displayed in that language (email content is English-only for MVP).

## Tasks / Subtasks

### Phase 1 — API: Export endpoint on UserModule

- [x] **1.1** Add `exportMyData(userId: string): Promise<string>` method to `apps/api/src/user/user.service.ts`:
  - Query Prisma for the full `User` record for `userId` (select all non-null fields; skip fields that are null due to deletion)
  - Query all `Submission` records for `userId` via `prisma.submission.findMany({ where: { user_id: userId }, orderBy: { created_at: 'desc' } })`
  - Query `NotificationPreference` record for `userId` via `prisma.notificationPreference.findFirst({ where: { user_id: userId } })`
  - Build a `DataExportPayload` object (see structure below)
  - Serialize to JSON: `Buffer.from(JSON.stringify(payload, null, 2))`
  - Upload the buffer to R2 using `StorageService.uploadBuffer(key, buffer, 'application/json')`
  - Generate a presigned GET URL from R2 with 24-hour TTL using `StorageService.getPresignedUrl(key, 3600 * 24)`
  - Return the presigned URL string (not stored anywhere — ephemeral)

  **DataExportPayload structure:**
  ```ts
  type DataExportPayload = {
    exported_at: string; // ISO 8601
    account: {
      id: string;
      email: string | null;
      display_name: string | null;
      role: string;
      trust_score: number;
      created_at: string;
    };
    submissions: Array<{
      id: string;
      station_id: string | null;
      price_data: unknown;
      status: string;
      created_at: string;
    }>;
    notification_preferences: {
      price_drops: boolean;
      sharp_rise: boolean;
      monthly_summary: boolean;
    } | null;
  };
  ```

  **Key name format:** `exports/${userId}/${Date.now()}.json`
  - This ensures uniqueness per request and per user
  - Obfuscated from public guessing — the presigned URL is the only access mechanism

- [x] **1.2** Extend `apps/api/src/storage/storage.service.ts` with two new methods:

  ```ts
  async uploadBuffer(key: string, buffer: Buffer, contentType: string): Promise<void>
  ```
  - Use `PutObjectCommand` from `@aws-sdk/client-s3` (already installed: `"@aws-sdk/client-s3": "^3.1014.0"`)
  - `Body: buffer`, `Bucket: this.bucket`, `Key: key`, `ContentType: contentType`
  - No access control needed — presigned URL controls access

  ```ts
  async getPresignedUrl(key: string, expiresInSeconds: number): Promise<string>
  ```
  - Import `getSignedUrl` from `@aws-sdk/s3-request-presigner` — **must add this package to `apps/api/package.json`**
  - Import `GetObjectCommand` from `@aws-sdk/client-s3`
  - Return `getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: expiresInSeconds })`

  **Install dependency:**
  ```
  pnpm --filter api add @aws-sdk/s3-request-presigner
  ```

- [x] **1.3** Add `POST /v1/me/export` endpoint to `apps/api/src/user/user.controller.ts`:
  - Decorated with `@Post('export')` and `@HttpCode(202)`
  - Protected by global `JwtAuthGuard` + `RolesGuard` (no `@Roles()` needed — any authenticated user)
  - Extract `userId` via `@CurrentUser('id')`
  - Extract `email` via `@CurrentUser('email')` — if `email` is null (deleted account), throw `BadRequestException('Account has been deleted — export not available')`
  - Call `userService.exportMyData(userId)` to get the presigned URL
  - Send email with the presigned URL via `UserService.sendExportEmail(email, presignedUrl)` (see task 1.4)
  - Return `{ message: 'Export prepared. Check your email.' }` with 202

  **Do NOT inject MailService/email library into controller** — all side-effects go through `UserService`.

- [x] **1.4** Add `sendExportEmail(email: string, downloadUrl: string): Promise<void>` to `UserService`:
  - Use **Resend** for email sending (already chosen in architecture for transactional emails)
  - Install: `pnpm --filter api add resend`
  - Inject `ConfigService` into `UserService` (add to constructor if not already there)
  - Read `RESEND_API_KEY` from env via `ConfigService`
  - Initialise `new Resend(apiKey)` inside the method (or lazily on first call)
  - Send email: from `noreply@desert.app`, to `email`, subject: `Your Desert data export`, HTML body with download link and 24-hour expiry notice
  - Wrap in try/catch — log error but do NOT rethrow (export file is already generated; email failure is non-fatal)
  - If `RESEND_API_KEY` is missing in env, log warning and skip silently (supports dev/test environments without email)

  **Note:** `StorageModule` must be imported by `UserModule` to inject `StorageService`.

- [x] **1.5** Update `apps/api/src/user/user.module.ts`:
  - Add `StorageModule` to `imports` array (to access `StorageService`)
  - Add `ConfigModule` is already global — no import needed
  - Inject `StorageService` and `ConfigService` into `UserService` via constructor

- [x] **1.6** Update `apps/api/src/app.module.ts`: No changes needed — `UserModule` and `StorageModule` are already registered.

### Phase 2 — API: Unit Tests

- [x] **2.1** Extend `apps/api/src/user/user.service.spec.ts` with tests for `exportMyData`:
  - Mock `PrismaService.user.findUnique`, `submission.findMany`, `notificationPreference.findFirst`
  - Mock `StorageService.uploadBuffer` (resolves void) and `StorageService.getPresignedUrl` (returns `'https://r2.example.com/exports/...'`)
  - Test: `exportMyData` — calls `prisma.user.findUnique` with correct userId
  - Test: `exportMyData` — calls `prisma.submission.findMany` with `{ where: { user_id: userId }, orderBy: { created_at: 'desc' } }`
  - Test: `exportMyData` — calls `storageService.uploadBuffer` with key matching `exports/${userId}/...`, buffer containing valid JSON, content-type `application/json`
  - Test: `exportMyData` — calls `storageService.getPresignedUrl` with the same key and `86400`
  - Test: `exportMyData` — returns the presigned URL string

- [x] **2.2** Extend `apps/api/src/user/user.service.spec.ts` with tests for `sendExportEmail`:
  - Mock `resend` module: `jest.mock('resend', ...)` with `emails.send` as jest.fn()
  - Test: `sendExportEmail` — calls `resend.emails.send` with correct from/to/subject fields
  - Test: `sendExportEmail` — does NOT throw when `resend.emails.send` fails (logs error only)
  - Test: `sendExportEmail` — skips silently when `RESEND_API_KEY` is not set

- [x] **2.3** Extend `apps/api/src/storage/storage.service.spec.ts` with tests for new methods:
  - Mock `@aws-sdk/client-s3` already exists in the file — extend it
  - Mock `@aws-sdk/s3-request-presigner`: `jest.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: jest.fn().mockResolvedValue('https://presigned.url') }))`
  - Test: `uploadBuffer` — calls `mockSend` with a `PutObjectCommand` with correct Bucket, Key, ContentType
  - Test: `getPresignedUrl` — calls `getSignedUrl` with the S3Client instance, a `GetObjectCommand`, and `{ expiresIn: 86400 }`
  - Test: `getPresignedUrl` — returns the presigned URL string

- [x] **2.4** Extend `apps/api/src/user/user.controller.spec.ts` with tests for `POST /v1/me/export`:
  - Mock `UserService` with `exportMyData: jest.fn()` and `sendExportEmail: jest.fn()`
  - Test: calls `userService.exportMyData(userId)` and returns `{ message: 'Export prepared. Check your email.' }`
  - Test: throws `BadRequestException` when `user.email` is null

### Phase 3 — Mobile: API Client

- [x] **3.1** Add export function to `apps/mobile/src/api/user.ts`:
  - Extend the existing `user.ts` file (do NOT create a separate file — follow existing pattern)
  - Add `export async function apiRequestDataExport(accessToken: string): Promise<{ message: string }>`
  - Make `POST /v1/me/export` with `Authorization: Bearer <token>`
  - Returns `{ message: string }` on 202
  - On non-2xx, throw `ApiError` (reuse existing class in the file)

### Phase 4 — Mobile: Export entry point in Account screen

- [x] **4.1** Add "Download my data" button to `apps/mobile/app/(app)/account.tsx`:
  - Add below the sign-out button and above the delete account button
  - Label: `t('account.exportDataButton')`
  - On tap: call `apiRequestDataExport(accessToken)`, show brief success toast/alert, handle error with inline message
  - Loading state: disable button while request is in-flight; show `ActivityIndicator` inside button
  - On success: `Alert.alert('', t('account.exportDataSuccess'))` — same pattern as delete-account success
  - On error: `Alert.alert('', t('account.exportDataError'))` — keep error handling consistent
  - Styled as standard button (not destructive) — same visual weight as sign-out row
  - **Do NOT use `router.push` to a new screen** — this is a single-tap action with in-place feedback

- [x] **4.2** Guard against guest mode: if `!accessToken`, show `Alert.alert('', t('account.exportDataSignInRequired'))` instead of making API call (defensive guard only — account screen is behind auth wall).

### Phase 5 — Mobile: i18n Keys

- [x] **5.1** Add to `apps/mobile/src/i18n/locales/en.ts` under the existing `account` key:
  ```ts
  account: {
    // ...existing keys preserved (signOut, deleteAccountButton, deleteAccount)...
    exportDataButton: 'Download my data',
    exportDataSuccess: 'Your data export has been prepared. Check your email for the download link.',
    exportDataError: 'Failed to prepare data export. Please try again.',
    exportDataSignInRequired: 'Sign in to export your data.',
  },
  ```

- [x] **5.2** Add to `apps/mobile/src/i18n/locales/pl.ts` under the existing `account` key:
  ```ts
  account: {
    // ...existing keys preserved...
    exportDataButton: 'Pobierz moje dane',
    exportDataSuccess: 'Eksport danych został przygotowany. Sprawdź swój e-mail, aby pobrać plik.',
    exportDataError: 'Nie udało się przygotować eksportu danych. Spróbuj ponownie.',
    exportDataSignInRequired: 'Zaloguj się, aby wyeksportować dane.',
  },
  ```

- [x] **5.3** Add to `apps/mobile/src/i18n/locales/uk.ts` under the existing `account` key:
  ```ts
  account: {
    // ...existing keys preserved...
    exportDataButton: 'Завантажити мої дані',
    exportDataSuccess: 'Експорт даних підготовлено. Перевірте свій email для отримання посилання.',
    exportDataError: 'Не вдалося підготувати експорт даних. Спробуйте ще раз.',
    exportDataSignInRequired: 'Увійдіть, щоб експортувати дані.',
  },
  ```

### Review Follow-ups (AI)

- [x] **F1** Add `@nestjs/throttler` rate limiting (max 3/hour) to `POST /v1/me/export`
- [x] **F2** Add `sendExportEmail` call assertion in controller spec success test
- [x] **F3** Add `exportMyData` error-path test for `uploadBuffer` rejection in service spec

## Dev Notes

### Architecture Decisions for This Story

**Synchronous generation, async delivery via email.** The export JSON is generated and uploaded to R2 in the same API request (no BullMQ job needed — file is small, < 1MB even for power users). The 202 response is returned after the file is ready but email sending is fire-and-forget (non-blocking). This keeps the implementation simple while meeting the GDPR requirement.

**R2 presigned URL for download — no new storage bucket.** The same R2 bucket used for photos is reused for exports. The `exports/` key prefix segregates export files from photo files (`photos/` prefix expected in future). Presigned URL TTL of 86,400 seconds (24 hours) enforces the AC#5 expiry requirement automatically — no database record or cleanup job needed.

**No email infrastructure from scratch.** Use **Resend** (the architecture's chosen transactional email provider). Add `resend` npm package. The `RESEND_API_KEY` env variable must be present in Railway/production env. In dev/test, the key can be absent — method silently skips (no email sent, but export URL is still returned in the API response for debugging).

**StorageService extension (not a new service).** Two new methods on the existing `StorageService` — `uploadBuffer` and `getPresignedUrl`. The S3Client instance is already initialised in `onModuleInit`. The `@aws-sdk/s3-request-presigner` package is a companion package to `@aws-sdk/client-s3` (already installed) and must be added explicitly.

**No DB migration needed.** This story adds no new schema — export files live in R2 only, ephemeral, no persistence in PostgreSQL.

**Email content is English-only for MVP.** The i18n AC covers in-app confirmation messages only. Email template is hardcoded English — internationalising email templates is a Phase 2 concern.

### Source Tree — Files to Touch

**API (new or modified):**
- `apps/api/src/user/user.service.ts` — extend with `exportMyData` + `sendExportEmail`
- `apps/api/src/user/user.controller.ts` — extend with `POST /v1/me/export`
- `apps/api/src/user/user.module.ts` — add `StorageModule` to imports
- `apps/api/src/storage/storage.service.ts` — add `uploadBuffer` + `getPresignedUrl`
- `apps/api/src/user/user.service.spec.ts` — extend test suite
- `apps/api/src/user/user.controller.spec.ts` — extend test suite
- `apps/api/src/storage/storage.service.spec.ts` — extend test suite

**Mobile (new or modified):**
- `apps/mobile/src/api/user.ts` — add `apiRequestDataExport`
- `apps/mobile/app/(app)/account.tsx` — add export button
- `apps/mobile/src/i18n/locales/en.ts` — add 4 keys under `account`
- `apps/mobile/src/i18n/locales/pl.ts` — add 4 keys under `account`
- `apps/mobile/src/i18n/locales/uk.ts` — add 4 keys under `account`

**No new files needed for this story** (except installing two npm packages).

### Critical Patterns to Follow

**NestJS module pattern (from existing user.module.ts):**
```ts
@Module({
  imports: [StorageModule],  // ADD THIS
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
```
StorageModule already exports StorageService — just add it to UserModule imports.

**Constructor injection in UserService (extend existing pattern):**
```ts
constructor(
  private readonly prisma: PrismaService,
  private readonly storage: StorageService,  // ADD
  private readonly config: ConfigService,    // ADD
) {}
```

**API controller base path is `v1/me` (existing)** — new export endpoint is `@Post('export')` → resolves to `POST /v1/me/export`. Do not change the controller base route.

**Mobile API client pattern (from existing user.ts):**
- Reuse the existing `ApiError` class and `request()` helper that are already defined in `apps/mobile/src/api/user.ts`
- Just add the new `apiRequestDataExport` function at the end of the file

**i18n key insertion:** Insert new `account` subkeys without removing existing keys (`signOut`, `deleteAccountButton`, `deleteAccount`). The `as const` assertion at the end of each locale file must be preserved.

**StorageService S3Client access:** The `client` field is private. New methods in the same class access it directly as `this.client` — no change to visibility needed.

**Test mock for @aws-sdk/s3-request-presigner:**
```ts
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://presigned.url/test'),
}));
```

### Previous Story Learnings (from Story 1.8)

- **P2 lesson:** All i18n keys defined in story spec must actually be used in the component — do not define keys that go unconsumed. The `successMessage` key in 1.8 was defined but not consumed until P2 patch. In 1.9, the `exportDataSuccess` key must be shown via `Alert.alert` immediately on API success.
- **P3 lesson:** Always guard against `!accessToken` before API calls. In 1.9, the account screen is behind auth wall so the guard is defensive — but still add it (see task 4.2).
- **P4 lesson:** No keyboard interaction on the export button (just a tap) — no `KeyboardAvoidingView` needed on this screen. But preserve the existing `KeyboardAvoidingView` on `delete-account.tsx` when reading that file.
- **Pattern for `null` supertokens_id:** Controller passes user object to service, guard handles auth. Same pattern applies here — controller passes `user.email` to guard check.

### Environment Variables Required

| Variable | Where used | Dev default |
|---|---|---|
| `RESEND_API_KEY` | `UserService.sendExportEmail` | Optional — skip email silently if absent |
| `R2_ACCOUNT_ID` | `StorageService` (existing) | From existing `.env` |
| `R2_BUCKET_NAME` | `StorageService` (existing) | From existing `.env` |
| `R2_ACCESS_KEY_ID` | `StorageService` (existing) | From existing `.env` |
| `R2_SECRET_ACCESS_KEY` | `StorageService` (existing) | From existing `.env` |

Add `RESEND_API_KEY` to Railway environment before deploying to production. Not needed for local dev/test — the method silently skips.

### Testing Standards

- Tests follow existing Jest + `@nestjs/testing` patterns (see `user.service.spec.ts`, `storage.service.spec.ts`)
- Mock `resend` at module level: `jest.mock('resend', () => ({ Resend: jest.fn().mockImplementation(() => ({ emails: { send: jest.fn() } })) }))`
- All new methods get positive path + error path tests
- Run tests: `pnpm --filter api test`

### Anti-Patterns to Avoid

- **Do not create a new NestJS module** (e.g., `ExportModule`) — add to existing `UserModule`
- **Do not persist the presigned URL to the database** — R2 TTL handles expiry
- **Do not use BullMQ** for this — synchronous generation is fine for small payloads
- **Do not create a new download screen in the mobile app** — single-tap action on account screen
- **Do not modify `StorageModule` imports in `app.module.ts`** — it is already registered globally
- **Do not import `StorageModule` in `AppModule` again** — import it only in `UserModule`

### Project Structure Notes

Alignment with monorepo structure:
- API code: `apps/api/src/` — NestJS modules, services, controllers
- Mobile API client: `apps/mobile/src/api/` — plain TypeScript fetch wrappers
- Shared DB client: `packages/db/prisma/` — Prisma schema and client (no changes this story)
- Migration timestamp convention: `YYYYMMDDHHMMSS_description` — no migration needed this story

### References

- Epics file: Story 1.9 definition — `_bmad-output/planning-artifacts/epics.md#Story-1.9`
- Architecture: R2 storage, StorageService — `_bmad-output/planning-artifacts/architecture.md#Photo-Storage`
- Architecture: API surface, UserModule — `_bmad-output/planning-artifacts/architecture.md#Decision-1`
- Story 1.8 (account deletion): `_bmad-output/implementation-artifacts/1-8-account-deletion-right-to-erasure.md` — UserService/UserController patterns
- Story 1.7 (notifications): `_bmad-output/implementation-artifacts/1-7-notification-preferences.md` — StorageService/module patterns
- Existing `StorageService`: `apps/api/src/storage/storage.service.ts` — S3Client init, HeadBucketCommand pattern
- Existing `UserService`: `apps/api/src/user/user.service.ts` — constructor injection, Logger pattern
- Existing `user.ts` mobile API client: `apps/mobile/src/api/user.ts` — ApiError + request() pattern to reuse
- i18n locale files: `apps/mobile/src/i18n/locales/{en,pl,uk}.ts` — existing `account` namespace to extend

## Senior Developer Review (AI)

**Review date:** 2026-03-23
**Reviewer:** claude-sonnet-4-6 (bmad-code-review workflow)
**Review mode:** full (diff HEAD~1 + story spec)
**Diff stats:** 21 files changed, 2179 insertions(+), 5 deletions(−)

---

### Layer 1 — Blind Hunter (adversarial, no project context)

Findings from diff-only adversarial analysis:

- **BH-1:** `sendExportEmail` uses a dynamic `import('resend')` inside an async function. The top-level `jest.mock('resend', ...)` in the test file hoists correctly for static imports but its interaction with dynamic `import()` depends on Jest's module registry. While `require('resend')` inside individual tests re-acquires the mocked module, the `await import('resend')` in production code goes through the ESM/CJS bridge. This pattern is fragile: if Jest runs in ESM mode (`--experimental-vm-modules`), the module-level `jest.mock` does NOT intercept dynamic `import()` calls — only `jest.unstable_mockModule` would. The spec tests reference the mock via `require('resend')` (synchronous), which works in CJS mode, but the production code path uses `await import(...)` (async). If the test runner is ever migrated to native ESM, these tests will silently pass even though the mock does not apply to the actual code path being exercised.
- **BH-2:** The presigned URL is passed as an unsanitised string into an HTML template: `` `<a href="${downloadUrl}">` ``. While the URL originates from Cloudflare R2's `getSignedUrl` (not user input), any misconfiguration of bucket/key that produces a URL containing `"` or `>` characters could break the HTML. Low severity since R2 presigned URLs are safe in practice, but the absence of any HTML escaping is technically a pattern deviation.
- **BH-3:** `exportMyData` calls `prisma.user.findUnique` and then immediately uses optional-chaining (`user?.id ?? userId`) — meaning if `findUnique` returns `null` (user was hard-deleted from DB), the method does not throw; it silently exports an essentially empty account object with all fields defaulted. This creates a data-correctness issue: a caller that has already passed the `!user.email` guard in the controller believes the user exists, but a concurrent hard-delete between the guard check and the DB query could produce a stub export file uploaded to R2. This is a race condition of negligible practical probability, but produces a misleading export artifact.
- **BH-4:** The R2 key format `exports/${userId}/${Date.now()}.json` uses millisecond timestamp. Two simultaneous export requests for the same user within the same millisecond (extremely unlikely but theoretically possible) would produce the same key. Given the synchronous request handling, this is a near-zero risk but `Date.now()` is not cryptographically unique.

### Layer 2 — Edge Case Hunter (diff + project access)

- **EH-1 (Security — no rate limiting on export endpoint):** The `POST /v1/me/export` endpoint has no throttle/rate-limit decorator. There is no `ThrottlerModule` registered anywhere in `app.module.ts` or `user.module.ts`. Every invocation generates and uploads a new JSON file to R2 (unbounded storage accumulation) and sends a Resend email (real cost). An authenticated user could loop-call this endpoint to exhaust Resend sending quota and fill R2 with export files. Since old exports are never cleaned up (no expiry job, no overwrite — the key is unique per request by design), this is a storage leak risk in addition to a cost amplification risk. The spec explicitly states "no database tracking required" (AC#5) and "no cleanup job needed", which is correct for the happy path, but the combination of unlimited unique keys + no rate limit creates an unbounded accumulation vector. This is the most significant operational gap in this story.
- **EH-2 (Correctness — `exportMyData` called even when `uploadBuffer` throws):** `exportMyData` does not wrap the storage upload in a try/catch. If `uploadBuffer` throws (R2 unavailable, credentials expired), the exception propagates up through the controller, which returns a 500 to the client. However, `sendExportEmail` is called fire-and-forget (`void`) AFTER `exportMyData` resolves — so if `exportMyData` throws, `sendExportEmail` is never called. This is actually correct behaviour (no email sent if upload fails). The concern is that the error is not logged at service level before propagating — the controller has no error handling for `exportMyData` failure. The user receives an opaque 500 with no contextual message. This is acceptable per the spec (spec doesn't require a specific 500 message) but an observability gap.
- **EH-3 (Data completeness — missing Submission fields in export):** The `DataExportPayload` submissions array includes `id`, `station_id`, `price_data`, `status`, `created_at`. The Prisma `Submission` schema also has `photo_r2_key` and `ocr_confidence_score`. These are not personal data per GDPR (they are operational metadata), but `photo_r2_key` is a key that links to a photo potentially containing the driver's face or their vehicle — an argument can be made it is personal data under GDPR (indirect identifier). Under a strict GDPR Article 20 interpretation, omitting `photo_r2_key` from the export could be challenged. `ocr_confidence_score` is clearly non-personal. This is a borderline GDPR completeness question, not an outright bug.
- **EH-4 (Data completeness — missing User fields in export):** The `account` export object omits `fleet_id`, `shadow_banned`, `deletion_reason`, `updated_at`. `fleet_id` could be personal data (identifies fleet membership). `shadow_banned` and `deletion_reason` are account status fields that a user is entitled to know about under GDPR right of access (Article 15), and by extension portability (Article 20). The spec's `DataExportPayload` type definition explicitly omits these fields — this is a spec-level decision, not an implementation deviation. However it could be a regulatory gap.
- **EH-5 (Data completeness — missing NotificationPreference fields):** `expo_push_token` is stored in `NotificationPreference` but omitted from the export. A push token is a device identifier and constitutes personal data. The export includes only the three boolean preference flags. This is a spec omission.
- **EH-6 (Mobile — `accessToken` null guard correct but redundant):** `account.tsx` correctly guards `!accessToken` before calling the API (task 4.2). The `JwtAuthGuard` would catch a missing/null token at the server anyway, returning 401. The guard in the mobile component is defensive and correct. The `accessToken` type from `auth.store.ts` is `string | null`, so the guard is necessary to satisfy TypeScript.
- **EH-7 (Tests — controller spec does not assert `sendExportEmail` was called):** The success test for `requestDataExport` mocks `sendExportEmail` and sets up the mock return value, but never calls `expect(mockUserService.sendExportEmail).toHaveBeenCalledWith(...)`. The fire-and-forget invocation (`void this.userService.sendExportEmail(...)`) is therefore not verified. If the controller were changed to stop calling `sendExportEmail` entirely, the test would still pass.
- **EH-8 (Tests — no `exportMyData` error path test in service spec):** There is no test for `exportMyData` when `storageService.uploadBuffer` rejects (e.g., R2 unavailable). The test suite only covers the happy path. Per the story's stated "all new methods get positive path + error path tests" standard, this is a coverage gap.
- **EH-9 (Tests — resend dynamic import vs jest.mock interaction):** See BH-1. In the test file, `jest.mock('resend', ...)` is declared at the top level, but the production code uses `await import('resend')` (dynamic import). Jest in CJS mode hoists `jest.mock` and intercepts both `require()` and `import()` transparently. However, the individual test cases re-acquire the mock via `require('resend')` synchronously and call `Resend.mockImplementationOnce(...)` on it. This works because `mockImplementationOnce` updates the factory on the same mock object that `await import('resend')` will also resolve to (in CJS/Jest transform mode). The pattern is functional under current configuration but is fragile if the build target ever changes.

### Layer 3 — Acceptance Auditor (diff + spec)

Checking all ACs and task requirements:

- **AC1 (in-app confirmation):** The mobile component calls `Alert.alert('', t('account.exportDataSuccess'))` on success. PASS.
- **AC2 (export prepared synchronously, email with time-limited link):** `exportMyData` is awaited synchronously before the 202 response is returned. `sendExportEmail` is fire-and-forget. Email includes the presigned URL. PASS.
- **AC3 (only user's own data, correct structure):** The export queries by `userId` throughout. Output has `account`, `submissions`, `notification_preferences` keys. PASS.
- **AC4 (400 on deleted account):** Controller checks `!user.email` and throws `BadRequestException`. `JwtAuthGuard` independently rejects deleted users (checks `user.deleted_at`). PASS. Note: The `JwtAuthGuard` already rejects requests from accounts with `deleted_at` set (line: `if (user.deleted_at) { throw new UnauthorizedException(); }`), so in practice the `!user.email` check in the controller is a belt-and-suspenders guard. The spec requires the 400, and the controller provides it — PASS. However, the 400 is actually unreachable in the current guard configuration (JwtAuthGuard returns 401 before the controller is reached for deleted accounts). This is a minor spec/implementation nuance, not a failure — the AC says "if email is already nulled the export request cannot proceed — endpoint returns 400", and the 400 code is present.
- **AC5 (24-hour link expiry via R2 TTL):** `getPresignedUrl` called with `86400` seconds. PASS.
- **AC6 (i18n in PL, EN, UK):** All four `exportData*` keys are present in all three locale files. All keys are consumed in `account.tsx`. PASS.
- **Task 1.1 (exportMyData method):** Implemented. Queries user, submissions, notificationPreference. Builds payload. Uploads to R2. Returns presigned URL. Key format `exports/${userId}/${Date.now()}.json`. PASS.
- **Task 1.2 (StorageService.uploadBuffer + getPresignedUrl):** Both methods implemented correctly. `@aws-sdk/s3-request-presigner` added. PASS.
- **Task 1.3 (POST /v1/me/export):** `@Post('export')`, `@HttpCode(202)`, null email check, fire-and-forget email. PASS.
- **Task 1.4 (sendExportEmail):** Resend used with dynamic import. RESEND_API_KEY checked. try/catch wraps send, error logged but not re-thrown. PASS.
- **Task 1.5 (user.module.ts):** `StorageModule` added to imports. PASS.
- **Task 2.1–2.4 (unit tests):** All specified test scenarios are present. Storage mock pattern correct. Resend mock at module level. PASS with one gap: controller test does not assert `sendExportEmail` was called (EH-7), and `exportMyData` has no error path test (EH-8).
- **Task 3.1 (apiRequestDataExport mobile function):** Correct endpoint, method, auth header, return type. PASS.
- **Task 4.1 (account.tsx export button):** Button placed between sign-out and delete-account. Correct label, loading state with `ActivityIndicator`, success/error alerts with correct i18n keys. PASS.
- **Task 4.2 (guest mode guard):** `!accessToken` guard present. PASS.
- **Tasks 5.1–5.3 (i18n):** All 4 keys added to all 3 locales. Existing keys preserved. `as const` assertions preserved. PASS.

---

### Triage — Unified Finding List

| ID | Source | Title | Classification |
|---|---|---|---|
| F1 | EH-1 | No rate limiting on `/v1/me/export` — unbounded R2 accumulation + Resend cost | **patch** |
| F2 | EH-7 | Controller test does not assert `sendExportEmail` was called (fire-and-forget not verified) | **patch** |
| F3 | EH-8 | No `exportMyData` error path test for upload failure | **patch** |
| F4 | EH-3+EH-5 | `photo_r2_key` and `expo_push_token` omitted from export (potential GDPR personal data) | **intent_gap** |
| F5 | EH-4 | `fleet_id`, `shadow_banned`, `deletion_reason` omitted from account export | **intent_gap** |
| F6 | BH-1+EH-9 | `jest.mock('resend')` + `await import('resend')` interaction fragile under ESM | **defer** |
| F7 | BH-3 | Race condition: `findUnique` null between email guard and export produces stub export | **defer** |
| F8 | BH-4 | `Date.now()` key not cryptographically unique (same-millisecond collision) | **reject** |
| F9 | AC4 note | `!user.email` 400 guard is unreachable because `JwtAuthGuard` already rejects deleted users with 401 | **defer** |
| F10 | BH-2 | Presigned URL in HTML template without escaping | **reject** |

**Rejected:** F8 (Date.now collision probability negligible — two requests in same millisecond for same user, unique key still has userId prefix), F10 (R2 presigned URLs never contain HTML-breaking characters by spec). 2 findings rejected.

---

### Review Summary

**2** intent_gap, **0** bad_spec, **3** patch, **3** defer, **2** rejected.

---

### Findings Detail

#### Intent Gaps (spec is incomplete — clarify before proceeding)

**F4 — `photo_r2_key` and `expo_push_token` omitted from GDPR export**
- `photo_r2_key` on `Submission` is a key that references a photo that may contain personal data (the driver's vehicle or face). Under GDPR Article 4(1), an indirect identifier is personal data. Including `photo_r2_key` in the export (as a reference, not the actual photo) would allow the data subject to know what photos they've submitted.
- `expo_push_token` on `NotificationPreference` is a device-linked identifier and is personal data.
- Neither field is listed in the spec's `DataExportPayload` type definition — this is a spec omission, not an implementation error.
- **Suggested spec amendment:** Clarify whether `photo_r2_key` should be included in the submissions export array, and whether `expo_push_token` should be included in `notification_preferences`. At minimum, document the deliberate exclusion with a legal justification in the story's Dev Notes.

**F5 — `fleet_id`, `shadow_banned`, `deletion_reason` omitted from account export**
- Under GDPR Article 20 (portability) and Article 15 (right of access), a user is entitled to know the data held about them. `fleet_id` links a driver to a fleet (organizational relationship — arguably personal data). `shadow_banned` and `deletion_reason` reflect account status decisions that affect the user.
- Again a spec-level omission in the `DataExportPayload` type definition.
- **Suggested spec amendment:** Either add these fields to the account export object, or add a documented decision ("shadow_banned omitted as operational flag, not personal data per GDPR Article 20") to the Dev Notes.

#### Patch Findings (fixable code issues)

**F1 — No rate limiting on `POST /v1/me/export`**
- Location: `apps/api/src/user/user.controller.ts` line 16 (`@Post('export')`)
- Every call creates a new unique R2 key and a new export file that never gets deleted (no cleanup job, by design per spec). An authenticated user can spam this endpoint to: (a) accumulate unlimited files in R2 (`exports/${userId}/` prefix fills indefinitely), (b) exhaust Resend email sending quota.
- No `ThrottlerModule` is registered in the application at all — this is a gap across the whole API, but the export endpoint is the highest-cost endpoint to abuse (R2 write + Resend API call per request).
- Fix: Add `@nestjs/throttler` to the API, register `ThrottlerModule.forRoot` in `AppModule`, and apply `@Throttle({ default: { limit: 3, ttl: 3600 } })` (or similar) to `requestDataExport`. Alternatively, a lighter fix for this story alone is to use Upstash Redis (already in the stack) for a simple per-user rate check at the service level.

**F2 — Controller test does not assert `sendExportEmail` is called**
- Location: `apps/api/src/user/user.controller.spec.ts` lines 71–80
- The success test for `requestDataExport` mocks `sendExportEmail` but never asserts it was called. The fire-and-forget invocation (`void this.userService.sendExportEmail(user.email, presignedUrl)`) is entirely unverified. If the call were removed from the controller, the test would still pass.
- Fix: Add `expect(mockUserService.sendExportEmail).toHaveBeenCalledWith('driver@example.com', 'https://r2.example.com/exports/user-uuid/12345.json')` in the success test case.

**F3 — No error-path test for `exportMyData` when upload fails**
- Location: `apps/api/src/user/user.service.spec.ts` — `exportMyData` describe block
- The story spec states "all new methods get positive path + error path tests". The `exportMyData` method has only happy-path tests. There is no test for the case where `storageService.uploadBuffer` rejects (e.g., R2 unavailable) — confirming that the error propagates correctly as a 500 to the caller.
- Fix: Add a test case: `mockStorageService.uploadBuffer.mockRejectedValueOnce(new Error('R2 unavailable'))` → `expect(service.exportMyData(userId)).rejects.toThrow('R2 unavailable')`.

#### Deferred Findings (pre-existing or low-priority — not caused by this change)

**F6 — `jest.mock` + dynamic `import()` interaction is environment-sensitive**
- The production code uses `await import('resend')` (dynamic); the test uses top-level `jest.mock('resend', ...)` hoisting. In Jest's default CJS transform mode this works. If the project ever enables `--experimental-vm-modules` (native ESM), dynamic imports are NOT intercepted by `jest.mock` — `jest.unstable_mockModule` must be used instead. This is a future migration risk, not a current bug. File for attention if the monorepo moves to native ESM.

**F7 — Race condition: user deleted between controller email guard and `exportMyData` DB query**
- `exportMyData` calls `prisma.user.findUnique` and uses optional chaining when the result is null. A concurrent hard-delete (edge case: direct DB admin action, not normal app flow) between the controller's `!user.email` guard and the service query would produce a stub export. Risk is near-zero in practice. Not actionable without adding a guard check inside the service.

**F9 — The `!user.email` → 400 guard in controller is unreachable in practice**
- `JwtAuthGuard` already checks `user.deleted_at` and throws 401 before the controller is reached. When `deleted_at` is set, `email` will also be null (they are nulled together in `deleteAccount`). So the controller's `!user.email` branch can never be reached via normal request flow. The guard is still correct (spec-required), provides defence-in-depth, and is tested — but the test for it (`should throw BadRequestException when user.email is null`) bypasses the guard layer directly. No action needed; documented here for awareness.

---

### Overall Verdict

The implementation is **functionally complete** and meets all 6 acceptance criteria. The AC4 deleted-account 400, the i18n coverage, the fire-and-forget email pattern, the R2 presigned URL TTL, and all specified test scenarios are correctly implemented.

The 3 patch findings are all test/operational quality gaps, none of which affect correctness at runtime today. F1 (rate limiting) is the most operationally significant and should be addressed before production deployment given real cost exposure.

The 2 intent gaps (F4, F5) require a product/legal decision about GDPR scope — they are spec omissions that should be explicitly documented or addressed before App Store submission.

### Review Action Items

- [x] **F1** — Rate limiting applied: `ThrottlerModule.forRoot([{ ttl: 3600, limit: 3 }])` registered in `AppModule`; `@Throttle({ default: { ttl: 3600, limit: 3 } })` added to `POST /v1/me/export` in `user.controller.ts`; `@nestjs/throttler@^6.5.0` added to `apps/api/package.json`
- [x] **F2** — Controller spec success test now asserts `expect(mockUserService.sendExportEmail).toHaveBeenCalledWith('driver@example.com', 'https://r2.example.com/exports/user-uuid/12345.json')`
- [x] **F3** — Service spec `exportMyData` describe block now includes error-path test: `mockStorageService.uploadBuffer.mockRejectedValueOnce(new Error('R2 upload failed'))` → `await expect(service.exportMyData(userId)).rejects.toThrow('R2 upload failed')`

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

None — implementation completed without issues.

### Completion Notes List

- Installed `@aws-sdk/s3-request-presigner@^3.1015.0` and `resend@^6.9.4` in `apps/api/package.json`
- `sendExportEmail` uses dynamic `import('resend')` to enable effective Jest mocking at module level via `jest.mock('resend', ...)`
- `sendExportEmail` is called fire-and-forget in controller via `void this.userService.sendExportEmail(...)` — non-blocking, non-fatal
- The export button is placed between sign-out and delete-account, styled as a standard (non-destructive) button with `minWidth: 160` and `alignItems: 'center'` to accommodate `ActivityIndicator`
- `RESEND_API_KEY` must be added to Railway production environment before deploying — dev/test environments skip email silently

### Change Log

| Date | Change | Author |
|---|---|---|
| 2026-03-23 | Implemented all tasks (1.1–5.3); 80/80 tests passing | claude-sonnet-4-6 |
| 2026-03-23 | Applied review patches F1, F2, F3; 81/81 tests passing | claude-sonnet-4-6 |

### File List

**Modified:**
- `apps/api/src/storage/storage.service.ts` — added `uploadBuffer` + `getPresignedUrl` methods; added `PutObjectCommand`, `GetObjectCommand`, `getSignedUrl` imports
- `apps/api/src/storage/storage.service.spec.ts` — added tests for `uploadBuffer` and `getPresignedUrl`; added mocks for `PutObjectCommand`, `GetObjectCommand`, `@aws-sdk/s3-request-presigner`
- `apps/api/src/user/user.service.ts` — added `exportMyData` + `sendExportEmail` methods; added `StorageService` + `ConfigService` constructor injection; added `DataExportPayload` type
- `apps/api/src/user/user.service.spec.ts` — added tests for `exportMyData` + `sendExportEmail`; added mocks for `StorageService`, `ConfigService`, `resend`; **[F3 patch]** added error-path test for `uploadBuffer` rejection
- `apps/api/src/user/user.controller.ts` — added `POST /v1/me/export` endpoint (`requestDataExport` method); **[F1 patch]** added `@Throttle({ default: { ttl: 3600, limit: 3 } })` decorator
- `apps/api/src/user/user.controller.spec.ts` — added tests for `requestDataExport` (success + null-email 400); **[F2 patch]** added `sendExportEmail` call assertion in success test
- `apps/api/src/user/user.module.ts` — added `StorageModule` to `imports`
- `apps/api/src/app.module.ts` — **[F1 patch]** added `ThrottlerModule.forRoot([{ ttl: 3600, limit: 3 }])` to imports
- `apps/api/package.json` — added `@aws-sdk/s3-request-presigner` + `resend` dependencies; **[F1 patch]** added `@nestjs/throttler@^6.5.0`
- `apps/mobile/src/api/user.ts` — added `apiRequestDataExport` function
- `apps/mobile/app/(app)/account.tsx` — added "Download my data" button with loading state and error/success alerts
- `apps/mobile/src/i18n/locales/en.ts` — added 4 `account.exportData*` keys
- `apps/mobile/src/i18n/locales/pl.ts` — added 4 `account.exportData*` keys
- `apps/mobile/src/i18n/locales/uk.ts` — added 4 `account.exportData*` keys

## Review Notes (2026-04-04)

No new patches. Prior review (2026-03-23) applied F1–F3 patches (rate limit, controller test, error-path test). `@Roles()` missing on `POST /v1/me/export` patched as part of Story 1.8 re-review (user.controller.ts covers all /v1/me/* endpoints).

**D1 (carried from prior review):** `photo_r2_key` and `expo_push_token` excluded from export — arguable GDPR gap. Accepted for MVP; revisit before App Store submission.

**D2 (carried):** `shadow_rejected` status exposed in GDPR export — correct transparency (user has right to know their actual data), but reveals shadow ban system. Intentional design decision.
