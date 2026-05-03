# Story 7.1: Station Claim — Easy Path

## Metadata
- **Epic:** 7 — Station Partner Portal
- **Story ID:** 7.1
- **Status:** review
- **Date:** 2026-04-07
- **Depends on:** Stories 2.1 (Station DB + google_places_id), 2.14 (brand field populated), 1.1/1.2 (auth)
- **Required by:** 7.2 (hard path fallback), 7.3 (self-service price updates), 7.4 (performance metrics)

---

## User Story

**As a station owner,**
I want to claim my station instantly using my Google Business Profile or work email,
So that I can start managing my station's prices without waiting for manual review.

---

## Context & Why

This story is the **first story in Epic 7** and scaffolds the entire `apps/partner` web application. All subsequent Epic 7/8 partner-facing features will live here.

The easy path covers the majority of claimable stations: chains via email domain match (ORLEN, BP, Circle K, Shell, Lotos, Moya, Amic cover the majority of Polish chain stations), and independents with a Google Business Profile. Phone SMS and document upload are deferred to Story 7.2 — owners who fail the easy path see a clear "pending verification" state and CTA.

**Architecture decision (locked):** The partner portal is `apps/partner` — a new Next.js 16 app in the Turborepo monorepo. It is NOT an extension of `apps/admin`. Station owners are an external commercial audience; mixing them into the ops panel would be a security boundary violation and block Epic 8's commercial product surface. Follow the `apps/admin` pattern closely but keep it entirely separate.

---

## Acceptance Criteria

**Given** a station owner visits the partner portal for the first time
**When** they land on the home page
**Then** they are redirected to `/login` (unauthenticated) or `/claim` (authenticated but no station claimed yet) or `/station/{stationId}` (authenticated STATION_MANAGER)

**Given** a station owner is on the claim search page
**When** they type a station name, address, or postcode
**Then** matching stations are shown with their current claim status: `unclaimed` / `pending` / `verified`

**Given** a station owner selects an unclaimed station and initiates a claim
**When** they choose "Verify with Google Business Profile"
**Then** they are redirected to the Google OAuth consent screen (scope: `business.manage`)
**And** after consent, the API callback checks whether the station's `google_places_id` appears in their GBP managed locations
**And** if matched, the claim is approved immediately, STATION_MANAGER role granted, and the owner is redirected to `/login?message=verified&redirect=/station/{stationId}` (re-login required for fresh token)
**And** if not matched, they are shown "Automatic match failed — try domain verification or contact us about manual verification"

**Given** a station owner initiates a claim with a business email
**When** the registered account email domain is checked against the known chain domain list
**Then** if matched AND the selected station's `brand` field matches the chain name, the claim is approved immediately and STATION_MANAGER role granted, and the owner is redirected to `/login?message=verified&redirect=/station/{stationId}`

**Given** neither Google OAuth nor domain match succeeds
**When** the easy path is exhausted
**Then** the station is marked `pending` in `StationClaim` — no access granted yet
**And** the owner sees: "We couldn't verify automatically — our team will reach out for additional steps" with a CTA to the hard path (Story 7.2, shown as "coming soon" if not yet shipped)

**Given** a station already has an `APPROVED` claim from another user
**When** another owner attempts to claim it via the easy path
**Then** the claim is blocked with the message: "This station is already managed by a verified owner. Contact support if you believe this is an error."

**Given** a station has a `PENDING` claim from the same user
**When** they attempt to initiate another claim
**Then** they are shown the current pending status and prevented from submitting a duplicate

---

## Schema Changes

### New Prisma enums

```prisma
enum ClaimStatus {
  PENDING
  APPROVED
  REJECTED
}

enum ClaimMethod {
  GOOGLE_BUSINESS
  DOMAIN_MATCH
  PHONE_SMS        // reserved for Story 7.2
  DOCUMENT_UPLOAD  // reserved for Story 7.2
}
```

### New Prisma model

```prisma
model StationClaim {
  id           String      @id @default(uuid())
  station_id   String
  user_id      String
  status       ClaimStatus @default(PENDING)
  method       ClaimMethod
  created_at   DateTime    @default(now())
  updated_at   DateTime    @updatedAt
  reviewed_at  DateTime?
  reviewed_by  String?     // admin User.id — set on manual ops approval (Story 7.2)

  station      Station     @relation(fields: [station_id], references: [id])
  user         User        @relation(fields: [user_id], references: [id])

  @@unique([station_id, user_id])
  @@index([station_id])
  @@index([user_id])
  @@index([status])
}
```

