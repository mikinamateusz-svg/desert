# Story 10.1: Public Fuel Price Web Portal

## Metadata
- **Epic:** 10 — Data Licensing & Public Portal
- **Story ID:** 10.1
- **Status:** ready-for-dev
- **Date:** 2026-04-08
- **Depends on:** Story 2.10 (apps/web scaffold, map view, INTERNAL_API_URL pattern), Story 2.14 (Station.voivodeship slug values), Story 2.11 (PriceHistory model, getRegionalAverage), Story 2.1 (Station model, upsertStation)
- **Required by:** Story 10.2 (public portal must exist for data buyer sign-up flow)

---

## User Story

**As a public user,**
I want to browse live fuel prices, station details, and regional price trends on the web without installing an app,
So that I can check prices and discover the platform before deciding to download the app.

---

## Context & Why

`apps/web` already renders the live station map (Story 2.10). This story adds the two missing SEO surfaces — individual station pages and regional overview pages — and connects them via a search bar on the homepage. Together they capture search intent ("ceny paliwa Warszawa", "najtańsza stacja diesel Mazowieckie") at zero acquisition cost.

The data and infrastructure are already built. This is purely a new rendering surface.

### Voivodeship Slugs

`Station.voivodeship` already stores lowercase ASCII slugs (`mazowieckie`, `dolnoslaskie`, `slaskie` etc.) set by Story 2.14's `VOIVODESHIP_SLUGS` mapping. These map directly to URL paths — no additional conversion layer needed.

### Station Slugs

Station URLs require a stable, keyword-rich identifier. A `slug` field is added to `Station`: format `{slugified-name}-{id-prefix-8}` (e.g. `bp-mokotow-a1b2c3d4`). Generated on station creation/sync; never updated once set (URL stability for SEO).

---

## Acceptance Criteria

**Given** a public user visits the web portal homepage
**When** the page loads
**Then** they see the live station map and a search bar for city, postcode, or station name
**And** the page is server-side rendered for fast initial load

**Given** a user clicks on a station marker or submits a search result
**When** they arrive on the station detail page (`/stacja/[slug]`)
**Then** the page shows: station name, brand, address, current prices per fuel type with freshness labels, 30-day price history chart, and submission count
**And** a prominent app install banner is shown with App Store and Google Play links
**And** the page has a unique title, meta description, and JSON-LD (`schema.org/GasStation`) in the document head

**Given** a user visits a regional page (`/region/[voivodeship]`)
**When** the page renders
**Then** they see: average prices per fuel type, comparison to national average (delta in PLN/L), 30-day daily price trend, and a list of the 10 cheapest stations in the region sorted by diesel price

**Given** a voivodeship slug in the URL does not exist (e.g. `/region/unknown`)
**When** the page is requested
**Then** Next.js returns a 404

**Given** a station slug in the URL does not exist
**When** the page is requested
**Then** Next.js returns a 404 (via `notFound()`)

**Given** any page is rendered
**When** the HTML is inspected
**Then** no account or login is required — all content is public

---

## Schema Change — `Station.slug`

```prisma
model Station {
  // ... existing fields ...
  slug  String?  @unique   // SEO-friendly URL identifier, set on creation
}
```

**Migration name:** `add_station_slug`

**Backfill SQL** (run as part of the migration):

```sql
-- Transliterate Polish diacritics and generate slug from name + id prefix
UPDATE "Station"
SET slug = (
  regexp_replace(
    lower(
      translate(name,
        'ąćęłńóśźżĄĆĘŁŃÓŚŹŻ',
        'acelnoszzACELNOSZZ'
      )
    ),
    '[^a-z0-9]+', '-', 'g'
  )
  || '-'
  || substr(id, 1, 8)
)
WHERE slug IS NULL;
```

**Slug generation in `StationSyncService.upsertStation()`** — add after INSERT/UPDATE:

```typescript
// apps/api/src/station/station-sync.service.ts
import { generateStationSlug } from './station-slug.util';

// After upsert, set slug if not present:
await this.prisma.$executeRaw`
  UPDATE "Station"
  SET slug = ${generateStationSlug(s.name, stationId)}
  WHERE id = ${stationId} AND slug IS NULL
`;
```

```typescript
// apps/api/src/station/station-slug.util.ts
export function generateStationSlug(name: string, id: string): string {
  const translitMap: Record<string, string> = {
    'ą':'a','ć':'c','ę':'e','ł':'l','ń':'n','ó':'o','ś':'s','ź':'z','ż':'z',
    'Ą':'a','Ć':'c','Ę':'e','Ł':'l','Ń':'n','Ó':'o','Ś':'s','Ź':'z','Ż':'z',
  };
  const base = name
    .split('')
    .map((ch) => translitMap[ch] ?? ch)
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${base}-${id.slice(0, 8)}`;
}
```

---

## API Changes

### New Endpoints in StationController

**File:** `apps/api/src/station/station.controller.ts`

```typescript
// GET /v1/stations/slug/:slug — public, find station by slug
@Get('slug/:slug')
@Public()
async getBySlug(@Param('slug') slug: string): Promise<StationDetailDto> {
  return this.stationService.getBySlug(slug);
}

