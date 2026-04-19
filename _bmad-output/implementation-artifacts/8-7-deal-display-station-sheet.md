# Story 8.7: Deal Display in Station Sheet

## Metadata
- **Epic:** 8 — Station Promotions & Advertising
- **Story ID:** 8.7
- **Status:** ready-for-dev
- **Date:** 2026-04-07
- **Depends on:** Story 8.6 (`Deal.status = APPROVED`, `DealStation` rows, daily expiry job), Story 2.5 (StationDetailSheet component — the consumer of this feature)
- **Required by:** None (final story in Epic 8)

---

## User Story

**As a driver,**
I want to see active promotional deals on a station's detail screen,
So that I know about special offers before deciding to fill up there.

---

## Context & Why

Deals are the claim that justifies a driver choosing one station over another. Showing them in the detail sheet — below the price list, above the Navigate button — means the driver sees them at exactly the moment they're making a decision. No active deals = no section (clean UI, no false expectations).

The "See full terms →" link opens the owner's proof URL in the device browser. This is the same URL ops verified in Story 8.6 — drivers get a direct path to the original offer source.

### Insertion Point in StationDetailSheet

Current sheet layout (top to bottom):
1. Handle + close button
2. Header (brand logo, station name, address)
3. Sponsored badge (Story 8.2)
4. Price list (or empty state)
5. **← Insert "Current offers" section here**
6. Navigate CTA button

---

## Acceptance Criteria

**Given** a driver taps a station pin and the detail sheet opens
**When** the station has 1–3 currently active approved deals (`status = APPROVED`, `start_date <= now`, `end_date > now`)
**Then** a "Current offers" section appears below the price list
**And** each deal shows: offer text, "Valid until [end date formatted as e.g. '31 Mar 2026']", and a "See full terms →" link

**Given** the driver taps "See full terms →"
**When** the link is opened
**Then** the deal's `proof_url` opens in the device's default browser (via `Linking.openURL`)

**Given** a station has more than 3 active deals (edge case — ops may have approved deals during a window where the 3-limit check was bypassed)
**When** the sheet renders
**Then** only the 3 deals with the nearest `end_date` are shown (soonest to expire first)

**Given** a station has no active deals
**When** the sheet renders
**Then** the "Current offers" section is omitted entirely — no heading, no empty state, no placeholder

**Given** a deal's `end_date` passes
**When** the driver next opens the station's detail sheet (fresh API call)
**Then** the expired deal is no longer returned by the API and is not shown

**Given** the driver's language is Polish, English, or Ukrainian
**When** the section renders
**Then** the section heading, date format, and "See full terms" link text are in the correct language
**And** the offer text itself is shown as-is (written by the owner, not translated)

---

## API Changes

### New Endpoint: GET /v1/stations/:stationId/deals

**Controller:** `StationController` (existing module in `apps/api/src/station/`)

```typescript
// GET /v1/stations/:stationId/deals
// @Public() — no auth required (deals are shown to all drivers including guests)
// @SkipThrottle() — very frequent calls when stations are selected

@Get(':stationId/deals')
@Public()
@SkipThrottle()
async getStationDeals(@Param('stationId') stationId: string): Promise<ActiveDealDto[]> {
  return this.stationService.getActiveDeals(stationId);
}
```

**Response type:**

```typescript
// apps/api/src/station/dto/active-deal.dto.ts
export class ActiveDealDto {
  id: string;
  offerText: string;
  proofUrl: string;
  endDate: string;   // ISO datetime string
}
```

**StationService — getActiveDeals:**

```typescript
// apps/api/src/station/station.service.ts

async getActiveDeals(stationId: string): Promise<ActiveDealDto[]> {
  const now = new Date();
  const deals = await this.prisma.deal.findMany({
    where: {
      status: DealStatus.APPROVED,
      start_date: { lte: now },
      end_date: { gt: now },
      deal_stations: {
        some: { station_id: stationId },
      },
    },
    orderBy: { end_date: 'asc' },  // nearest expiry first
    take: 3,                        // max 3 shown
    select: {
      id: true,
      offer_text: true,
      proof_url: true,
      end_date: true,
    },
  });

  return deals.map(d => ({
    id: d.id,
    offerText: d.offer_text,
    proofUrl: d.proof_url,
    endDate: d.end_date.toISOString(),
  }));
}
```

**No caching for MVP:** The query hits `@@index([status, start_date])` on `Deal` and `@@index([station_id, deal_id])` on `DealStation`. For most stations there will be 0 active deals — the query short-circuits quickly. Add Redis caching (key `deals:station:{stationId}`, TTL 5 min) post-MVP if load warrants.

**StationModule:** Import `DealModule` or access `DealStatus` enum directly from `@prisma/client` — no module import needed since `StationService` already has `PrismaService`.

---

## Mobile Changes

### New API Function

**File:** `apps/mobile/src/api/deals.ts` (new file)

