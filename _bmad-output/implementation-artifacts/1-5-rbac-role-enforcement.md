# Story 1.5: RBAC & Role Enforcement

Status: review

## Story

As a **developer**,
I want all API routes protected by role-based access control,
So that each actor type can only access the resources they are authorised for.

**Why:** Desert has 5 distinct actor types (DRIVER, STATION_MANAGER, FLEET_MANAGER, ADMIN, DATA_BUYER) with very different permissions. RBAC built in from day one is far cheaper than retrofitting it later and prevents accidental data exposure as the API surface grows.

## Acceptance Criteria

1. **Given** an unauthenticated request to any protected API endpoint
   **When** the request is received
   **Then** the API returns 401 Unauthorized

2. **Given** an authenticated driver attempting to access an admin-only endpoint
   **When** the request is received
   **Then** the API returns 403 Forbidden

3. **Given** an authenticated user with role `ADMIN`
   **When** they access an admin-only endpoint
   **Then** the request is processed successfully

4. **Given** an authenticated user with role `DRIVER`
   **When** they access a driver-permitted endpoint (e.g. `POST /v1/submissions`)
   **Then** the request is processed successfully

5. **Given** any authenticated request
   **When** the NestJS `JwtAuthGuard` verifies the JWT
   **Then** the `User` record (including role) is loaded from the database and attached to the request context for downstream use

6. **Given** the five actor types (DRIVER, STATION_MANAGER, FLEET_MANAGER, ADMIN, DATA_BUYER)
   **When** any route is defined
   **Then** it has an explicit `@Roles()` decorator or `@Public()` decorator — no route is inadvertently left unprotected

## Tasks / Subtasks

### Phase 1 — Decorator Infrastructure

- [x] **1.1** Create `apps/api/src/auth/decorators/public.decorator.ts`
  - Export `IS_PUBLIC_KEY = 'isPublic'` constant
  - Export `@Public()` decorator: `SetMetadata(IS_PUBLIC_KEY, true)`

- [x] **1.2** Create `apps/api/src/auth/decorators/roles.decorator.ts`
  - Import `UserRole` enum from `@prisma/client`
  - Export `ROLES_KEY = 'roles'` constant
  - Export `@Roles(...roles: UserRole[])` decorator: `SetMetadata(ROLES_KEY, roles)`

### Phase 2 — Update JwtAuthGuard (load User from DB)

- [x] **2.1** Update `apps/api/src/auth/jwt-auth.guard.ts`:
  - Inject `PrismaService` into the guard constructor
  - After verifying the SuperTokens session, extract `userId` from `sessionInfo.customClaimsInAccessTokenPayload`
  - Load the full `User` record: `await prisma.user.findUnique({ where: { id: userId } })`
  - If user is not found → throw `UnauthorizedException` (data inconsistency)
  - Set `req.currentUser` to the full `User` record (replaces the claims object)
  - Keep `req.sessionHandle = sessionInfo.sessionHandle` unchanged
  - Add skip logic at the top: if `IS_PUBLIC_KEY` metadata is true → return `true` immediately (skip auth)
  - Register `PrismaService` as a provider in `AuthModule` or use the already-global `PrismaModule`

- [x] **2.2** Update `apps/api/src/auth/current-user.decorator.ts`:
  - Update the `AuthenticatedRequest` type: change `currentUser: Record<string, unknown>` to `currentUser: import('@prisma/client').User`
  - No logic changes needed — `@CurrentUser('id')` will now return `user.id`, `@CurrentUser('role')` returns `user.role`, etc.

- [x] **2.3** Update `apps/api/src/auth/auth.controller.ts`:
  - In `me()`: change `@CurrentUser('userId')` → `@CurrentUser('id')` (User record uses `id`, not `userId`)
  - In `logout()`: keep `@CurrentUser('sessionHandle')` unchanged (still extracted from `req.sessionHandle`)

### Phase 3 — RolesGuard

- [x] **3.1** Create `apps/api/src/auth/guards/roles.guard.ts`:
  ```
  @Injectable()
  export class RolesGuard implements CanActivate {
    constructor(private reflector: Reflector) {}

    canActivate(context: ExecutionContext): boolean {
      const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (!requiredRoles || requiredRoles.length === 0) return true; // no @Roles → allow any authenticated user
      const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
      return requiredRoles.includes(req.currentUser.role as UserRole);
    }
  }
  ```