// GET /v1/stations/:stationId/price-history — public, 30-day chart data
@Get(':stationId/price-history')
@Public()
@SkipThrottle()
async getPriceHistory(
  @Param('stationId') stationId: string,
  @Query('days') daysStr?: string,
): Promise<PriceHistoryDto> {
  const days = Math.min(parseInt(daysStr ?? '30', 10) || 30, 90);
  return this.stationService.getPriceHistory(stationId, days);
}
```

**DTOs:**

```typescript
// apps/api/src/station/dto/station-detail.dto.ts
export class StationDetailDto {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  address: string | null;
  lat: number;
  lng: number;
  voivodeship: string | null;
  submissionCount: number;
  currentPrices: {
    fuelType: string;
    price: number;
    recordedAt: string;
    freshnessLabel: 'fresh' | 'stale' | 'unknown';
  }[];
}

// apps/api/src/station/dto/price-history.dto.ts
export class PriceHistoryDto {
  stationId: string;
  days: number;
  // One entry per day per fuel type (may have gaps)
  series: {
    fuelType: string;
    data: { date: string; price: number }[];
  }[];
}
```

**StationService additions:**

```typescript
// apps/api/src/station/station.service.ts

async getBySlug(slug: string): Promise<StationDetailDto> {
  const station = await this.prisma.station.findUnique({
    where: { slug },
  });
  if (!station) throw new NotFoundException('Station not found');

  // Latest price per fuel type
  const latestPrices = await this.prisma.$queryRaw<
    { fuel_type: string; price: number; recorded_at: Date }[]
  >`
    SELECT DISTINCT ON (fuel_type)
      fuel_type, price, recorded_at
    FROM "PriceHistory"
    WHERE station_id = ${station.id}
    ORDER BY fuel_type, recorded_at DESC
  `;

  // Submission count
  const submissionCount = await this.prisma.submission.count({
    where: { station_id: station.id },
  });

  const now = new Date();
  return {
    id: station.id,
    slug: station.slug!,
    name: station.name,
    brand: station.brand ?? null,
    address: station.address ?? null,
    lat: 0,  // set via PostGIS extraction — see note below
    lng: 0,
    voivodeship: station.voivodeship ?? null,
    submissionCount,
    currentPrices: latestPrices.map((p) => ({
      fuelType: p.fuel_type,
      price: p.price,
      recordedAt: p.recorded_at.toISOString(),
      freshnessLabel: freshnessLabel(p.recorded_at, now),
    })),
  };
}

async getPriceHistory(stationId: string, days: number): Promise<PriceHistoryDto> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await this.prisma.$queryRaw<
    { fuel_type: string; date: string; avg_price: number }[]
  >`
    SELECT
      fuel_type,
      TO_CHAR(DATE(recorded_at), 'YYYY-MM-DD') AS date,
      ROUND(AVG(price)::numeric, 2)::float       AS avg_price
    FROM "PriceHistory"
    WHERE station_id  = ${stationId}
      AND recorded_at >= ${since}
    GROUP BY fuel_type, DATE(recorded_at)
    ORDER BY fuel_type, date ASC
  `;

  // Group by fuel type
  const byFuelType = new Map<string, { date: string; price: number }[]>();
  for (const row of rows) {
    if (!byFuelType.has(row.fuel_type)) byFuelType.set(row.fuel_type, []);
    byFuelType.get(row.fuel_type)!.push({ date: row.date, price: row.avg_price });
  }

  return {
    stationId,
    days,
    series: Array.from(byFuelType.entries()).map(([fuelType, data]) => ({ fuelType, data })),
  };
}
```

**Note on lat/lng extraction in `getBySlug`:** `Station.location` is `geography(Point,4326)` — use a raw query to extract coordinates alongside the station record:

```typescript
const [stationWithCoords] = await this.prisma.$queryRaw<
  { id: string; name: string; brand: string | null; address: string | null;
    voivodeship: string | null; slug: string | null;
    lat: number; lng: number }[]
>`
  SELECT id, name, brand, address, voivodeship, slug,
    ST_Y(location::geometry) AS lat,
    ST_X(location::geometry) AS lng
  FROM "Station"
  WHERE slug = ${slug}
`;
if (!stationWithCoords) throw new NotFoundException('Station not found');
```

### New RegionController

**File:** `apps/api/src/region/region.controller.ts` (new module)

```typescript
@Controller('v1/regions')
export class RegionController {
  constructor(private readonly regionService: RegionService) {}