### Additions to existing models

```prisma
// Station model — add:
claims         StationClaim[]

// User model — add:
stationClaims  StationClaim[]
```

**Migration name:** `add_station_claim`

---

## New App: `apps/partner`

This story scaffolds the entire `apps/partner` application. Follow `apps/admin` as the reference implementation — reuse its patterns exactly.

### package.json

```json
{
  "name": "@desert/partner",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "next dev --port 3004",
    "build": "next build",
    "start": "next start --port 3004",
    "lint": "eslint . --max-warnings 0",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "@desert/types": "workspace:*",
    "next": "16.2.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@desert/config": "workspace:*",
    "@types/node": "^22.13.10",
    "@types/react": "^19.0.10",
    "@types/react-dom": "^19.0.4",
    "eslint": "^9.22.0",
    "typescript-eslint": "^8.26.1",
    "tailwindcss": "^4.0.12",
    "@tailwindcss/postcss": "^4.0.12",
    "typescript": "^5.8.3"
  }
}
```

### next.config.ts

```typescript
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@desert/types'],
};

export default nextConfig;
```

### tsconfig.json

```json
{
  "extends": "@desert/config/tsconfig/nextjs.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./*"],
      "@desert/types": ["../../packages/types/src/index.ts"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

### Directory structure

```
apps/partner/
├── app/
│   ├── layout.tsx               # root layout — locale detection, html lang
│   ├── page.tsx                 # redirect logic (see below)
│   ├── globals.css
│   ├── login/
│   │   ├── page.tsx
│   │   ├── actions.ts
│   │   └── LoginForm.tsx
│   ├── register/
│   │   ├── page.tsx
│   │   ├── actions.ts
│   │   └── RegisterForm.tsx
│   └── (partner)/               # authenticated route group
│       ├── layout.tsx           # sidebar + nav
│       ├── claim/
│       │   ├── page.tsx         # station search
│       │   └── [stationId]/
│       │       └── page.tsx     # claim initiation
│       └── station/
│           └── [stationId]/
│               └── page.tsx     # management screen (post-claim, Story 7.3/7.4 fill this)
├── lib/
│   ├── partner-api.ts           # mirrors admin-api.ts
│   └── i18n.ts
├── middleware.ts
├── vercel.json
├── next.config.ts
├── tsconfig.json
└── package.json
```

### middleware.ts

```typescript
import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_PATHS = new Set(['/login', '/register']);

interface TokenClaims {
  role?: string;
  exp?: number;
}

function decodeJwtPayload(token: string): TokenClaims | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload)) as TokenClaims;
  } catch {
    return null;
  }
}

function clearAndRedirect(req: NextRequest): NextResponse {
  const res = NextResponse.redirect(new URL('/login', req.url));
  res.cookies.delete('partner_token');
  return res;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  const token = req.cookies.get('partner_token')?.value;
  if (!token) return NextResponse.redirect(new URL('/login', req.url));

  const claims = decodeJwtPayload(token);
  if (!claims) return clearAndRedirect(req);

  const nowSec = Math.floor(Date.now() / 1000);
  if (claims.exp && claims.exp < nowSec) return clearAndRedirect(req);

  // Any authenticated user may access the partner portal —
  // role enforcement happens at the API level per route.
  // DRIVER role → can initiate claims. STATION_MANAGER → can manage stations.
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

### lib/partner-api.ts

```typescript
import { cookies } from 'next/headers';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

export class PartnerApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'PartnerApiError';
  }
}

export async function partnerFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const cookieStore = await cookies();
  const token = cookieStore.get('partner_token')?.value ?? '';

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options?.headers ?? {}),
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new PartnerApiError(res.status, `API ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}
```

### app/page.tsx (root redirect logic)

```typescript
// This is a Server Component — redirect based on auth state.
// Middleware already handles unauthenticated → /login.
// If authenticated: check if user has STATION_MANAGER role via API, redirect accordingly.
import { redirect } from 'next/navigation';
import { partnerFetch, PartnerApiError } from '../lib/partner-api';

