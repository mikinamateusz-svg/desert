# Story 1.1: Driver Email/Password Registration & Login

Status: review

## Story

As a driver,
I want to create an account with my email and password and sign back in,
so that I can access the app and my contributions are tracked to my identity.

## Acceptance Criteria

1. **Given** a new user opens the app for the first time
   **When** they complete the registration form (email, password, display name)
   **Then** a new `User` record is created with `role: DRIVER` and a linked SuperTokens session
   **And** they are signed in and land on the map screen

2. **Given** a registered driver opens the app
   **When** they enter their email and password
   **Then** they receive a valid JWT session and are navigated to the map screen

3. **Given** a driver attempts to register with an email already in use
   **When** they submit the registration form
   **Then** they see a clear error message indicating the email is already registered

4. **Given** a driver enters an incorrect password on login
   **When** they submit the form
   **Then** they see an error message and the session is not created

5. **Given** a registered driver
   **When** they sign out
   **Then** their session token is invalidated and they are returned to the sign-in screen

6. **Given** a user views the registration or sign-in screen
   **When** their device language is set to Polish, English, or Ukrainian
   **Then** all text on the screen is displayed in that language

## Tasks / Subtasks

### Phase 1 — SuperTokens Setup (prerequisite, human step)
- [x] **HUMAN TASK**: Create SuperTokens managed account
  - Go to https://supertokens.com → sign up → create app
  - Select "EmailPassword" recipe, "Production" environment
  - Note your **Connection URI** (e.g. `https://abc.aws.supertokens.io:3568`) and **API Key**
  - Add to Railway Variables: `SUPERTOKENS_CONNECTION_URI`, `SUPERTOKENS_API_KEY`
  - Add to `apps/api/.env` and `apps/api/.env.example`

### Phase 2 — Database: Prisma User model (AC: 1)
- [x] Task 1: Expand Prisma User model and add UserRole enum (AC: 1)
  - [x] Replace placeholder User model in `packages/db/prisma/schema.prisma` with full model (see Dev Notes)
  - [x] Run `pnpm --filter @desert/db exec prisma migrate dev --name add-user-auth-fields` to create migration
  - [x] Verify `packages/db/src/index.ts` exports `PrismaClient` and re-exports Prisma enums including `UserRole`

### Phase 3 — API: SuperTokens initialization (AC: 1,2,5)
- [x] Task 2: Install and initialize supertokens-node in NestJS (AC: 1,2,5)
  - [x] Install: `pnpm --filter @desert/api add supertokens-node`
  - [x] Create `apps/api/src/auth/supertokens.ts` — `initSuperTokens()` function (see Dev Notes)
  - [x] Create `apps/api/src/auth/auth.module.ts` — calls `initSuperTokens()` in constructor
  - [x] Add `AuthModule` to `AppModule` imports in `apps/api/src/app.module.ts`

### Phase 4 — API: Auth endpoints (AC: 1,2,3,4,5)
- [x] Task 3: Create AuthController with register/login/logout/me endpoints (AC: 1,2,3,4,5)
  - [x] Create `apps/api/src/auth/auth.service.ts` (see Dev Notes for full interface)
  - [x] Create `apps/api/src/auth/auth.controller.ts` with 4 routes (see Dev Notes)
  - [x] Export `AuthService` from `AuthModule`
  - [x] Add `AuthController` to `AuthModule`

### Phase 5 — API: JWT guard for protected routes (AC: 1,2)
- [x] Task 4: Create JwtAuthGuard using SuperTokens session verification (AC: 1,2)
  - [x] Create `apps/api/src/auth/jwt-auth.guard.ts` — implements `CanActivate`, calls `Session.getSessionWithoutRequestResponse`
  - [x] Create `apps/api/src/auth/current-user.decorator.ts` — `@CurrentUser()` parameter decorator
  - [x] Apply `@UseGuards(JwtAuthGuard)` to `GET /v1/auth/me` endpoint

### Phase 6 — API: Tests (AC: 1,2,3,4,5)
- [x] Task 5: Write unit tests for AuthService (AC: 1,2,3,4,5)
  - [x] Create `apps/api/src/auth/auth.service.spec.ts` — mock `supertokens-node` and `PrismaClient`
  - [x] Test: register creates User in DB and returns access token
  - [x] Test: register with duplicate email throws 409
  - [x] Test: login with correct credentials returns access token
  - [x] Test: login with wrong password throws 401
  - [x] Test: logout revokes session