  // List all voivodeships with latest average diesel price
  @Get()
  @Public()
  @SkipThrottle()
  async listRegions(): Promise<RegionSummaryDto[]> {
    return this.regionService.listRegions();
  }

  // Regional stats for one voivodeship
  @Get(':voivodeship/stats')
  @Public()
  @SkipThrottle()
  async getRegionStats(
    @Param('voivodeship') voivodeship: string,
  ): Promise<RegionStatsDto> {
    return this.regionService.getStats(voivodeship);
  }
}
```

**RegionService:**

```typescript
// apps/api/src/region/region.service.ts

const VALID_VOIVODESHIPS = new Set([
  'dolnoslaskie','kujawsko-pomorskie','lubelskie','lubuskie','lodzkie',
  'malopolskie','mazowieckie','opolskie','podkarpackie','podlaskie',
  'pomorskie','slaskie','swietokrzyskie','warminsko-mazurskie',
  'wielkopolskie','zachodniopomorskie',
]);

@Injectable()
export class RegionService {
  constructor(private readonly prisma: PrismaService) {}

  async listRegions(): Promise<RegionSummaryDto[]> {
    // Latest avg diesel price per voivodeship — used on the region index page
    const rows = await this.prisma.$queryRaw<
      { voivodeship: string; avg_diesel: number | null; station_count: number }[]
    >`
      SELECT
        s.voivodeship,
        ROUND(AVG(CASE WHEN ph.fuel_type = 'ON' THEN ph.price END)::numeric, 2)::float AS avg_diesel,
        COUNT(DISTINCT s.id)::int AS station_count
      FROM "Station" s
      LEFT JOIN LATERAL (
        SELECT fuel_type, price
        FROM "PriceHistory"
        WHERE station_id = s.id
          AND recorded_at > NOW() - INTERVAL '7 days'
        ORDER BY recorded_at DESC
        LIMIT 5
      ) ph ON true
      WHERE s.voivodeship IS NOT NULL
      GROUP BY s.voivodeship
      ORDER BY s.voivodeship
    `;
    return rows.map((r) => ({
      voivodeship: r.voivodeship,
      avgDieselPln: r.avg_diesel,
      stationCount: r.station_count,
    }));
  }

  async getStats(voivodeship: string): Promise<RegionStatsDto> {
    if (!VALID_VOIVODESHIPS.has(voivodeship)) {
      throw new NotFoundException('Region not found');
    }
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Current average per fuel type for this voivodeship
    const regionalAvgs = await this.prisma.$queryRaw<
      { fuel_type: string; avg_price: number }[]
    >`
      SELECT ph.fuel_type, ROUND(AVG(ph.price)::numeric, 2)::float AS avg_price
      FROM (
        SELECT DISTINCT ON (station_id, fuel_type) station_id, fuel_type, price
        FROM "PriceHistory"
        WHERE recorded_at > ${since7d}
        ORDER BY station_id, fuel_type, recorded_at DESC
      ) ph
      JOIN "Station" s ON s.id = ph.station_id
      WHERE s.voivodeship = ${voivodeship}
      GROUP BY ph.fuel_type
    `;

    // National averages (same query, no voivodeship filter)
    const nationalAvgs = await this.prisma.$queryRaw<
      { fuel_type: string; avg_price: number }[]
    >`
      SELECT fuel_type, ROUND(AVG(price)::numeric, 2)::float AS avg_price
      FROM (
        SELECT DISTINCT ON (station_id, fuel_type) station_id, fuel_type, price
        FROM "PriceHistory"
        WHERE recorded_at > ${since7d}
        ORDER BY station_id, fuel_type, recorded_at DESC
      ) ph
      GROUP BY fuel_type
    `;

    const nationalMap = new Map(nationalAvgs.map((n) => [n.fuel_type, n.avg_price]));

    // 30-day daily trend for this voivodeship
    const trend = await this.prisma.$queryRaw<
      { date: string; fuel_type: string; avg_price: number }[]
    >`
      SELECT
        TO_CHAR(DATE(ph.recorded_at), 'YYYY-MM-DD') AS date,
        ph.fuel_type,
        ROUND(AVG(ph.price)::numeric, 2)::float AS avg_price
      FROM "PriceHistory" ph
      JOIN "Station" s ON s.id = ph.station_id
      WHERE s.voivodeship = ${voivodeship}
        AND ph.recorded_at >= ${since30d}
      GROUP BY DATE(ph.recorded_at), ph.fuel_type
      ORDER BY date ASC, ph.fuel_type
    `;

    // Cheapest 10 stations (diesel) in this region
    const cheapest = await this.prisma.$queryRaw<
      { id: string; slug: string; name: string; address: string | null; price: number }[]
    >`
      SELECT DISTINCT ON (s.id)
        s.id, s.slug, s.name, s.address, ph.price
      FROM "Station" s
      JOIN "PriceHistory" ph ON ph.station_id = s.id
      WHERE s.voivodeship = ${voivodeship}
        AND ph.fuel_type = 'ON'
        AND ph.recorded_at > ${since7d}
      ORDER BY s.id, ph.recorded_at DESC
      LIMIT 10
    `;
    const sortedCheapest = cheapest.sort((a, b) => a.price - b.price);

    return {
      voivodeship,
      averagePrices: regionalAvgs.map((r) => ({
        fuelType: r.fuel_type,
        avgPln: r.avg_price,
        nationalAvgPln: nationalMap.get(r.fuel_type) ?? null,
        deltaPln: nationalMap.has(r.fuel_type)
          ? parseFloat((r.avg_price - nationalMap.get(r.fuel_type)!).toFixed(2))
          : null,
      })),
      cheapestStations: sortedCheapest.map((s) => ({
        stationId: s.id,
        slug: s.slug,
        name: s.name,
        address: s.address,
        dieselPricePln: s.price,
      })),
      dailyTrend: buildTrendSeries(trend),
    };
  }
}