interface MeResponse {
  role: string;
  managedStationId?: string; // populated server-side if user has an approved claim
}

export default async function PartnerHome() {
  let me: MeResponse;
  try {
    me = await partnerFetch<MeResponse>('/v1/partner/me');
  } catch (e) {
    if (e instanceof PartnerApiError && e.status === 401) {
      redirect('/login');
    }
    redirect('/login');
  }

  if (me.role === 'STATION_MANAGER' && me.managedStationId) {
    redirect(`/station/${me.managedStationId}`);
  }

  redirect('/claim');
}
```

### app/login/actions.ts

```typescript
'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const COOKIE_NAME = 'partner_token';
const COOKIE_MAX_AGE = 60 * 60 * 8; // 8 hours

export async function loginAction(
  _prevState: { error: string } | null,
  formData: FormData,
): Promise<{ error: string } | never> {
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
  const redirectTo = (formData.get('redirectTo') as string | null) ?? '/';

  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      cache: 'no-store',
    });
  } catch {
    return { error: 'generic' };
  }

  if (res.status === 401 || res.status === 400) return { error: 'invalid' };
  if (!res.ok) return { error: 'generic' };

  const body = (await res.json()) as { accessToken?: string };
  if (!body.accessToken) return { error: 'generic' };

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, body.accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });

  // Safe redirect — only allow relative paths to prevent open redirect
  const safeRedirect = redirectTo.startsWith('/') ? redirectTo : '/';
  redirect(safeRedirect);
}