### Phase 4 — Register Guards Globally

- [x] **4.1** Update `apps/api/src/app.module.ts`:
  - Register both guards globally using `APP_GUARD` tokens in the `providers` array:
    ```ts
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    ```
  - Import `APP_GUARD` from `@nestjs/core`
  - Import `JwtAuthGuard` and `RolesGuard`

### Phase 5 — Annotate Existing Routes

- [x] **5.1** Update `apps/api/src/auth/auth.controller.ts`:
  - Mark public endpoints with `@Public()`:
    - `register()` → add `@Public()`
    - `login()` → add `@Public()`
    - `googleAuth()` → add `@Public()`
    - `appleAuth()` → add `@Public()`
  - Remove `@UseGuards(JwtAuthGuard)` from `logout()` and `me()` — handled globally now
  - Add role annotations to protected endpoints:
    - `logout()` → `@Roles(UserRole.DRIVER, UserRole.STATION_MANAGER, UserRole.FLEET_MANAGER, UserRole.ADMIN, UserRole.DATA_BUYER)` (any authenticated role)
    - `me()` → same as logout (any authenticated role)

- [x] **5.2** Update `apps/api/src/health/health.controller.ts`:
  - Add `@Public()` to the health check endpoint (it must remain unauthenticated for Railway health checks)

### Phase 6 — getMe Optimisation (optional but recommended)