function buildTrendSeries(
  rows: { date: string; fuel_type: string; avg_price: number }[],
): { fuelType: string; data: { date: string; price: number }[] }[] {
  const map = new Map<string, { date: string; price: number }[]>();
  for (const row of rows) {
    if (!map.has(row.fuel_type)) map.set(row.fuel_type, []);
    map.get(row.fuel_type)!.push({ date: row.date, price: row.avg_price });
  }
  return Array.from(map.entries()).map(([fuelType, data]) => ({ fuelType, data }));
}
```

**Freshness helper:**

```typescript
// apps/api/src/station/station.service.ts
function freshnessLabel(recordedAt: Date, now: Date): 'fresh' | 'stale' | 'unknown' {
  const hoursAgo = (now.getTime() - recordedAt.getTime()) / (1000 * 60 * 60);
  if (hoursAgo < 24) return 'fresh';
  if (hoursAgo < 72) return 'stale';
  return 'unknown';
}
```

**Register new `RegionModule` in `AppModule`.**

---

## `apps/web` Changes

### Package

```bash
# Install in apps/web
pnpm add recharts
```

### New File Structure

```
apps/web/
├── app/
│   ├── page.tsx                         (existing — add SearchBar)
│   ├── stacja/
│   │   └── [slug]/
│   │       └── page.tsx                 (new — station detail)
│   └── region/
│       ├── page.tsx                     (new — region index)
│       └── [voivodeship]/
│           └── page.tsx                 (new — regional stats)
├── components/
│   ├── AppBanner.tsx                    (new)
│   ├── PriceHistoryChart.tsx            (new — Client Component)
│   ├── RegionTrendChart.tsx             (new — Client Component)
│   └── SearchBar.tsx                    (new — Client Component)
└── lib/
    └── api.ts                           (existing — add new fetch functions)
```

### `lib/api.ts` additions

```typescript
// apps/web/lib/api.ts (add to existing file)
const API_URL = process.env['INTERNAL_API_URL'] ?? 'http://localhost:3001';