export async function logoutAction(): Promise<never> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (token) {
    fetch(`${API_URL}/v1/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    }).catch(() => undefined);
    cookieStore.delete(COOKIE_NAME);
  }
  redirect('/login');
}
```

### app/register/actions.ts

```typescript
'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const COOKIE_NAME = 'partner_token';
const COOKIE_MAX_AGE = 60 * 60 * 8;

export async function registerAction(
  _prevState: { error: string } | null,
  formData: FormData,
): Promise<{ error: string } | never> {
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
  const displayName = formData.get('displayName') as string;

  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, displayName }),
      cache: 'no-store',
    });
  } catch {
    return { error: 'generic' };
  }

  if (res.status === 409) return { error: 'emailTaken' };
  if (res.status === 400) return { error: 'validation' };
  if (!res.ok) return { error: 'generic' };

  const body = (await res.json()) as { accessToken?: string };
  if (!body.accessToken) return { error: 'generic' };

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, body.accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });

  redirect('/claim');
}
```

---

## New API Module: `apps/api/src/partner/`

### File structure

```
apps/api/src/partner/
├── partner.module.ts
├── partner.controller.ts
├── partner.service.ts
└── dto/
    ├── initiate-claim.dto.ts
    └── station-search.dto.ts
```

### partner.service.ts

```typescript
@Injectable()
export class PartnerService {
  // Chain domain → brand name map
  private static readonly CHAIN_DOMAIN_MAP: Record<string, string> = {
    'orlen.pl': 'ORLEN',
    'pkn.pl': 'ORLEN',
    'bp.com': 'BP',
    'circlek.com': 'Circle K',
    'couche-tard.com': 'Circle K',
    'shell.com': 'Shell',
    'lotos.pl': 'Lotos',
    'moya.pl': 'Moya',
    'amic.de': 'Amic',
    'amic.pl': 'Amic',
  };

  constructor(
    private readonly db: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Station search for the claim flow — public, no auth required */
  async searchStations(query: string): Promise<StationSearchResult[]> {
    // Simple ILIKE search; no PostGIS here — free text by name/address/postcode
    return this.db.$queryRaw<StationSearchResult[]>`
      SELECT
        s.id,
        s.name,
        s.address,
        s.brand,
        s.voivodeship,
        CASE
          WHEN EXISTS (
            SELECT 1 FROM "StationClaim" c
            WHERE c.station_id = s.id AND c.status = 'APPROVED'
          ) THEN 'verified'
          WHEN EXISTS (
            SELECT 1 FROM "StationClaim" c
            WHERE c.station_id = s.id AND c.status = 'PENDING'
          ) THEN 'pending'
          ELSE 'unclaimed'
        END AS claim_status
      FROM "Station" s
      WHERE
        s.name ILIKE ${'%' + query + '%'}
        OR s.address ILIKE ${'%' + query + '%'}
      ORDER BY s.name
      LIMIT 20
    `;
  }

  /** Partner /me — returns role + managedStationId if applicable */
  async getPartnerMe(userId: string): Promise<{ role: string; managedStationId?: string }> {
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { role: true },
    });

    if (user.role !== 'STATION_MANAGER') {
      return { role: user.role };
    }

    const claim = await this.db.stationClaim.findFirst({
      where: { user_id: userId, status: 'APPROVED' },
      select: { station_id: true },
    });

    return {
      role: user.role,
      managedStationId: claim?.station_id ?? undefined,
    };
  }

  /** Initiate claim — validates pre-conditions, attempts domain match, creates StationClaim */
  async initiateClaim(
    userId: string,
    stationId: string,
    userEmail: string | null,
  ): Promise<ClaimInitiateResult> {
    // Pre-condition: no approved claim exists for this station
    const existingApproved = await this.db.stationClaim.findFirst({
      where: { station_id: stationId, status: 'APPROVED' },
    });
    if (existingApproved) {
      return { outcome: 'already_claimed' };
    }

    // Pre-condition: this user doesn't already have a pending claim for this station
    const existingPending = await this.db.stationClaim.findFirst({
      where: { station_id: stationId, user_id: userId, status: 'PENDING' },
    });
    if (existingPending) {
      return { outcome: 'already_pending', claimId: existingPending.id };
    }

    // Attempt domain match
    if (userEmail) {
      const domain = userEmail.split('@')[1]?.toLowerCase();
      const chainName = domain ? PartnerService.CHAIN_DOMAIN_MAP[domain] : undefined;

      if (chainName) {
        const station = await this.db.station.findUniqueOrThrow({
          where: { id: stationId },
          select: { brand: true },
        });

        // Brand must match the chain (case-insensitive)
        if (station.brand?.toLowerCase() === chainName.toLowerCase()) {
          return this.approveClaim(userId, stationId, 'DOMAIN_MATCH');
        }
      }
    }

    // Domain match failed — create PENDING claim (GBP OAuth or hard path next)
    const claim = await this.db.stationClaim.create({
      data: {
        station_id: stationId,
        user_id: userId,
        status: 'PENDING',
        method: 'GOOGLE_BUSINESS', // will be overwritten by whichever method succeeds
      },
    });

    return { outcome: 'pending', claimId: claim.id };
  }

  /** Called from GBP OAuth callback after successful GBP verification */
  async approveGbpClaim(userId: string, stationId: string): Promise<void> {
    await this.approveClaim(userId, stationId, 'GOOGLE_BUSINESS');
  }

  private async approveClaim(
    userId: string,
    stationId: string,
    method: 'GOOGLE_BUSINESS' | 'DOMAIN_MATCH',
  ): Promise<ClaimInitiateResult> {
    // Upsert claim as APPROVED
    await this.db.stationClaim.upsert({
      where: { station_id_user_id: { station_id: stationId, user_id: userId } },
      create: {
        station_id: stationId,
        user_id: userId,
        status: 'APPROVED',
        method,
        reviewed_at: new Date(),
      },
      update: {
        status: 'APPROVED',
        method,
        reviewed_at: new Date(),
      },
    });

    // Upgrade user role to STATION_MANAGER
    await this.db.user.update({
      where: { id: userId },
      data: { role: 'STATION_MANAGER' },
    });

    return { outcome: 'approved', stationId };
  }

  /** Generate GBP OAuth URL and store state in Redis */
  async generateGbpOAuthUrl(userId: string, stationId: string): Promise<string> {
    const state = `${userId}:${stationId}:${Date.now()}`;
    const encoded = Buffer.from(state).toString('base64url');

    // Store state in Redis — 10 min TTL
    await this.redis.set(`gbp:oauth:state:${encoded}`, JSON.stringify({ userId, stationId }), 'EX', 600);

    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_BUSINESS_CLIENT_ID!,
      redirect_uri: `${process.env.API_PUBLIC_URL}/v1/partner/claims/google-business/callback`,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/business.manage',
      access_type: 'online',
      state: encoded,
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  /** GBP OAuth callback — exchanges code, calls GBP API, checks if station place ID is in managed locations */
  async handleGbpCallback(code: string, state: string): Promise<GbpCallbackResult> {
    // Validate state from Redis
    const raw = await this.redis.get(`gbp:oauth:state:${state}`);
    if (!raw) return { success: false, reason: 'state_expired' };

    const { userId, stationId } = JSON.parse(raw) as { userId: string; stationId: string };
    await this.redis.del(`gbp:oauth:state:${state}`); // one-time use

    // Exchange authorization code for access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_BUSINESS_CLIENT_ID!,
        client_secret: process.env.GOOGLE_BUSINESS_CLIENT_SECRET!,
        redirect_uri: `${process.env.API_PUBLIC_URL}/v1/partner/claims/google-business/callback`,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) return { success: false, reason: 'token_exchange_failed' };
    const { access_token } = (await tokenRes.json()) as { access_token: string };

    // Get station's google_places_id from DB
    const station = await this.db.station.findUnique({
      where: { id: stationId },
      select: { google_places_id: true },
    });

    if (!station?.google_places_id) return { success: false, reason: 'no_places_id', userId, stationId };

    // Fetch GBP managed locations
    // GBP API v1 — list locations across all accounts
    const accountsRes = await fetch(
      'https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
      { headers: { Authorization: `Bearer ${access_token}` } },
    );

    if (!accountsRes.ok) return { success: false, reason: 'gbp_api_failed', userId, stationId };
    const { accounts } = (await accountsRes.json()) as { accounts?: Array<{ name: string }> };

    for (const account of accounts ?? []) {
      const locRes = await fetch(
        `https://mybusinessinformation.googleapis.com/v1/${account.name}/locations?readMask=name,metadata`,
        { headers: { Authorization: `Bearer ${access_token}` } },
      );

      if (!locRes.ok) continue;
      const { locations } = (await locRes.json()) as {
        locations?: Array<{ metadata?: { placeId?: string } }>;
      };

      const match = (locations ?? []).some(
        (loc) => loc.metadata?.placeId === station.google_places_id,
      );

      if (match) {
        await this.approveGbpClaim(userId, stationId);
        return { success: true, userId, stationId };
      }
    }

    return { success: false, reason: 'no_gbp_match', userId, stationId };
  }
}