### Phase 7 — Mobile: dependencies and auth infrastructure (AC: 1,2,5,6)
- [x] Task 6: Install mobile auth dependencies (AC: 1,2,5,6)
  - [x] Install: `pnpm --filter @desert/mobile add expo-secure-store`
  - [x] Install: `pnpm --filter @desert/mobile add i18next react-i18next`
  - [x] Install: `pnpm --filter @desert/mobile add expo-localization`

- [x] Task 7: Create auth client and token storage (AC: 1,2,5)
  - [x] Create `apps/mobile/src/api/auth.ts` — typed API client wrapping `fetch` calls to `/v1/auth/*`
  - [x] Create `apps/mobile/src/store/auth.store.ts` — auth state with `user`, `accessToken`, `login`, `logout`, `register` (use React Context or Zustand)
  - [x] Create `apps/mobile/src/lib/secure-storage.ts` — thin wrapper around `expo-secure-store` for token persistence

### Phase 8 — Mobile: i18n foundation (AC: 6)
- [x] Task 8: Set up i18n for PL/EN/UK (AC: 6)
  - [x] Create `apps/mobile/src/i18n/index.ts` — configure i18next with expo-localization detector
  - [x] Create `apps/mobile/src/i18n/locales/en.ts` with auth strings (see Dev Notes for keys)
  - [x] Create `apps/mobile/src/i18n/locales/pl.ts` with Polish translations
  - [x] Create `apps/mobile/src/i18n/locales/uk.ts` with Ukrainian translations

### Phase 9 — Mobile: screens and navigation (AC: 1,2,3,4,5,6)
- [x] Task 9: Create auth screens (AC: 1,2,3,4,5,6)
  - [x] Create `apps/mobile/app/(auth)/register.tsx` — registration form (email, password, display name)
  - [x] Create `apps/mobile/app/(auth)/login.tsx` — login form (email, password)
  - [x] Create `apps/mobile/app/(auth)/_layout.tsx` — auth stack layout
  - [x] Create `apps/mobile/app/(app)/_layout.tsx` — protected app layout (redirects to login if no token)
  - [x] Update `apps/mobile/app/index.tsx` — redirect to `(app)` if authenticated, else `(auth)/login`

### Phase 10 — .env.example update
- [x] Task 10: Update .env.example with SuperTokens vars (AC: 1)
  - [x] Add `SUPERTOKENS_CONNECTION_URI` and `SUPERTOKENS_API_KEY` to `apps/api/.env.example`

## Dev Notes

### SuperTokens Architecture Decision

SuperTokens is the auth provider (managed free tier, ≤5,000 MAUs). It stores identity (email, hashed password, session tokens). Our `User` table stores role, display name, fleet context, and GDPR metadata. The two are linked by `supertokens_id`.

**Pattern:** Mobile → NestJS API `/v1/auth/*` → supertokens-node SDK → SuperTokens managed cloud

Mobile does NOT use supertokens-react-native SDK in this story. The API is the single auth surface. Social sign-in (Stories 1.2, 1.3) may introduce the SDK.

[Source: architecture.md — Authentication section]

---

### Prisma Schema — Full User Model

Replace `packages/db/prisma/schema.prisma` placeholder with:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
}

enum UserRole {
  DRIVER
  STATION_MANAGER
  FLEET_MANAGER
  ADMIN
  DATA_BUYER
}

model User {
  id               String    @id @default(uuid())
  supertokens_id   String    @unique
  email            String?   @unique  // nullable for GDPR erasure
  display_name     String?            // nullable for GDPR erasure
  role             UserRole  @default(DRIVER)
  fleet_id         String?
  trust_score      Int       @default(0)
  shadow_banned    Boolean   @default(false)
  deleted_at       DateTime?
  deletion_reason  String?
  created_at       DateTime  @default(now())
  updated_at       DateTime  @updatedAt
}
```

Note: `Fleet` model omitted in Story 1.1 — `fleet_id` is a plain nullable string for now. The Fleet model + FK constraint is added in a later story when Fleet management is implemented.

**IMPORTANT:** After running migration, verify the Prisma-generated client is exported from `packages/db/src/index.ts`:
```ts
export { PrismaClient, UserRole } from '@prisma/client';
export type { User } from '@prisma/client';
```

---

### SuperTokens Initialization — `apps/api/src/auth/supertokens.ts`

```ts
import SuperTokens from 'supertokens-node';
import EmailPassword from 'supertokens-node/recipe/emailpassword';
import Session from 'supertokens-node/recipe/session';

