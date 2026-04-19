# Story 6.1: Price Drop Alerts

Status: ready-for-dev

## Story

As a **driver**,
I want to be notified when fuel prices drop at stations near me,
So that I never miss a chance to fill up cheaper without having to check the app constantly.

## Acceptance Criteria

**AC1 — Alert triggered on verified submission:**
Given a new price submission is verified and `PriceHistory` is written
When the verified price represents a drop below the threshold for any opted-in driver
Then a `price-drop-check` BullMQ job is enqueued with the station ID, fuel type, and new price
And the `PriceDropAlertService` evaluates each opted-in driver in the worker

**AC2 — "Cheaper than now" mode:**
Given a driver has `price_drop_enabled: true` and `price_drop_mode: 'cheaper_than_now'`
When a verified submission price for one of their `price_drop_fuel_types` is lower than the current minimum price in their voivodeship for that fuel type (from `PriceHistory` records in the last 7 days)
And the station is within their `alert_radius_km`
Then a push notification is sent: "PB95 dropped to 6.14 PLN/L at Circle K — cheaper than in your area"

**AC3 — "Target price" mode:**
Given a driver has `price_drop_enabled: true` and `price_drop_mode: 'target_price'`
When a verified submission price for one of their `price_drop_fuel_types` drops below their `price_drop_target_pln`
And the station is within their `alert_radius_km`
Then a push notification is sent: "PB95 hit your target price: 5.99 PLN/L at Orlen, 1.8km away"

**AC4 — Batched notification:**
Given multiple stations near a driver drop prices within a 30-minute window
When a `price-drop-check` job is processed for that driver
Then a single notification is sent listing the count: "Prices dropped at 3 stations near you — tap to see the cheapest"
And the notification deep-links to the station detail screen of the cheapest qualifying station
And only one notification per user per fuel type per 4 hours is sent (Redis dedup)