// Types (local to this module)
type ClaimInitiateResult =
  | { outcome: 'already_claimed' }
  | { outcome: 'already_pending'; claimId: string }
  | { outcome: 'pending'; claimId: string }
  | { outcome: 'approved'; stationId: string };

type GbpCallbackResult =
  | { success: true; userId: string; stationId: string }
  | { success: false; reason: string; userId?: string; stationId?: string };

interface StationSearchResult {
  id: string;
  name: string;
  address: string | null;
  brand: string | null;
  voivodeship: string | null;
  claim_status: 'unclaimed' | 'pending' | 'verified';
}
```

### partner.controller.ts

```typescript
@Controller('v1/partner')
export class PartnerController {
  constructor(private readonly partnerService: PartnerService) {}

  /** GET /v1/partner/me — authenticated */
  @Get('me')
  async getMe(@CurrentUser() user: User) {
    return this.partnerService.getPartnerMe(user.id);
  }

  /** GET /v1/partner/stations/search?q=... — public */
  @Public()
  @Get('stations/search')
  async searchStations(@Query('q') q: string) {
    if (!q || q.trim().length < 2) return [];
    return this.partnerService.searchStations(q.trim());
  }

  /** POST /v1/partner/claims — authenticated, initiate claim */
  @Post('claims')
  async initiateClaim(
    @CurrentUser() user: User,
    @Body() dto: InitiateClaimDto,
  ) {
    return this.partnerService.initiateClaim(user.id, dto.stationId, user.email);
  }

  /** GET /v1/partner/claims/google-business/start?stationId=... — authenticated, returns OAuth URL */
  @Get('claims/google-business/start')
  async startGbpOAuth(@CurrentUser() user: User, @Query('stationId') stationId: string) {
    const url = await this.partnerService.generateGbpOAuthUrl(user.id, stationId);
    return { url };
  }