export function initSuperTokens(connectionUri: string, apiKey: string) {
  SuperTokens.init({
    framework: 'custom', // we handle request/response manually
    supertokens: { connectionURI: connectionUri, apiKey },
    appInfo: {
      appName: 'desert',
      apiDomain: process.env.API_URL ?? 'http://localhost:3000',
      websiteDomain: process.env.WEB_URL ?? 'http://localhost:3001',
      apiBasePath: '/v1/auth',
    },
    recipeList: [
      EmailPassword.init(),
      Session.init({ getTokenTransferMethod: () => 'header' }), // JWT in Authorization header
    ],
  });
}
```

`Session.init({ getTokenTransferMethod: () => 'header' })` is critical for mobile — uses `Authorization: Bearer <token>` instead of cookies.

---

### AuthModule — `apps/api/src/auth/auth.module.ts`

```ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { initSuperTokens } from './supertokens.js';
import { PrismaModule } from '../prisma/prisma.module.js'; // see note below

@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {
  constructor(config: ConfigService) {
    initSuperTokens(
      config.getOrThrow('SUPERTOKENS_CONNECTION_URI'),
      config.getOrThrow('SUPERTOKENS_API_KEY'),
    );
  }
}
```

**PrismaModule:** You need to create a `PrismaModule` + `PrismaService` that wraps `PrismaClient` from `@desert/db`. Create:
- `apps/api/src/prisma/prisma.service.ts` — extends `PrismaClient`, implements `OnModuleInit`
- `apps/api/src/prisma/prisma.module.ts` — global module, exports `PrismaService`

---

### AuthService — `apps/api/src/auth/auth.service.ts`

```ts
import { Injectable, ConflictException, UnauthorizedException } from '@nestjs/common';
import EmailPassword from 'supertokens-node/recipe/emailpassword';
import Session from 'supertokens-node/recipe/session';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async register(email: string, password: string, displayName: string) {
    const result = await EmailPassword.signUp('public', email, password);
    if (result.status === 'EMAIL_ALREADY_EXISTS_ERROR') {
      throw new ConflictException('Email already registered');
    }
    if (result.status !== 'OK') {
      throw new Error(`SuperTokens signUp failed: ${result.status}`);
    }
    const stUser = result.user;
    const user = await this.prisma.user.create({
      data: {
        supertokens_id: stUser.id,
        email,
        display_name: displayName,
        role: 'DRIVER',
      },
    });
    // Create a session (returns access token)
    const session = await Session.createNewSessionWithoutRequestResponse(
      'public',
      stUser.id,
      { userId: user.id, role: user.role },
    );
    return { user, accessToken: session.getAccessToken() };
  }

  async login(email: string, password: string) {
    const result = await EmailPassword.signIn('public', email, password);
    if (result.status === 'WRONG_CREDENTIALS_ERROR') {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (result.status !== 'OK') {
      throw new Error(`SuperTokens signIn failed: ${result.status}`);
    }
    const stUser = result.user;
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { supertokens_id: stUser.id },
    });
    const session = await Session.createNewSessionWithoutRequestResponse(
      'public',
      stUser.id,
      { userId: user.id, role: user.role },
    );
    return { user, accessToken: session.getAccessToken() };
  }

  async logout(sessionHandle: string) {
    await Session.revokeSession(sessionHandle);
  }

  async getMe(userId: string) {
    return this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
  }
}
```

---

### AuthController — `apps/api/src/auth/auth.controller.ts`

```ts
import { Controller, Post, Get, Body, UseGuards, HttpCode } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { CurrentUser } from './current-user.decorator.js';