```typescript
const API_BASE = process.env['EXPO_PUBLIC_API_URL'] ?? 'http://localhost:3001';

export type ActiveDealDto = {
  id: string;
  offerText: string;
  proofUrl: string;
  endDate: string;  // ISO datetime
};

export async function apiGetStationDeals(
  stationId: string,
  signal?: AbortSignal,
): Promise<ActiveDealDto[]> {
  const res = await fetch(`${API_BASE}/v1/stations/${stationId}/deals`, {
    method: 'GET',
    signal,
  });
  if (!res.ok) return [];  // silent degradation — deals are non-critical
  return res.json() as Promise<ActiveDealDto[]>;
}
```

Note: no auth token required. Returns `[]` on any error (deals display is best-effort — should never block the sheet from opening).

### StationDetailSheet — Deals Section

Add deals state and fetch to `StationDetailSheet`:

```typescript
// apps/mobile/src/components/StationDetailSheet.tsx

// Add import:
import { apiGetStationDeals, type ActiveDealDto } from '../api/deals';

// Add inside component (after existing state declarations):
const [deals, setDeals] = useState<ActiveDealDto[]>([]);

// Add useEffect — fetch deals when selected station changes:
useEffect(() => {
  if (!station?.id) {
    setDeals([]);
    return;
  }
  const controller = new AbortController();
  apiGetStationDeals(station.id, controller.signal)
    .then(setDeals)
    .catch(() => {});  // silent degradation
  return () => controller.abort();
}, [station?.id]);
```

**Render "Current offers" section** — insert between the price list block and the Navigate CTA button:

```tsx
{/* Current offers — only rendered when deals exist */}
{deals.length > 0 && (
  <View style={styles.dealsSection}>
    <Text style={styles.dealsSectionTitle}>{t('stationDetail.currentOffers')}</Text>
    {deals.map((deal, index) => (
      <View
        key={deal.id}
        style={[styles.dealRow, index === deals.length - 1 && styles.dealRowLast]}
      >
        <Text style={styles.dealOfferText} numberOfLines={3}>
          {deal.offerText}
        </Text>
        <View style={styles.dealFooter}>
          <Text style={styles.dealValidUntil}>
            {t('stationDetail.validUntil', {
              date: formatDealDate(deal.endDate),
            })}
          </Text>
          <TouchableOpacity
            onPress={() => Linking.openURL(deal.proofUrl).catch(() => {})}
            accessibilityRole="link"
            accessibilityLabel={t('stationDetail.seeFullTermsA11y', { offer: deal.offerText })}
          >
            <Text style={styles.dealTermsLink}>{t('stationDetail.seeFullTerms')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    ))}
  </View>
)}
```

### Date Formatting Helper

```typescript
// In StationDetailSheet.tsx (or apps/mobile/src/utils/formatDate.ts if reused elsewhere):

function formatDealDate(isoString: string): string {
  const date = new Date(isoString);
  // Use Intl.DateTimeFormat for localised date
  // i18next locale → Intl locale map: pl → 'pl-PL', en → 'en-GB', uk → 'uk-UA'
  const locale = i18n.language === 'pl' ? 'pl-PL' : i18n.language === 'uk' ? 'uk-UA' : 'en-GB';
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}
// Output examples:
//   pl-PL: "31 mar 2026"
//   en-GB: "31 Mar 2026"
//   uk-UA: "31 бер. 2026 р."
```

Import `i18n` instance from `../i18n/index` (already used elsewhere in the mobile app).

### New Styles

```typescript
// Add to StyleSheet.create in StationDetailSheet.tsx:

dealsSection: {
  marginTop: 16,
  paddingTop: 16,
  borderTopWidth: StyleSheet.hairlineWidth,
  borderTopColor: tokens.neutral.n200,
},
dealsSectionTitle: {
  fontSize: 13,
  fontWeight: '700',
  color: tokens.neutral.n500,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  marginBottom: 10,
},
dealRow: {
  paddingVertical: 10,
  borderBottomWidth: StyleSheet.hairlineWidth,
  borderBottomColor: tokens.neutral.n100,
},
dealRowLast: {
  borderBottomWidth: 0,
},
dealOfferText: {
  fontSize: 14,
  fontWeight: '500',
  color: tokens.neutral.n900,
  lineHeight: 20,
  marginBottom: 6,
},
dealFooter: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
},
dealValidUntil: {
  fontSize: 12,
  color: tokens.neutral.n500,
},
dealTermsLink: {
  fontSize: 12,
  fontWeight: '600',
  color: tokens.brand.primary,  // or tokens.neutral.n900 if no brand primary token
},
```

Use `tokens.brand.primary` if available in the theme — check `apps/mobile/src/theme/tokens.ts`. If no brand primary colour token exists, use `'#2563eb'` (blue-600) as a safe default.

---

## i18n Strings