  /** GET /v1/partner/claims/google-business/callback — public, browser redirect from Google */
  @Public()
  @Get('claims/google-business/callback')
  async gbpCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() reply: FastifyReply,
  ) {
    const partnerAppUrl = process.env.PARTNER_APP_URL ?? 'http://localhost:3004';
    const result = await this.partnerService.handleGbpCallback(code, state);

    if (result.success) {
      // Role upgraded — user must re-login to get fresh JWT with STATION_MANAGER role
      reply.redirect(
        `${partnerAppUrl}/login?message=verified&redirect=/station/${result.stationId}`,
      );
    } else {
      reply.redirect(`${partnerAppUrl}/claim/result?error=${result.reason}`);
    }
  }
}
```

### dto/initiate-claim.dto.ts

```typescript
import { IsUUID } from 'class-validator';

export class InitiateClaimDto {
  @IsUUID()
  stationId!: string;
}
```

### partner.module.ts

```typescript
@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [PartnerController],
  providers: [PartnerService],
  exports: [PartnerService],
})
export class PartnerModule {}
```

Register in `apps/api/src/app.module.ts`:
```typescript
import { PartnerModule } from './partner/partner.module.js';
// Add to imports array:
PartnerModule,
```

---

## Partner App Pages

### app/(partner)/claim/page.tsx (Station Search)

```typescript
// Server Component
import { Suspense } from 'react';
import StationSearch from '../../../components/StationSearch';

export default function ClaimPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; message?: string }>;
}) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="mb-2 text-2xl font-bold text-gray-900">Find your station</h1>
      <p className="mb-8 text-sm text-gray-500">
        Search by station name, address, or postcode
      </p>
      <Suspense>
        <StationSearch searchParamsPromise={searchParams} />
      </Suspense>
    </main>
  );
}
```

### app/(partner)/claim/[stationId]/page.tsx (Claim Initiation)

```typescript
// Server Component — loads station detail, shows claim options
import { partnerFetch } from '../../../../lib/partner-api';
import { redirect } from 'next/navigation';
import ClaimOptionsPanel from '../../../../components/ClaimOptionsPanel';