@Controller('v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() body: { email: string; password: string; displayName: string }) {
    return this.authService.register(body.email, body.password, body.displayName);
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() body: { email: string; password: string }) {
    return this.authService.login(body.email, body.password);
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  logout(@CurrentUser('sessionHandle') sessionHandle: string) {
    return this.authService.logout(sessionHandle);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser('userId') userId: string) {
    return this.authService.getMe(userId);
  }
}
```

---

### JwtAuthGuard — `apps/api/src/auth/jwt-auth.guard.ts`

```ts
import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import Session from 'supertokens-node/recipe/session';
import { FastifyRequest } from 'fastify';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) throw new UnauthorizedException();
    const token = authHeader.substring(7);
    try {
      const sessionInfo = await Session.getSessionInformation(
        await Session.getSessionWithoutRequestResponse(token, undefined),
      );
      // Attach to request for CurrentUser decorator
      (req as any).currentUser = sessionInfo.customClaimsInAccessTokenPayload;
      (req as any).sessionHandle = sessionInfo.sessionHandle;
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
```

**Note:** `getSessionWithoutRequestResponse` verifies the JWT locally (no network call to SuperTokens) when using header-based tokens with `getTokenTransferMethod: () => 'header'`. This is performant.

---

### CurrentUser Decorator — `apps/api/src/auth/current-user.decorator.ts`

```ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { FastifyRequest } from 'fastify';

export const CurrentUser = createParamDecorator(
  (key: string | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<FastifyRequest & { currentUser: any; sessionHandle: string }>();
    if (key === 'sessionHandle') return req.sessionHandle;
    if (key) return req.currentUser?.[key];
    return req.currentUser;
  },
);
```

---

### i18n Keys Required (AC: 6)

All auth screens must support Polish, English, Ukrainian. Minimum key set for `apps/mobile/src/i18n/locales/`:

```ts
// en.ts — base translations
export default {
  auth: {
    register: {
      title: 'Create account',
      emailLabel: 'Email',
      passwordLabel: 'Password',
      displayNameLabel: 'Display name',
      submitButton: 'Create account',
      loginLink: 'Already have an account? Sign in',
      emailAlreadyExists: 'This email is already registered',
      genericError: 'Something went wrong. Please try again.',
    },
    login: {
      title: 'Sign in',
      emailLabel: 'Email',
      passwordLabel: 'Password',
      submitButton: 'Sign in',
      registerLink: "Don't have an account? Create one",
      wrongCredentials: 'Invalid email or password',
      genericError: 'Something went wrong. Please try again.',
    },
  },
} as const;
```

Provide Polish (`pl.ts`) and Ukrainian (`uk.ts`) translations for all keys above.

---

### Mobile: Auth Store (minimal, React Context approach)

Use React Context for auth state in Story 1.1 (Zustand can replace it in a later refactor):

```ts
// apps/mobile/src/store/auth.store.ts
import { createContext, useContext } from 'react';
import * as SecureStore from 'expo-secure-store';

export interface AuthUser {
  id: string;
  email: string | null;
  displayName: string | null;
  role: string;
}

export interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthState | null>(null);
export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
};
```

---

### Mobile: Navigation Structure

Use Expo Router v4 group routes:
```
apps/mobile/app/
  index.tsx                — root redirect (→ (app) or (auth)/login)
  (auth)/
    _layout.tsx            — auth stack, redirect to (app) if already logged in
    login.tsx
    register.tsx
  (app)/
    _layout.tsx            — protected stack, redirect to (auth)/login if no token
    index.tsx              — map screen placeholder