export async function fetchStationBySlug(slug: string) {
  const res = await fetch(`${API_URL}/v1/stations/slug/${slug}`, {
    next: { revalidate: 300 },  // 5-minute cache for station detail
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Failed to fetch station');
  return res.json() as Promise<StationDetailDto>;
}

export async function fetchStationPriceHistory(stationId: string, days = 30) {
  const res = await fetch(`${API_URL}/v1/stations/${stationId}/price-history?days=${days}`, {
    next: { revalidate: 3600 },  // 1-hour cache — history doesn't change rapidly
  });
  if (!res.ok) return null;
  return res.json() as Promise<PriceHistoryDto>;
}

export async function fetchRegionStats(voivodeship: string) {
  const res = await fetch(`${API_URL}/v1/regions/${voivodeship}/stats`, {
    next: { revalidate: 1800 },  // 30-minute cache
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Failed to fetch region stats');
  return res.json() as Promise<RegionStatsDto>;
}

export async function fetchRegionList() {
  const res = await fetch(`${API_URL}/v1/regions`, {
    next: { revalidate: 3600 },
  });
  if (!res.ok) return [];
  return res.json() as Promise<RegionSummaryDto[]>;
}
```

### Station Detail Page

**File:** `apps/web/app/stacja/[slug]/page.tsx`

```tsx
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { fetchStationBySlug, fetchStationPriceHistory } from '../../../lib/api';
import AppBanner from '../../../components/AppBanner';
import PriceHistoryChart from '../../../components/PriceHistoryChart';

interface Props {
  params: { slug: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const station = await fetchStationBySlug(params.slug);
  if (!station) return { title: 'Stacja nie znaleziona' };

  const diesel = station.currentPrices.find((p) => p.fuelType === 'ON');
  const priceStr = diesel ? ` — ON ${diesel.price.toFixed(2)} PLN/L` : '';

  return {
    title: `${station.name}${priceStr} | Desert`,
    description: `Aktualne ceny paliw na stacji ${station.name}, ${station.address ?? ''}. Sprawdź ceny benzyny i diesla.`,
    openGraph: {
      title: `${station.name} — ceny paliw`,
      description: `Benzyna, diesel, LPG na ${station.name}`,
    },
  };
}

const FUEL_LABELS: Record<string, string> = {
  PB_95: 'Pb 95', PB_98: 'Pb 98', ON: 'Diesel', ON_PREMIUM: 'Diesel Premium', LPG: 'LPG',
};

const FRESHNESS_LABELS: Record<string, string> = {
  fresh: '< 24h', stale: '1–3 dni', unknown: 'dawniej',
};

export default async function StationDetailPage({ params }: Props) {
  const station = await fetchStationBySlug(params.slug);
  if (!station) notFound();

  const history = await fetchStationPriceHistory(station.id);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'GasStation',
    name: station.name,
    address: station.address ? {
      '@type': 'PostalAddress',
      streetAddress: station.address,
      addressCountry: 'PL',
    } : undefined,
    geo: station.lat && station.lng ? {
      '@type': 'GeoCoordinates',
      latitude: station.lat,
      longitude: station.lng,
    } : undefined,
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <main className="max-w-2xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-6">
          {station.brand && (
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              {station.brand}
            </span>
          )}
          <h1 className="text-2xl font-bold text-gray-900 mt-1">{station.name}</h1>
          {station.address && <p className="text-gray-500 mt-1">{station.address}</p>}
          <p className="text-xs text-gray-400 mt-1">
            {station.submissionCount} aktualizacji cenowych od społeczności
          </p>
        </div>

        {/* Current prices */}
        {station.currentPrices.length > 0 ? (
          <div className="mb-8">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Aktualne ceny
            </h2>
            <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 overflow-hidden">
              {station.currentPrices.map((p) => (
                <li key={p.fuelType} className="flex items-center justify-between px-4 py-3 bg-white">
                  <span className="text-sm font-medium text-gray-900">
                    {FUEL_LABELS[p.fuelType] ?? p.fuelType}
                  </span>
                  <div className="text-right">
                    <span className="text-lg font-bold text-gray-900">
                      {p.price.toFixed(2)} PLN/L
                    </span>
                    <span className="ml-2 text-xs text-gray-400">
                      {FRESHNESS_LABELS[p.freshnessLabel]}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-gray-400 mb-8">Brak aktualnych danych cenowych.</p>
        )}

        {/* Price history chart */}
        {history && history.series.length > 0 && (
          <div className="mb-8">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Historia cen (30 dni)
            </h2>
            <PriceHistoryChart series={history.series} />
          </div>
        )}

        {/* App install banner */}
        <AppBanner />

        {/* Region link */}
        {station.voivodeship && (
          <p className="mt-6 text-sm text-gray-400">
            Region:{' '}
            <a
              href={`/region/${station.voivodeship}`}
              className="text-blue-600 hover:underline capitalize"
            >
              {station.voivodeship.replace(/-/g, ' ')}
            </a>
          </p>
        )}
      </main>
    </>
  );
}
```

### Region Detail Page

**File:** `apps/web/app/region/[voivodeship]/page.tsx`

```tsx
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { fetchRegionStats } from '../../../lib/api';
import RegionTrendChart from '../../../components/RegionTrendChart';

interface Props { params: { voivodeship: string } }

const VOIVODESHIP_DISPLAY: Record<string, string> = {
  'dolnoslaskie': 'Dolnośląskie', 'kujawsko-pomorskie': 'Kujawsko-Pomorskie',
  'lubelskie': 'Lubelskie', 'lubuskie': 'Lubuskie', 'lodzkie': 'Łódzkie',
  'malopolskie': 'Małopolskie', 'mazowieckie': 'Mazowieckie', 'opolskie': 'Opolskie',
  'podkarpackie': 'Podkarpackie', 'podlaskie': 'Podlaskie', 'pomorskie': 'Pomorskie',
  'slaskie': 'Śląskie', 'swietokrzyskie': 'Świętokrzyskie',
  'warminsko-mazurskie': 'Warmińsko-Mazurskie', 'wielkopolskie': 'Wielkopolskie',
  'zachodniopomorskie': 'Zachodniopomorskie',
};

const FUEL_LABELS: Record<string, string> = {
  PB_95: 'Pb 95', PB_98: 'Pb 98', ON: 'Diesel', ON_PREMIUM: 'Diesel Premium', LPG: 'LPG',
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const name = VOIVODESHIP_DISPLAY[params.voivodeship];
  if (!name) return { title: 'Region nie znaleziony' };
  return {
    title: `Ceny paliw — ${name} | Desert`,
    description: `Średnie ceny benzyny, diesla i LPG w województwie ${name}. Najlepsze stacje i trendy cenowe.`,
  };
}

export default async function RegionPage({ params }: Props) {
  const stats = await fetchRegionStats(params.voivodeship);
  if (!stats) notFound();

  const displayName = VOIVODESHIP_DISPLAY[params.voivodeship] ?? params.voivodeship;
  const diesel = stats.averagePrices.find((p) => p.fuelType === 'ON');

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Ceny paliw — {displayName}</h1>
      {diesel && (
        <p className="text-gray-500 mb-6">
          Diesel: {diesel.avgPln.toFixed(2)} PLN/L
          {diesel.deltaPln != null && (
            <span className={diesel.deltaPln > 0 ? 'text-red-500 ml-2' : 'text-green-600 ml-2'}>
              {diesel.deltaPln > 0 ? `+${diesel.deltaPln.toFixed(2)}` : diesel.deltaPln.toFixed(2)} vs kraj
            </span>
          )}
        </p>
      )}

      {/* Average prices table */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Średnie ceny (ostatnie 7 dni)
        </h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-400 text-xs">
              <th className="pb-2 font-medium">Paliwo</th>
              <th className="pb-2 font-medium text-right">Województwo</th>
              <th className="pb-2 font-medium text-right">Kraj</th>
              <th className="pb-2 font-medium text-right">Różnica</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {stats.averagePrices.map((p) => (
              <tr key={p.fuelType}>
                <td className="py-2 font-medium">{FUEL_LABELS[p.fuelType] ?? p.fuelType}</td>
                <td className="py-2 text-right">{p.avgPln.toFixed(2)} PLN</td>
                <td className="py-2 text-right text-gray-400">
                  {p.nationalAvgPln != null ? `${p.nationalAvgPln.toFixed(2)} PLN` : '—'}
                </td>
                <td className={`py-2 text-right ${p.deltaPln != null && p.deltaPln > 0 ? 'text-red-500' : 'text-green-600'}`}>
                  {p.deltaPln != null ? `${p.deltaPln > 0 ? '+' : ''}${p.deltaPln.toFixed(2)}` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* 30-day trend chart */}
      {stats.dailyTrend.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Trend cenowy (30 dni)
          </h2>
          <RegionTrendChart series={stats.dailyTrend} />
        </section>
      )}

      {/* Cheapest stations */}
      {stats.cheapestStations.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Najtańszy diesel — stacje w regionie
          </h2>
          <ol className="space-y-2">
            {stats.cheapestStations.map((s, i) => (
              <li key={s.stationId} className="flex items-center gap-3">
                <span className="text-xs text-gray-400 w-4">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <a href={`/stacja/${s.slug}`} className="text-sm font-medium text-blue-600 hover:underline truncate block">
                    {s.name}
                  </a>
                  <p className="text-xs text-gray-400 truncate">{s.address}</p>
                </div>
                <span className="text-sm font-bold text-gray-900 whitespace-nowrap">
                  {s.dieselPricePln.toFixed(2)} PLN/L
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}
```

### Region Index Page

**File:** `apps/web/app/region/page.tsx`

```tsx
import type { Metadata } from 'next';
import { fetchRegionList } from '../../lib/api';

export const metadata: Metadata = {
  title: 'Ceny paliw według województw | Desert',
  description: 'Porównaj ceny paliw w każdym województwie Polski.',
};

export default async function RegionIndexPage() {
  const regions = await fetchRegionList();

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Ceny paliw według województw</h1>
      <ul className="divide-y divide-gray-100">
        {regions.map((r) => (
          <li key={r.voivodeship}>
            <a
              href={`/region/${r.voivodeship}`}
              className="flex items-center justify-between py-3 hover:bg-gray-50 px-2 -mx-2 rounded"
            >
              <span className="text-sm font-medium text-gray-900 capitalize">
                {r.voivodeship.replace(/-/g, ' ')}
              </span>
              <span className="text-sm text-gray-500">
                {r.avgDieselPln != null ? `ON ${r.avgDieselPln.toFixed(2)} PLN/L` : '—'}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

### Chart Components (Client Components)

**File:** `apps/web/components/PriceHistoryChart.tsx`

```tsx
'use client';

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const FUEL_COLORS: Record<string, string> = {
  ON: '#2563eb', PB_95: '#16a34a', PB_98: '#7c3aed', LPG: '#d97706', ON_PREMIUM: '#0891b2',
};
const FUEL_LABELS: Record<string, string> = {
  PB_95: 'Pb 95', PB_98: 'Pb 98', ON: 'Diesel', ON_PREMIUM: 'D. Premium', LPG: 'LPG',
};

interface Props {
  series: { fuelType: string; data: { date: string; price: number }[] }[];
}

export default function PriceHistoryChart({ series }: Props) {
  // Merge all series into a single date-keyed array for recharts
  const dateSet = new Set(series.flatMap((s) => s.data.map((d) => d.date)));
  const dates = Array.from(dateSet).sort();

  const chartData = dates.map((date) => {
    const entry: Record<string, any> = { date: date.slice(5) };  // MM-DD display
    for (const s of series) {
      const point = s.data.find((d) => d.date === date);
      if (point) entry[s.fuelType] = point.price;
    }
    return entry;
  });

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <XAxis dataKey="date" tick={{ fontSize: 10 }} />
        <YAxis
          domain={['auto', 'auto']}
          tick={{ fontSize: 10 }}
          tickFormatter={(v) => `${v.toFixed(2)}`}
          width={48}
        />
        <Tooltip formatter={(v: number) => `${v.toFixed(2)} PLN/L`} />
        <Legend formatter={(v) => FUEL_LABELS[v] ?? v} />
        {series.map((s) => (
          <Line
            key={s.fuelType}
            type="monotone"
            dataKey={s.fuelType}
            stroke={FUEL_COLORS[s.fuelType] ?? '#888'}
            strokeWidth={2}
            dot={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
```

**`RegionTrendChart`** — identical structure to `PriceHistoryChart`. Create as a separate file (`RegionTrendChart.tsx`) with the same implementation — both consume the same `series` prop shape.

### AppBanner Component

**File:** `apps/web/components/AppBanner.tsx`

```tsx
export default function AppBanner() {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-4 flex items-start gap-3">
      <span className="text-2xl">⛽</span>
      <div>
        <p className="text-sm font-semibold text-gray-900">
          Widzisz inne ceny? Zaktualizuj je w aplikacji desert.
        </p>
        <p className="text-xs text-gray-500 mt-0.5">
          Twoja aktualizacja pomoże tysiącom kierowców zaoszczędzić.
        </p>
        <div className="flex gap-3 mt-3">
          <a
            href="https://apps.apple.com/app/desert-ceny-paliw/idTBD"
            className="text-xs font-medium text-blue-600 hover:underline"
          >
            App Store →
          </a>
          <a
            href="https://play.google.com/store/apps/details?id=app.desert.fuelTBD"
            className="text-xs font-medium text-blue-600 hover:underline"
          >
            Google Play →
          </a>
        </div>
      </div>
    </div>
  );
}
```

**Note:** App Store / Google Play URLs are placeholders (`TBD`). Replace with real store links before go-live. Tracked in `project_deferred.md`.

### Homepage — Search Bar Addition

**File:** `apps/web/app/page.tsx`

Add `SearchBar` component above the map (minimal change — existing map remains intact):

```tsx
import SearchBar from '../components/SearchBar';

// In the page JSX, add above <MapView>:
<SearchBar />
```

**File:** `apps/web/components/SearchBar.tsx`

```tsx
'use client';

import { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';

const MAPBOX_TOKEN = process.env['NEXT_PUBLIC_MAPBOX_TOKEN'] ?? '';

interface Suggestion {
  id: string;
  place_name: string;
  center: [number, number];
  place_type: string[];
}

export default function SearchBar() {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  const fetchSuggestions = useCallback(async (q: string) => {
    if (q.length < 2) { setSuggestions([]); return; }
    const url =
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json` +
      `?country=pl&language=pl&types=place,postcode,address&limit=5&access_token=${MAPBOX_TOKEN}`;
    try {
      const res = await fetch(url);
      const data = await res.json() as { features: Suggestion[] };
      setSuggestions(data.features ?? []);
    } catch { setSuggestions([]); }
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value;
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(q), 300);
  }

  function handleSelect(s: Suggestion) {
    setQuery(s.place_name);
    setSuggestions([]);
    // Navigate to nearest region if it's a place, or keep on map
    // For MVP: just clear the suggestions and let the user browse the map
    // Post-MVP: pan the map to the selected location
  }

  return (
    <div className="relative w-full max-w-sm">
      <input
        type="text"
        value={query}
        onChange={handleChange}
        placeholder="Wyszukaj miasto, kod pocztowy..."
        className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm shadow-sm"
        autoComplete="off"
      />
      {suggestions.length > 0 && (
        <ul className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg">
          {suggestions.map((s) => (
            <li
              key={s.id}
              onClick={() => handleSelect(s)}
              className="px-4 py-2.5 text-sm cursor-pointer hover:bg-gray-50 truncate"
            >
              {s.place_name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

---

## Tasks / Subtasks

- [ ] API: `Station.slug` field + migration `add_station_slug` with backfill SQL (AC: 2)
  - [ ] `station-slug.util.ts` — `generateStationSlug()` with Polish diacritic transliteration
  - [ ] Add slug generation to `StationSyncService.upsertStation()`

- [ ] API: `StationService.getBySlug()` — raw SQL with lat/lng extraction (AC: 2, 5)
  - [ ] `StationService.getPriceHistory()` — daily averages grouped by fuel type (AC: 2)
  - [ ] `StationDetailDto` + `PriceHistoryDto` + freshness helper

- [ ] API: `GET /v1/stations/slug/:slug` + `GET /v1/stations/:stationId/price-history` in `StationController` (AC: 2)
  - [ ] `@Public()` on both

- [ ] API: `RegionModule` + `RegionController` + `RegionService` (AC: 3, 4)
  - [ ] `listRegions()` — avg diesel per voivodeship
  - [ ] `getStats()` — regional avgs, national comparison, 30-day trend, cheapest 10
  - [ ] `VALID_VOIVODESHIPS` set + 404 guard

- [ ] Web: `pnpm add recharts` in `apps/web`

- [ ] Web: `lib/api.ts` — add `fetchStationBySlug`, `fetchStationPriceHistory`, `fetchRegionStats`, `fetchRegionList` (AC: 2, 3)

- [ ] Web: `/stacja/[slug]/page.tsx` — station detail with SSR, `generateMetadata`, JSON-LD, prices, freshness, chart, AppBanner (AC: 2, 6)
  - [ ] `notFound()` on null station

- [ ] Web: `/region/[voivodeship]/page.tsx` — regional stats, price table, trend chart, cheapest stations, `generateMetadata` (AC: 3)
  - [ ] `notFound()` on null stats; `VOIVODESHIP_DISPLAY` map

- [ ] Web: `/region/page.tsx` — region index (AC: 3)

- [ ] Web: `PriceHistoryChart.tsx` + `RegionTrendChart.tsx` — recharts Client Components (AC: 2, 3)

- [ ] Web: `AppBanner.tsx` (AC: 2)

- [ ] Web: `SearchBar.tsx` + add to homepage (AC: 1)
  - [ ] Mapbox Geocoding client-side, 300ms debounce, `country=pl`

---

## Dev Notes

### `generateStaticParams` — Optional for SEO

For high-traffic station pages, add `generateStaticParams()` to pre-render the top N stations at build time:

```typescript
export async function generateStaticParams() {
  const stations = await fetchTopStations(500);  // top 500 by submission count
  return stations.map((s) => ({ slug: s.slug }));
}
```

With `revalidate: 300`, the remaining pages are rendered on first request (ISR). For MVP, skip `generateStaticParams` entirely — all pages render on-demand with ISR.

### Backfill Slug Quality

The SQL backfill uses a simple transliteration. Edge cases: stations with names that are entirely non-ASCII special characters (unlikely but possible), or stations where `name` is null (none expected — `name` is `NOT NULL`). The transliteration covers all standard Polish diacritics. Non-Polish characters (Cyrillic etc.) become hyphens — acceptable given the dataset is Polish fuel stations.

### `recharts` SSR Compatibility

recharts uses browser DOM APIs internally. Wrapping `PriceHistoryChart` in `'use client'` is sufficient — Next.js renders a loading fallback on the server and hydrates client-side. No `dynamic(() => import(...), { ssr: false })` wrapper needed in App Router (Client Components are already excluded from SSR).

### App Store / Google Play Links — Placeholder

`AppBanner.tsx` uses TBD app store URLs. These are added to `memory/project_deferred.md` (already tracked from Story 1.0). Replace before go-live.

### Station Slug Stability

Once set, a station slug must never change — changing it breaks inbound links and SEO ranking. The `upsertStation()` logic only sets slug when `slug IS NULL` (the SQL `WHERE slug IS NULL` guard). The backfill migration also uses `WHERE slug IS NULL`. Existing slugs are immutable.

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