```typescript
// apps/mobile/src/i18n/locales/en.ts
stationDetail: {
  // ... existing keys ...
  currentOffers: 'Current offers',
  validUntil: 'Valid until {{date}}',
  seeFullTerms: 'See full terms →',
  seeFullTermsA11y: 'See full terms for: {{offer}}',
},

// apps/mobile/src/i18n/locales/pl.ts
stationDetail: {
  // ... existing keys ...
  currentOffers: 'Aktualne oferty',
  validUntil: 'Ważne do {{date}}',
  seeFullTerms: 'Szczegóły →',
  seeFullTermsA11y: 'Szczegóły oferty: {{offer}}',
},

// apps/mobile/src/i18n/locales/uk.ts
stationDetail: {
  // ... existing keys ...
  currentOffers: 'Поточні акції',
  validUntil: 'Дійсно до {{date}}',
  seeFullTerms: 'Умови акції →',
  seeFullTermsA11y: 'Умови акції: {{offer}}',
},
```

---

## Tasks / Subtasks

- [ ] API: `getActiveDeals()` in StationService (AC: 1, 3, 5)
  - [ ] Prisma query: `Deal WHERE status=APPROVED AND start_date<=now AND end_date>now AND deal_stations.some(station_id=X)`
  - [ ] `orderBy: end_date asc`, `take: 3`
  - [ ] Map to `ActiveDealDto`

- [ ] API: `GET /v1/stations/:stationId/deals` endpoint (AC: 1, 4, 5)
  - [ ] `@Public() @SkipThrottle()` decorators
  - [ ] Register in StationController

- [ ] Mobile: `apps/mobile/src/api/deals.ts` (AC: 1)
  - [ ] `ActiveDealDto` type
  - [ ] `apiGetStationDeals()` with silent error degradation

- [ ] Mobile: StationDetailSheet — deals state + useEffect fetch (AC: 1, 4, 5)
  - [ ] `useState<ActiveDealDto[]>([])` + `useEffect` on `station?.id`
  - [ ] AbortController cleanup on station change
  - [ ] Import `apiGetStationDeals` from `../api/deals`

- [ ] Mobile: StationDetailSheet — "Current offers" render section (AC: 1, 2, 3, 4)
  - [ ] Conditional render only when `deals.length > 0`
  - [ ] Section heading
  - [ ] Deal rows: offer text, "Valid until" date, "See full terms →" link
  - [ ] `Linking.openURL(deal.proofUrl)` with `.catch(() => {})`

- [ ] Mobile: `formatDealDate()` helper (AC: 6)
  - [ ] `Intl.DateTimeFormat` with locale mapping

- [ ] Mobile: New styles for deals section (AC: 1)
  - [ ] `dealsSection`, `dealsSectionTitle`, `dealRow`, `dealRowLast`
  - [ ] `dealOfferText`, `dealFooter`, `dealValidUntil`, `dealTermsLink`
  - [ ] Check for `tokens.brand.primary` — fallback to `'#2563eb'` if absent

- [ ] Mobile: i18n strings — `stationDetail.currentOffers/validUntil/seeFullTerms` in pl/en/uk (AC: 6)

---

## Dev Notes

### Silent Degradation

`apiGetStationDeals()` returns `[]` on any fetch error — network issues or API errors must never cause the station detail sheet to fail to open. Deals are additive, non-critical information. The `useEffect` `.catch(() => {})` swallows all errors silently.

### AbortController Cleanup

The `useEffect` cleanup aborts the in-flight fetch when `station?.id` changes (user taps a different pin before the first fetch completes). This prevents a slow response from an earlier station overwriting deals for the currently-selected station.

### `Linking.openURL` — URL Safety

The `proof_url` values were validated by ops in Story 8.6 before approval. However, `Linking.openURL` on mobile will attempt to open any URL scheme — `http://`, `https://`, or even custom schemes. Add a guard:

```typescript
const url = deal.proofUrl;
if (url.startsWith('https://') || url.startsWith('http://')) {
  Linking.openURL(url).catch(() => {});
}
```

This prevents a malformed proof_url (e.g. `javascript:` or `file://`) from causing unexpected behaviour, even though ops already validated it.

### `Intl.DateTimeFormat` — React Native Support

`Intl.DateTimeFormat` is available in React Native via Hermes (the JS engine). Hermes includes full Intl support from React Native 0.70+. No polyfill needed.

Verify Hermes is enabled in `apps/mobile/app.json` (it is enabled by default for Expo SDK 49+). If somehow disabled, fall back to:
```typescript
// Fallback manual formatter:
const d = new Date(isoString);
const day = d.getDate();
const month = d.toLocaleString(locale, { month: 'short' });
const year = d.getFullYear();
return `${day} ${month} ${year}`;
```

### No Loading State in StationDetailSheet

The deals fetch is fire-and-forget. No loading spinner for the deals section — it simply doesn't appear until the fetch resolves. For the typical case (0 active deals), the API returns immediately with `[]`. For stations with active deals, a brief delay of ~100–300ms means the section "pops in" after the sheet opens. This is acceptable for MVP — add a skeleton loader post-MVP if user testing reveals it's jarring.

### `tokens.brand.primary`

Check `apps/mobile/src/theme/tokens.ts` before using `tokens.brand.primary`. If the token doesn't exist, use `'#2563eb'` inline in the stylesheet. Do NOT add a new token to the design system for this story — design token additions are a separate decision.

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