```

Check token from SecureStore on app start in root `index.tsx` to decide initial route.

---

### Environment Variables — Full Set for Story 1.1

Add to `apps/api/.env.example`:
```
SUPERTOKENS_CONNECTION_URI=https://YOUR_APP.aws.supertokens.io:3568
SUPERTOKENS_API_KEY=your-api-key-here
API_URL=http://localhost:3000
WEB_URL=http://localhost:3001
```

Add to Railway Variables (for production):
```
SUPERTOKENS_CONNECTION_URI=<from supertokens dashboard>
SUPERTOKENS_API_KEY=<from supertokens dashboard>
API_URL=https://your-railway-api-url.railway.app
WEB_URL=https://desert-web.vercel.app
```

---

### UX Constraints

1. **No registration wall on first open** — map shows immediately; Story 1.1 only implements the auth screens themselves. The gate logic (prompt at first contribution) is in the submission story.
2. Registration and login screens are navigable from each other via text links.
3. Forms must show field-level validation errors inline (not just toast).
4. Loading state must be shown on submit buttons while request is in-flight.

[Source: ux-design-specification.md — Journey 3 & Journey 4, Anti-Patterns]

---

### Testing Standards

- All `*.spec.ts` files use Jest + `@nestjs/testing` (see existing tests for patterns)
- Mock `supertokens-node` with `jest.mock('supertokens-node/recipe/emailpassword')` etc.
- Mock `PrismaService` using `{ provide: PrismaService, useValue: { user: { create: jest.fn(), findUniqueOrThrow: jest.fn() } } }`
- Do NOT add integration tests hitting real SuperTokens in Story 1.1

---

### Project Structure Notes

- **`packages/db`**: Prisma schema + generated client lives here. API imports `PrismaClient` from `@desert/db`.
- **`apps/api/src/prisma/`**: Create `PrismaService` here (wraps `PrismaClient`). This is the NestJS-injectable wrapper.
- **`apps/api/src/auth/`**: All auth logic (module, controller, service, guard, decorator, supertokens init).
- **`apps/mobile/src/`**: Non-route code (store, api clients, i18n, lib).
- **`apps/mobile/app/`**: Expo Router pages only.
- NestJS uses `.js` extensions in imports (e.g., `./auth.service.js`) — follow this convention throughout.

### References

- [Source: epics.md — Story 1.1, lines 329–363]
- [Source: architecture.md — Authentication & SuperTokens section, lines 136–166]
- [Source: architecture.md — User model & RBAC, lines 188–224]
- [Source: ux-design-specification.md — Journey 3 First Open & Journey 4 Sign-Up at First Contribution, lines 468–544]
- [Source: packages/db/prisma/schema.prisma — placeholder User model to be replaced]
- [Source: apps/api/src/app.module.ts — AuthModule to be registered here]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- supertokens-node v24: `signUp`/`signIn` return `recipeUserId` (separate from `user.id`); `createNewSessionWithoutRequestResponse` requires `RecipeUserId` object, not string
- `ts-jest` mocks for ES module default exports require `__esModule: true` in mock factory to prevent double-wrapping by `__importDefault`
- `PrismaService` imports from `@prisma/client` directly (not `@desert/db`) to avoid `rootDir` violation in `tsconfig.json`
- SuperTokens `getSessionWithoutRequestResponse` + `getHandle()` pattern used in `JwtAuthGuard` for stateless JWT verification (no network call to SuperTokens cloud)

### Completion Notes List

- Full Prisma User model with UserRole enum deployed to Neon DB via migration `20260322204126_add_user_auth_fields`
- NestJS AuthModule: `initSuperTokens()` called in module constructor, EmailPassword + Session recipes, header-based JWT
- API endpoints: `POST /v1/auth/register`, `POST /v1/auth/login`, `POST /v1/auth/logout`, `GET /v1/auth/me`
- `JwtAuthGuard` verifies SuperTokens JWT locally from `Authorization: Bearer` header
- `@CurrentUser()` decorator extracts `userId`, `role`, or `sessionHandle` from request context
- 6 AuthService unit tests, all passing (14 total across API)
- Mobile: `AuthProvider` (React Context), `AuthClient` (typed fetch wrapper), `SecureStorage` (expo-secure-store)
- Mobile: i18n with i18next + expo-localization, EN/PL/UK translations for all auth screens
- Mobile: Expo Router v4 group routes `(auth)` and `(app)` with auth-guard redirects in layouts
- Mobile: root `_layout.tsx` wraps app in `AuthProvider` and initializes i18n
- All monorepo type-checks, lint, and tests pass

### File List

- `packages/db/prisma/schema.prisma` — full User model + UserRole enum (replaces placeholder)
- `packages/db/prisma/migrations/20260322204126_add_user_auth_fields/migration.sql` — migration (auto-generated)
- `packages/db/src/index.ts` — added UserRole and User type exports
- `apps/api/src/prisma/prisma.service.ts` — NestJS PrismaService (extends PrismaClient with adapter)
- `apps/api/src/prisma/prisma.module.ts` — global NestJS PrismaModule
- `apps/api/src/auth/supertokens.ts` — initSuperTokens() function
- `apps/api/src/auth/auth.service.ts` — register, login, logout, getMe
- `apps/api/src/auth/auth.controller.ts` — 4 REST endpoints
- `apps/api/src/auth/auth.module.ts` — NestJS AuthModule
- `apps/api/src/auth/jwt-auth.guard.ts` — JwtAuthGuard (CanActivate)
- `apps/api/src/auth/current-user.decorator.ts` — @CurrentUser() param decorator
- `apps/api/src/auth/auth.service.spec.ts` — 6 unit tests
- `apps/api/src/app.module.ts` — added PrismaModule + AuthModule
- `apps/api/.env.example` — added SuperTokens + URL vars
- `apps/mobile/src/api/auth.ts` — typed fetch API client
- `apps/mobile/src/store/auth.store.ts` — AuthProvider + useAuth hook
- `apps/mobile/src/lib/secure-storage.ts` — SecureStore wrapper
- `apps/mobile/src/i18n/index.ts` — i18next initialization
- `apps/mobile/src/i18n/locales/en.ts` — English auth strings
- `apps/mobile/src/i18n/locales/pl.ts` — Polish auth strings
- `apps/mobile/src/i18n/locales/uk.ts` — Ukrainian auth strings
- `apps/mobile/app/_layout.tsx` — root layout (AuthProvider + i18n init)
- `apps/mobile/app/index.tsx` — root redirect (auth state → (app) or (auth)/login)
- `apps/mobile/app/(auth)/_layout.tsx` — auth stack layout (redirects to app if logged in)
- `apps/mobile/app/(auth)/login.tsx` — login screen
- `apps/mobile/app/(auth)/register.tsx` — registration screen
- `apps/mobile/app/(app)/_layout.tsx` — protected app layout (redirects to login if not authenticated)
- `apps/mobile/app/(app)/index.tsx` — map placeholder screen with sign-out