- [x] **6.1** Since `JwtAuthGuard` now loads the full User from DB and attaches it to the request, `getMe()` can return `req.currentUser` directly rather than making a second DB call in `AuthService.getMe()`.
  - Update `auth.controller.ts` `me()`: `return this.authService.getMe(userId)` → inject `@CurrentUser() user: User` and return it directly, or keep the service call — either is acceptable.
  - If opting to return directly: remove `AuthService.getMe()` from controller usage (keep the method in case other services need it later, just don't call it from the me endpoint).

### Phase 7 — Tests

- [x] **7.1** Create `apps/api/src/auth/guards/roles.guard.spec.ts`:
  - Test: no `@Roles()` on handler → allows any authenticated request (returns `true`)
  - Test: `@Roles(UserRole.ADMIN)` on handler + `req.currentUser.role = 'DRIVER'` → returns `false`
  - Test: `@Roles(UserRole.ADMIN)` on handler + `req.currentUser.role = 'ADMIN'` → returns `true`
  - Test: multiple roles `@Roles(UserRole.DRIVER, UserRole.ADMIN)` + DRIVER user → returns `true`

- [x] **7.2** Update `apps/api/src/auth/auth.service.spec.ts`:
  - `getMe()` test: update mock to call `findUnique` instead of `findUniqueOrThrow` IF the service method is changed. Otherwise no change needed.

- [x] **7.3** Update `apps/api/src/auth/auth.controller.spec.ts`:
  - Verify `@Public()` metadata is set on register, login, googleAuth, appleAuth
  - Verify `me()` uses `@CurrentUser('id')` (not `'userId'`)

- [x] **7.4** Update `apps/api/src/auth/auth.service.spec.ts`:
  - Update mock to include `findUnique` (already done in 1.1–1.3 fix commit) ✓

## Dev Notes

### File Locations (Critical — do NOT create files elsewhere)
```
apps/api/src/auth/
  decorators/
    public.decorator.ts       ← NEW
    roles.decorator.ts        ← NEW
  guards/
    roles.guard.ts            ← NEW
  jwt-auth.guard.ts           ← MODIFY (add @Public skip, DB load, PrismaService inject)
  current-user.decorator.ts   ← MODIFY (type update only)
  auth.controller.ts          ← MODIFY (@Public, @Roles, fix @CurrentUser('userId')→'id')
  auth.module.ts              ← MODIFY (export JwtAuthGuard + RolesGuard if needed)
apps/api/src/app.module.ts    ← MODIFY (APP_GUARD providers)
apps/api/src/health/health.controller.ts  ← MODIFY (@Public on health endpoint)
```

### Architecture Compliance
- Architecture doc Decision 3: "NestJS Guards + decorator-based RBAC for route protection" — this is exactly what we're building.
- **Global guards via APP_GUARD** is the NestJS pattern for "protect everything by default". This is correct for a security-first posture.
- Guards execute in order: `JwtAuthGuard` runs first (sets req.currentUser), then `RolesGuard` (reads req.currentUser.role).
- `@Public()` must be checked in `JwtAuthGuard` (before token verification) to allow unauthenticated access.
- `RolesGuard` does NOT need to check `@Public()` — if `JwtAuthGuard` allowed it through, `RolesGuard` will see no `@Roles()` metadata and allow it.

### Critical: JwtAuthGuard APP_GUARD + @Public() pattern
When `JwtAuthGuard` is registered as `APP_GUARD`, every request goes through it. The `@Public()` skip must be at the **very top** of `canActivate()`:

```ts
canActivate(context: ExecutionContext): Promise<boolean> | boolean {
  const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
    context.getHandler(),
    context.getClass(),
  ]);
  if (isPublic) return true;
  // ... existing auth logic
}
```

This requires injecting `Reflector` into `JwtAuthGuard`. Add it to the constructor.

### Critical: PrismaService in JwtAuthGuard
`JwtAuthGuard` is now registered in `AppModule` via `APP_GUARD`, not just in `AuthModule`. `PrismaService` is provided by `PrismaModule` which is imported globally via `AppModule`. NestJS resolves `PrismaService` when the guard is instantiated — no circular dependency issues.

The guard constructor becomes:
```ts
constructor(
  private readonly prisma: PrismaService,
  private readonly reflector: Reflector,
) {}
```

`Reflector` is automatically provided by NestJS — no import needed.

### CurrentUser Type Change
`req.currentUser` changes from `Record<string, unknown>` (JWT claims with `userId`, `role`) to the full Prisma `User` object. This affects:
- `@CurrentUser('userId')` in `me()` → must change to `@CurrentUser('id')`
- The `AuthenticatedRequest` type in `current-user.decorator.ts` → update to use `User` from `@prisma/client`
- Tests that use `currentUser.userId` → update to `currentUser.id`

### No Mobile Changes
Story 1.5 is entirely API-side. No changes to `apps/mobile`.

### Health Endpoint Must Be Public
`apps/api/src/health/health.controller.ts` serves Railway's health check at `GET /health`. This must have `@Public()` or Railway's liveness checks will fail with 401. Verify the health controller exists and add `@Public()` to the health check handler.

### Existing Tests That Will Break Without Updates
- `auth.controller.spec.ts`: The `me()` test likely mocks `currentUser.userId` — update to `currentUser.id`
- `auth.service.spec.ts`: If `getMe()` implementation changes (Phase 6), update accordingly

### getMe() — Recommended Simplification
With User loaded in JwtAuthGuard, `GET /v1/auth/me` can return `req.currentUser` directly (zero extra DB query). The controller becomes:

```ts
@Get('me')
me(@CurrentUser() user: User): User {
  return user;
}
```

This removes the need to call `authService.getMe()` from the endpoint. The service method can be kept for use by other future services.

### UserRole Enum Source
Import `UserRole` from `@prisma/client` (generated). Do NOT redefine the enum — it's already in `packages/db/prisma/schema.prisma`:
```prisma
enum UserRole {
  DRIVER
  STATION_MANAGER
  FLEET_MANAGER
  ADMIN
  DATA_BUYER
}
```

### Test for 403
For the 403 test (AC2) in `roles.guard.spec.ts`, the guard returns `false` — NestJS `RolesGuard` returning `false` triggers a `ForbiddenException` (403) automatically. No explicit throw needed in the guard.

### Previous Story Patterns (from Stories 1.1–1.4)
- All new TS files use `.ts` extension, no `.js` extension on imports (this is a NestJS/TS-first project)
- Wait — the existing imports DO use `.js` extension: `import { PrismaService } from '../prisma/prisma.service.js'`. Follow this pattern: **all imports in `apps/api/src` use `.js` extension** (ES module resolution with TypeScript).
- `@prisma/client` import: `import { User, UserRole } from '@prisma/client'` (no `.js`)
- Class naming: PascalCase, file naming: kebab-case
- Tests use Jest with `mockResolvedValueOnce` pattern (not spies)

### Git Log (recent commits to understand current state)
- `8689ebb` — Fix auth security issues (1.1–1.3 code review patches) — auth.service.ts, jwt-auth.guard.ts, apple-auth.dto.ts
- `8e970cf` — Story 1.4 — First-Open Onboarding & Guest Mode
- `1a59403` — Story 1.3 — Apple Sign-In
- `65bc36f` — Story 1.2 — Google Sign-In
- `e4ace71` — Story 1.1 — email/password registration & login