export default async function ClaimStationPage({
  params,
  searchParams,
}: {
  params: Promise<{ stationId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { stationId } = await params;
  const { error } = await searchParams;

  // Load station detail + current user role
  const [station, me] = await Promise.all([
    partnerFetch<StationDetail>(`/v1/partner/stations/${stationId}`),
    partnerFetch<{ role: string }>('/v1/partner/me'),
  ]);

  // Already a STATION_MANAGER → go to management screen
  if (me.role === 'STATION_MANAGER') {
    redirect(`/station/${stationId}`);
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <ClaimOptionsPanel station={station} error={error} />
    </main>
  );
}
```

### components/ClaimOptionsPanel.tsx (Client Component)

```typescript
'use client';
// Renders:
// - Station name, address, brand badge
// - Claim status badge (unclaimed / pending / verified)
// - "Verify with Google Business Profile" button → calls GET /v1/partner/claims/google-business/start,
//   then window.location.href = url to redirect to Google OAuth
// - "Verify with domain email" section:
//   - Shows detected domain from user's account email
//   - "Try domain match" button → POST /v1/partner/claims {stationId}
//   - Success → refresh page; fail → show message
// - Hard path CTA (if easy path exhausted): "Need manual verification? →"
```

### app/(partner)/station/[stationId]/page.tsx (Management Screen placeholder)

```typescript
// Server Component — requires STATION_MANAGER role
import { partnerFetch, PartnerApiError } from '../../../../lib/partner-api';
import { redirect } from 'next/navigation';

export default async function StationManagementPage({
  params,
}: {
  params: Promise<{ stationId: string }>;
}) {
  const { stationId } = await params;

  let me: { role: string; managedStationId?: string };
  try {
    me = await partnerFetch('/v1/partner/me');
  } catch (e) {
    if (e instanceof PartnerApiError && e.status === 401) redirect('/login');
    throw e;
  }

  // Enforce ownership: STATION_MANAGER and managing THIS station
  if (me.role !== 'STATION_MANAGER' || me.managedStationId !== stationId) {
    redirect('/claim');
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Station Management</h1>
      {/* Story 7.3 fills price update panel */}
      {/* Story 7.4 fills performance metrics panel */}
      <p className="text-sm text-gray-500">
        Station ID: {stationId} — more features coming soon.
      </p>
    </main>
  );
}
```

### app/login/page.tsx

```typescript
// Mirrors apps/admin login page exactly.
// Reads ?message=verified → shows banner: "Account verified — please log in to continue"
// Reads ?redirect=... → passes to loginAction for post-login redirect
```

---

## Monorepo Integration

### pnpm-workspace.yaml

No change needed — all `apps/*` are already included.

### turbo.json

No change needed — all tasks (`build`, `dev`, `lint`, `type-check`, `test`) are defined globally and apply to `apps/partner` automatically.

### CI/CD — `.github/workflows/deploy.yml` (or equivalent)

Add a new Vercel deploy step for `apps/partner`, following the same pattern as the existing `apps/web` and `apps/admin` Vercel deploy steps. New environment:
- `VERCEL_PROJECT_ID_PARTNER` — new Vercel project
- `VERCEL_ORG_ID` — same as existing

### vercel.json (apps/partner)

```json
{
  "buildCommand": "cd ../.. && pnpm turbo build --filter=@desert/partner",
  "outputDirectory": ".next",
  "framework": "nextjs"
}
```

---

## Environment Variables

### apps/api — new vars

```env
GOOGLE_BUSINESS_CLIENT_ID=         # OAuth client for GBP verification (different from sign-in client)
GOOGLE_BUSINESS_CLIENT_SECRET=
API_PUBLIC_URL=https://api.desert.app  # Used to build OAuth callback redirect_uri
PARTNER_APP_URL=https://partner.desert.app  # Used to redirect after GBP callback
```

### apps/partner — new vars

```env
API_URL=http://localhost:3001      # internal API URL (server-side fetches)
NEXT_PUBLIC_API_URL=               # public API URL (client-side, if needed)
NODE_ENV=production
```

---

## Dev Notes

### Role upgrade and token refresh
After a claim is approved (either via GBP or domain match), the user's `role` is upgraded to `STATION_MANAGER` in the database, but their existing `partner_token` JWT still contains the old `DRIVER` role (JWTs are stateless). The GBP callback redirects to `/login?message=verified&redirect=/station/{stationId}` — the user sees a "Your station has been verified!" banner and logs in again to get a fresh token. This is intentional UX — not a bug. The login form passes `redirectTo` to `loginAction` which redirects after successful re-auth.

### GBP API — accounts with many locations
Large chains (ORLEN ~1,800 locations) may require pagination. The GBP Locations list API returns a `nextPageToken`. For MVP, iterate up to 3 pages max (300 locations per page = 900 locations checked). This covers the realistic scenario: a manager claiming a single station will typically have a small managed location set (1–10 stations). A chain manager claiming thousands is handled by Story 7.6 (domain match covers chain emails anyway, GBP path is mostly for independents).

```typescript
// Pagination guard in handleGbpCallback:
let pageToken: string | undefined;
const MAX_PAGES = 3;
let page = 0;

while (page < MAX_PAGES) {
  const url = `https://mybusinessinformation.googleapis.com/v1/${account.name}/locations?readMask=name,metadata${pageToken ? `&pageToken=${pageToken}` : ''}`;
  const locRes = await fetch(url, { headers: { Authorization: `Bearer ${access_token}` } });
  // ... check locations, set pageToken from response ...
  page++;
  if (!pageToken) break;
}
```

### Domain match: email must be verified
The `initiateClaim` service reads `user.email` from the JWT-authenticated user record. Since users registered via `POST /v1/auth/register` (email+password), and SuperTokens can enforce email verification, be aware that at MVP we do NOT enforce email verification in the registration flow. The domain match is therefore trust-based — a user claiming `manager@orlen.pl` is trusted to own that email because they signed up with it. This is acceptable for MVP; email verification can be added post-launch if fraud is observed.

### Station search: minimum query length
The `/v1/partner/stations/search?q=` endpoint requires `q.length >= 2` (enforced in controller). This prevents full-table scans. ILIKE on `name` and `address` is fast enough for MVP — both fields have a GIN index from the Google Places sync (Story 2.1). If not, add `@@index([name])` to `Station` in the schema.

### Claim uniqueness constraint
`StationClaim` has `@@unique([station_id, user_id])`. If `initiateClaim` is called concurrently (double-tap), Prisma will throw a P2002 on the second `create`. Wrap the create in a try/catch for P2002 and return `{ outcome: 'already_pending' }`.

### Google Business Profile API — quota
GBP API calls are user-triggered (one call per claim attempt) — not background jobs. Each claim attempt makes at most ~3 API calls (accounts list, 1–3 pages of locations). No cost concern.

### Story 7.2 integration point
When the hard path (7.2) is built, it will:
1. Find the `StationClaim` record created by `initiateClaim` (outcome `pending`)
2. Update `method` to `PHONE_SMS` or `DOCUMENT_UPLOAD`
3. Handle the ops review queue

The `StationClaim.method` field is set to `GOOGLE_BUSINESS` at creation (as an intent) and will be updated when the actual verification method succeeds. Story 7.2 should update `method` on the existing PENDING record — not create a new one.

### Station model — no `phone` field yet
The GBP callback flow uses `Station.google_places_id` to match against GBP locations. The phone verification in Story 7.2 will need a phone number from the Google Places API (fetched live, not stored). Do not add `phone` to the Station model in this story.

### Consent
No new data use beyond existing auth/account data. No new consent AC required for this story. The `StationClaim` record is an operational record tied to the user's service account — covered by the existing `CORE_SERVICE` consent.

---

## Tasks

- [ ] **Schema:** Add `ClaimStatus`, `ClaimMethod` enums and `StationClaim` model to `packages/db/prisma/schema.prisma`; add `claims` relation to `Station`, `stationClaims` relation to `User`; run `prisma migrate dev --name add_station_claim`
- [ ] **API:** Create `apps/api/src/partner/` module with `PartnerModule`, `PartnerController`, `PartnerService`, `InitiateClaimDto`
- [ ] **API:** Register `PartnerModule` in `apps/api/src/app.module.ts`
- [ ] **API:** Add `GOOGLE_BUSINESS_CLIENT_ID`, `GOOGLE_BUSINESS_CLIENT_SECRET`, `API_PUBLIC_URL`, `PARTNER_APP_URL` to `apps/api/.env.example` and Railway/production env
- [ ] **App scaffold:** Create `apps/partner/` with `package.json`, `next.config.ts`, `tsconfig.json`, `postcss.config.mjs`, `eslint.config.mjs`, `globals.css`
- [ ] **App scaffold:** Create `apps/partner/middleware.ts` (JWT gate, any authenticated role)
- [ ] **App scaffold:** Create `apps/partner/lib/partner-api.ts` and `apps/partner/lib/i18n.ts` (copy and adapt from admin)
- [ ] **App:** Implement `app/login/` (page + actions + LoginForm) — with `?message=verified` banner and `?redirect=` support
- [ ] **App:** Implement `app/register/` (page + actions + RegisterForm)
- [ ] **App:** Implement `app/page.tsx` redirect logic (calls `/v1/partner/me`, routes by role)
- [ ] **App:** Implement `app/(partner)/layout.tsx` — sidebar with "Find station" nav link, logout button
- [ ] **App:** Implement `app/(partner)/claim/page.tsx` and `StationSearch` component (calls `GET /v1/partner/stations/search`)
- [ ] **App:** Implement `app/(partner)/claim/[stationId]/page.tsx` and `ClaimOptionsPanel` (GBP OAuth start + domain match submit)
- [ ] **App:** Implement `app/(partner)/station/[stationId]/page.tsx` — management screen placeholder (role enforcement + empty state)
- [ ] **CI/CD:** Add `apps/partner` Vercel deploy step to deploy workflow; create Vercel project; add `VERCEL_PROJECT_ID_PARTNER` secret
- [ ] **Sprint status:** Mark 7.1 ready-for-dev in sprint-status.yaml

---

## Out of Scope

- Phone SMS verification (Story 7.2)
- Document upload and ops review queue (Story 7.2)
- Price update panel (Story 7.3)
- Performance metrics panel (Story 7.4)
- Chain registration (Story 7.6)
- Google OAuth sign-in for the partner portal itself (MVP uses email+password only; Google sign-in can be added post-MVP using existing `POST /v1/auth/google` endpoint)