**AC5 — Radius check:**
Given a station's `location` (PostGIS geography) and the user's location proxy (their most recent fill-up station's coordinates)
When the distance check runs
Then only stations within `alert_radius_km` (5 / 10 / 25 km) of the user's location proxy trigger alerts
And if the user has no fill-up history, the voivodeship of the dropped-price station is used as a coarse match against the user's most recent fill-up voivodeship

**AC6 — No notification permission:**
Given a driver has not granted notification permission (no `expo_push_token`)
When a price drop would trigger an alert for them
Then no notification is sent and the event is silently dropped

**AC7 — Fuel type filter:**
Given a driver's `price_drop_fuel_types` list is `['PB_95']`
When a verified submission for `ON` (diesel) drops below threshold
Then no alert is sent for that driver

**AC8 — Disabled alerts:**
Given a driver has `price_drop_enabled: false`
When any price drop occurs
Then no alert is sent, and their configured thresholds and radius are preserved unchanged

## Tasks / Subtasks

- [ ] T1: `price-drop-checks` BullMQ queue setup
  - [ ] T1a: Export `PRICE_DROP_CHECKS_QUEUE = 'price-drop-checks'` constant from `apps/api/src/alert/price-drop-alert.constants.ts`
  - [ ] T1b: Register the queue in `AlertModule` via `BullModule.registerQueue({ name: PRICE_DROP_CHECKS_QUEUE })`
  - [ ] T1c: Inject `PRICE_DROP_CHECKS_QUEUE` into `PhotoPipelineWorker` and add to `PhotoPipelineModule` imports
  - [ ] T1d: In `PhotoPipelineWorker.runPriceValidationAndUpdate()`: after successful `priceService.setVerifiedPrice()`, enqueue one `PriceDropCheckJobData` job per verified fuel type (best-effort, inside `.catch()` — non-blocking)

- [ ] T2: `PriceDropAlertService` (AC1–AC5, AC7)
  - [ ] T2a: Create `apps/api/src/alert/price-drop-alert.service.ts`
  - [ ] T2b: Implement `checkAndNotify(job: PriceDropCheckJobData): Promise<void>` — main orchestration method
  - [ ] T2c: Implement `getQualifyingUsers(stationId, fuelType, newPrice)` — queries opted-in drivers with valid push tokens, filters by fuel type, checks per-user dedup key in Redis
  - [ ] T2d: Implement `isWithinRadius(userLocationProxy, station, radiusKm)` — uses PostGIS `ST_DWithin` via `$queryRaw` for accurate distance check
  - [ ] T2e: Implement `getUserLocationProxy(userId)` — returns the coordinates of the user's most recent fill-up station (from `FillUp` → `Station.location`); falls back to voivodeship coarse match if no fill-up station has coordinates
  - [ ] T2f: Implement `getCurrentAreaMin(voivodeship, fuelType)` — queries `PriceHistory` for min price in that voivodeship in the last 7 days (excluding the just-submitted station); used for `cheaper_than_now` threshold comparison
  - [ ] T2g: Implement `buildNotificationPayload(matches, fuelType)` — returns batched notification copy if `matches.length > 1`, single-station copy if `matches.length === 1`; picks cheapest station for deep-link

- [ ] T3: `PriceDropAlertWorker` — BullMQ worker (AC1, AC4)
  - [ ] T3a: Create `apps/api/src/alert/price-drop-alert.worker.ts` — `@Processor(PRICE_DROP_CHECKS_QUEUE)`
  - [ ] T3b: In `process(job)`: call `priceDropAlertService.checkAndNotify(job.data)`; log `[OPS-ALERT]` on error; do not rethrow (best-effort alert delivery)

- [ ] T4: Update `AlertModule` (AC1)
  - [ ] T4a: Add `PriceDropAlertService`, `PriceDropAlertWorker` to providers
  - [ ] T4b: Export `PriceDropAlertService` (consumed by `PhotoPipelineModule` only for queue injection — no cross-module service calls)
  - [ ] T4c: Add `BullModule.forFeature([{ name: PRICE_DROP_CHECKS_QUEUE }])` import

- [ ] T5: Tests
  - [ ] T5a: `price-drop-alert.service.spec.ts` — `checkAndNotify`: sends notification for `cheaper_than_now` when new price < area min and within radius; sends notification for `target_price` when new price < target; does NOT notify when price is above threshold; does NOT notify when outside radius; does NOT notify when dedup key exists in Redis; sends single batched notification for multiple qualifying stations (not one per station); does NOT notify when `price_drop_enabled: false`; does NOT notify when no push token; records dedup key after sending
  - [ ] T5b: Full regression suite — all existing tests still pass

## Dev Notes

### PriceDropCheckJobData type

```ts
// apps/api/src/alert/price-drop-alert.constants.ts
export const PRICE_DROP_CHECKS_QUEUE = 'price-drop-checks';

export interface PriceDropCheckJobData {
  stationId: string;
  fuelType: string;       // e.g. 'PB_95', 'ON', 'LPG'
  newPricePln: number;    // verified price PLN/litre
  stationVoivodeship: string | null;
  verifiedAt: string;     // ISO datetime
}
```

### Enqueue hook in PhotoPipelineWorker

After `priceService.setVerifiedPrice()` succeeds, enqueue one job per verified fuel type:

```ts
// In runPriceValidationAndUpdate() — non-blocking, best-effort
for (const p of valid) {
  await this.priceDropChecksQueue
    .add(
      'price-drop-check',
      {
        stationId,
        fuelType: p.fuel_type,
        newPricePln: p.price_pln,
        stationVoivodeship: station.voivodeship ?? null,
        verifiedAt: new Date().toISOString(),
      } satisfies PriceDropCheckJobData,
      { removeOnComplete: { count: 500 }, removeOnFail: { count: 100 } },
    )
    .catch((err: Error) =>
      this.logger.warn(`Failed to enqueue price-drop-check for station ${stationId}: ${err.message}`),
    );
}
```

### checkAndNotify() implementation

```ts
async checkAndNotify(job: PriceDropCheckJobData): Promise<void> {
  const { stationId, fuelType, newPricePln, stationVoivodeship } = job;

  // 1. Fetch the station (need location + voivodeship)
  const station = await this.prisma.station.findUnique({
    where: { id: stationId },
    select: { id: true, name: true, voivodeship: true, location: true },
  });
  if (!station) return;

  // 2. Get area min for cheaper_than_now comparisons
  const areaMin = stationVoivodeship
    ? await this.getCurrentAreaMin(stationVoivodeship, fuelType, stationId)
    : null;

  // 3. Find opted-in users with matching fuel type + valid token (not yet deduped)
  const candidates = await this.getCandidateUsers(fuelType);

  // 4. For each candidate: check mode threshold + radius + dedup
  const notifyMap = new Map<string, { user: CandidateUser; matchedStations: StationMatch[] }>();

  for (const user of candidates) {
    const dedupKey = `alert:drop:${user.userId}:${fuelType}`;
    const alreadySent = await this.checkDedup(dedupKey);
    if (alreadySent) continue;

    // Threshold check
    const meetsThreshold =
      user.priceDrop.mode === 'cheaper_than_now'
        ? areaMin !== null && newPricePln < areaMin
        : newPricePln < (user.priceDrop.targetPln ?? Infinity);

    if (!meetsThreshold) continue;

    // Radius check
    const userLocation = await this.getUserLocationProxy(user.userId);
    const withinRadius = await this.isWithinRadius(userLocation, stationId, station.voivodeship, user.priceDrop.radiusKm);
    if (!withinRadius) continue;

    notifyMap.set(user.userId, {
      user,
      matchedStations: [{ stationId, stationName: station.name, pricePln: newPricePln, distanceKm: withinRadius }],
    });
  }

  // 5. Also collect other stations that dropped in the last 30 min (for batching)
  //    Only for users who already qualify — extend their matchedStations list
  await this.extendWithRecentDrops(notifyMap, fuelType, newPricePln);

  // 6. Send notifications
  for (const [userId, { user, matchedStations }] of notifyMap) {
    const cheapest = matchedStations.sort((a, b) => a.pricePln - b.pricePln)[0];
    const { title, body } = this.buildNotificationPayload(matchedStations, fuelType, user.lang);

    const message: ExpoPushMessage = {
      to: user.pushToken,
      title,
      body,
      data: { route: `/station/${cheapest.stationId}` },
      sound: 'default',
    };

    try {
      await this.expoPush.sendChunk([message]);
      await this.recordDedup(`alert:drop:${userId}:${fuelType}`);
    } catch (err) {
      this.logger.warn(`Failed to send price-drop alert to user ${userId}: ${(err as Error).message}`);
    }
  }
}
```

### getCandidateUsers() query

```ts
private async getCandidateUsers(fuelType: string): Promise<CandidateUser[]> {
  // Find users with: price_drop_enabled = true, valid token, fuel type in their list
  const prefs = await this.prisma.notificationPreference.findMany({
    where: {
      price_drop_enabled: true,
      expo_push_token: { not: null },
    },
    select: {
      user_id: true,
      expo_push_token: true,
      price_drop_mode: true,
      price_drop_target_pln: true,
      price_drop_fuel_types: true,
      alert_radius_km: true,
    },
  });

  return prefs
    .filter(
      (p) =>
        this.expoPush.isValidToken(p.expo_push_token!) &&
        (p.price_drop_fuel_types.length === 0 ||  // empty = all types
          p.price_drop_fuel_types.includes(fuelType)),
    )
    .map((p) => ({
      userId: p.user_id,
      pushToken: p.expo_push_token!,
      priceDrop: {
        mode: p.price_drop_mode as 'cheaper_than_now' | 'target_price',
        targetPln: p.price_drop_target_pln ? Number(p.price_drop_target_pln) : null,
        radiusKm: p.alert_radius_km,
      },
    }));
}
```

### getUserLocationProxy() — user's location

The Station model stores `location geography(Point,4326)`. The user's location proxy is the coordinates of their most recent fill-up station:

```ts
private async getUserLocationProxy(userId: string): Promise<UserLocation | null> {
  // Most recent fill-up with a station that has a location
  const result = await this.prisma.$queryRaw<[{ lat: number; lng: number; voivodeship: string | null }]>`
    SELECT
      ST_Y(s.location::geometry) AS lat,
      ST_X(s.location::geometry) AS lng,
      s.voivodeship
    FROM "FillUp" f
    JOIN "Station" s ON s.id = f.station_id
    WHERE f.user_id = ${userId}
      AND s.location IS NOT NULL
    ORDER BY f.filled_at DESC
    LIMIT 1
  `;
  if (!result[0]) return null;
  return { lat: result[0].lat, lng: result[0].lng, voivodeship: result[0].voivodeship };
}
```

### isWithinRadius() — PostGIS distance check

```ts
private async isWithinRadius(
  userLocation: UserLocation | null,
  stationId: string,
  stationVoivodeship: string | null,
  radiusKm: number,
): Promise<number | false> {  // returns distance if within, false otherwise
  if (!userLocation) {
    // Coarse fallback: voivodeship match only
    return stationVoivodeship !== null && stationVoivodeship === userLocation?.voivodeship
      ? 0   // unknown exact distance — within voivodeship
      : false;
  }

  const radiusMetres = radiusKm * 1000;
  const result = await this.prisma.$queryRaw<[{ distance_m: number }]>`
    SELECT ST_Distance(
      s.location,
      ST_SetSRID(ST_MakePoint(${userLocation.lng}, ${userLocation.lat}), 4326)::geography
    ) AS distance_m
    FROM "Station" s
    WHERE s.id = ${stationId}
      AND s.location IS NOT NULL
      AND ST_DWithin(
        s.location,
        ST_SetSRID(ST_MakePoint(${userLocation.lng}, ${userLocation.lat}), 4326)::geography,
        ${radiusMetres}
      )
  `;
  if (!result[0]) return false;
  return Math.round(result[0].distance_m / 100) / 10; // km, 1 decimal
}
```

### getCurrentAreaMin() — "cheaper than now" baseline

```ts
private async getCurrentAreaMin(
  voivodeship: string,
  fuelType: string,
  excludeStationId: string,
): Promise<number | null> {
  // Min price in the voivodeship for this fuel type in the last 7 days, excluding the submitted station
  const result = await this.prisma.$queryRaw<[{ min_price: number | null }]>`
    SELECT MIN(ph.price_pln)::float AS min_price
    FROM "PriceHistory" ph
    JOIN "Station" s ON s.id = ph.station_id
    WHERE s.voivodeship = ${voivodeship}
      AND ph.fuel_type = ${fuelType}
      AND ph.station_id != ${excludeStationId}
      AND ph.recorded_at >= NOW() - INTERVAL '7 days'
  `;
  return result[0]?.min_price ?? null;
}
```

### buildNotificationPayload() — batching copy

```ts
private buildNotificationPayload(
  matches: StationMatch[],
  fuelType: string,
  lang: string,
): { title: string; body: string } {
  const fuelLabel = FUEL_LABELS[fuelType] ?? fuelType;
  const cheapest = matches[0]; // already sorted cheapest first
  const priceStr = cheapest.pricePln.toFixed(2);
  const distStr = cheapest.distanceKm ? `${cheapest.distanceKm} km` : 'nearby';

  if (matches.length === 1) {
    return {
      title: `${fuelLabel} price drop`,
      body: `${fuelLabel} dropped to ${priceStr} PLN/L at ${cheapest.stationName} — ${distStr} away`,
    };
  }

  return {
    title: `Prices dropped at ${matches.length} stations near you`,
    body: `Cheapest: ${fuelLabel} at ${priceStr} PLN/L at ${cheapest.stationName} — tap to see all`,
  };
}

const FUEL_LABELS: Record<string, string> = {
  PB_95: 'PB95',
  PB_98: 'PB98',
  ON: 'Diesel',
  ON_PREMIUM: 'Diesel+',
  LPG: 'LPG',
};
```

### extendWithRecentDrops() — batching window

To support batched "3 stations near you" notifications, when a user qualifies for an alert, also check for other stations that had verified price drops for the same fuel type in the last 30 minutes:

```ts
private async extendWithRecentDrops(
  notifyMap: Map<string, { user: CandidateUser; matchedStations: StationMatch[] }>,
  fuelType: string,
  currentPrice: number,
): Promise<void> {
  if (notifyMap.size === 0) return;

  const since = new Date(Date.now() - 30 * 60 * 1000);
  // Find other recent low-price history entries for this fuel type
  const recentDrops = await this.prisma.priceHistory.findMany({
    where: {
      fuel_type: fuelType,
      recorded_at: { gte: since },
    },
    select: { station_id: true, price_pln: true },
    orderBy: { price_pln: 'asc' },
    take: 20,
  });

  for (const [userId, entry] of notifyMap) {
    for (const drop of recentDrops) {
      if (entry.matchedStations.some((m) => m.stationId === drop.station_id)) continue;

      const distance = await this.isWithinRadius(
        await this.getUserLocationProxy(userId),
        drop.station_id,
        null,
        entry.user.priceDrop.radiusKm,
      );
      if (distance !== false) {
        const station = await this.prisma.station.findUnique({
          where: { id: drop.station_id },
          select: { name: true },
        });
        entry.matchedStations.push({
          stationId: drop.station_id,
          stationName: station?.name ?? 'Unknown',
          pricePln: Number(drop.price_pln),
          distanceKm: distance,
        });
      }
    }
  }
}
```

**Note**: `extendWithRecentDrops` is best-effort and runs per notification send — not a blocker. Cache `getUserLocationProxy()` results per userId within the `checkAndNotify()` call to avoid repeated DB queries.

### Redis dedup — per-user, per-fuel-type

Dedup key: `alert:drop:{userId}:{fuelType}`, TTL 4 hours (14400 seconds).

Rationale: 4h prevents spam within a single day but allows a second alert if prices drop again in the evening. Unlike the rise alert (48h global dedup), drop alerts are per-user — different users in different areas may legitimately be notified of different stations.

```ts
private async checkDedup(key: string): Promise<boolean> {
  try {
    const exists = await this.redis.get(key);
    return exists !== null;
  } catch {
    return false; // fail-open: send if Redis unavailable
  }
}

private async recordDedup(key: string): Promise<void> {
  try {
    await this.redis.set(key, '1', 'EX', 4 * 3600); // 4h
  } catch (e) {
    this.logger.warn(`Failed to record drop dedup key ${key}: ${(e as Error).message}`);
  }
}
```

### Deep-link format

Notification data payload:
```ts
data: { route: `/station/${cheapest.stationId}` }
```

Mobile router handles `desert://station/{stationId}` → opens station detail screen. This route already exists from Phase 1 map/station detail implementation.

### CandidateUser + StationMatch types

```ts
// Internal types within price-drop-alert.service.ts
interface CandidateUser {
  userId: string;
  pushToken: string;
  priceDrop: {
    mode: 'cheaper_than_now' | 'target_price';
    targetPln: number | null;
    radiusKm: number;
  };
}

interface StationMatch {
  stationId: string;
  stationName: string;
  pricePln: number;
  distanceKm: number | 0;  // 0 = voivodeship coarse match (no precise distance)
}

interface UserLocation {
  lat: number;
  lng: number;
  voivodeship: string | null;
}
```

### NotificationPreference columns consumed (from Story 6.4)

Story 6.1 reads — but does not define — these columns. They are added by Story 6.4:
- `price_drop_enabled Boolean @default(false)`
- `price_drop_mode String @default('cheaper_than_now')`
- `price_drop_target_pln Decimal? @db.Decimal(5,2)`
- `price_drop_fuel_types String[] @default([])`
- `alert_radius_km Int @default(10)`

**Implementation sequencing**: Story 6.4 must be deployed before Story 6.1 is activated. Story 6.1 can be deployed first (the schema columns default to `false`/empty, so no alerts will fire until drivers configure preferences in 6.4).

### Photo pipeline module changes

`PhotoPipelineModule` must import `AlertModule` (or at minimum `BullModule.forFeature` for the `price-drop-checks` queue). To avoid circular module dependency, inject only the BullMQ queue — not `PriceDropAlertService` directly:

```ts
// In photo-pipeline.module.ts — add to imports:
BullModule.forFeature([{ name: PRICE_DROP_CHECKS_QUEUE }]),
```

And inject `@InjectQueue(PRICE_DROP_CHECKS_QUEUE) private readonly priceDropChecksQueue: Queue` into `PhotoPipelineWorker` constructor.

### Project Structure Notes

- `apps/api/src/alert/price-drop-alert.constants.ts` (new — queue name + job types)
- `apps/api/src/alert/price-drop-alert.service.ts` (new)
- `apps/api/src/alert/price-drop-alert.worker.ts` (new)
- `apps/api/src/alert/alert.module.ts` (modified — new providers + queue registration)
- `apps/api/src/photo/photo-pipeline.worker.ts` (modified — enqueue `price-drop-check` after verification)
- `apps/api/src/photo/photo-pipeline.module.ts` (modified — import queue)
- `apps/api/src/alert/price-drop-alert.service.spec.ts` (new)
- **No schema changes** — uses `NotificationPreference` columns from Story 6.4
- **No mobile changes** — notification deep-links to existing station detail screen

### References

- Existing alert service pattern: [apps/api/src/alert/alert.service.ts](apps/api/src/alert/alert.service.ts)
- Existing alert module: [apps/api/src/alert/alert.module.ts](apps/api/src/alert/alert.module.ts)
- Verification hook point: [apps/api/src/photo/photo-pipeline.worker.ts](apps/api/src/photo/photo-pipeline.worker.ts#L620) (`runPriceValidationAndUpdate`)
- `NotificationPreference` Phase 2 columns: Story 6.4
- Station PostGIS location: [packages/db/prisma/schema.prisma](packages/db/prisma/schema.prisma#L79)
- `PriceHistory`: [apps/api/src/price/](apps/api/src/price/) (Stories 2.3–2.5)
- Story epics spec: [_bmad-output/planning-artifacts/epics.md](_bmad-output/planning-artifacts/epics.md) — Story 6.1 (line ~2494)

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List

- `apps/api/src/alert/price-drop-alert.constants.ts` (new)
- `apps/api/src/alert/price-drop-alert.service.ts` (new)
- `apps/api/src/alert/price-drop-alert.worker.ts` (new)
- `apps/api/src/alert/alert.module.ts` (modified)
- `apps/api/src/photo/photo-pipeline.worker.ts` (modified)
- `apps/api/src/photo/photo-pipeline.module.ts` (modified)
- `apps/api/src/alert/price-drop-alert.service.spec.ts` (new)
- `_bmad-output/implementation-artifacts/6-1-price-drop-alerts.md` (this file)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)
