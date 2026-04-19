# Story 6.2: Community-Confirmed Price Rise Alerts

Status: ready-for-dev

## Story

As a **driver**,
I want to be notified when prices are rising across stations near me based on community reports,
So that I know a real regional price increase has hit my area and can act before I next fill up.

## Acceptance Criteria

**AC1 — Regional threshold evaluation:**
Given verified price submissions are processed continuously
When a verified submission is written for a voivodeship + fuel type
Then a `community-rise-check` BullMQ job is enqueued for that voivodeship + fuel type
And the worker evaluates: of all stations in that voivodeship with `PriceHistory` entries for that fuel type in both the last 24h and the prior 24h (24–48h ago), what percentage show ≥2% price rise
And if that percentage ≥ 30% with at least 3 qualifying stations, the threshold is met

**AC2 — Notification sent on threshold met:**
Given the regional threshold is met (AC1)
When the worker identifies opted-in drivers whose most-recent fill-up voivodeship matches the affected voivodeship
Then each eligible driver receives a push notification: "PB95 prices are rising across stations near you — consider filling up soon"
And the notification deep-links to the map view filtered to that fuel type

**AC3 — "As expected" copy when predictive alert preceded:**
Given a predictive rise alert (Story 6.3) was sent for the same voivodeship + fuel type
When the community threshold is met and at least 6 hours have passed since the predictive alert
Then the notification copy reads: "As expected, PB95 prices have now risen at stations near you"
And if fewer than 6 hours have passed since the predictive alert, the community alert is skipped entirely for this run (will be re-evaluated on the next qualifying submission)

**AC4 — 48h dedup per voivodeship + fuel type:**
Given a community rise alert has been sent for a voivodeship + fuel type
When another community rise would trigger within 48 hours for the same voivodeship + fuel type
Then no second alert is sent — one alert per price movement cycle

**AC5 — Opt-in check:**
Given a driver has `rise_community_enabled: false` (Story 6.4)
When a community rise alert fires
Then no notification is sent for that driver

**AC6 — No push token:**
Given a driver has no `expo_push_token`
When a community rise alert fires
Then no notification is sent — silently dropped

## Tasks / Subtasks

- [ ] T1: `community-rise-checks` BullMQ queue setup
  - [ ] T1a: Add `COMMUNITY_RISE_CHECKS_QUEUE = 'community-rise-checks'` to `apps/api/src/alert/price-drop-alert.constants.ts` (extends existing constants file)
  - [ ] T1b: Register queue in `AlertModule` via `BullModule.registerQueue`
  - [ ] T1c: Inject `COMMUNITY_RISE_CHECKS_QUEUE` into `PhotoPipelineWorker` — alongside the `price-drop-checks` injection from Story 6.1
  - [ ] T1d: In `PhotoPipelineWorker.runPriceValidationAndUpdate()`: after `priceService.setVerifiedPrice()`, enqueue one `CommunityRiseCheckJobData` job per verified fuel type with dedup jobId `community-rise:${voivodeship}:${fuelType}` (BullMQ deduplicates if same jobId is already pending)

- [ ] T2: `CommunityRiseAlertService` (AC1–AC4)
  - [ ] T2a: Create `apps/api/src/alert/community-rise-alert.service.ts`
  - [ ] T2b: Implement `evaluateAndNotify(job: CommunityRiseCheckJobData): Promise<void>`
  - [ ] T2c: Implement `evaluateThreshold(voivodeship, fuelType)` — runs the two-step CTE (see Dev Notes); returns `{ thresholdMet: boolean; risingCount: number; totalCount: number }`
  - [ ] T2d: Implement `checkPredictiveTiming(voivodeship, fuelType)` — reads Redis key `alert:rise:predictive:{voivodeship}:{fuelType}`; returns `'none' | 'too-soon' | 'eligible'`
  - [ ] T2e: Implement `getEligibleUsers(voivodeship)` — queries `NotificationPreference` where `rise_community_enabled: true` + valid push token; joins fill-up history to match user's voivodeship
  - [ ] T2f: Implement `sendAlerts(users, fuelType, copyVariant)` — chunked Expo push send; records 48h dedup key after send

- [ ] T3: `CommunityRiseAlertWorker` — BullMQ worker (AC1)
  - [ ] T3a: Create `apps/api/src/alert/community-rise-alert.worker.ts` — `@Processor(COMMUNITY_RISE_CHECKS_QUEUE)`
  - [ ] T3b: In `process(job)`: call `communityRiseAlertService.evaluateAndNotify(job.data)`; log `[OPS-ALERT]` on error

- [ ] T4: Update `AlertModule`
  - [ ] T4a: Add `CommunityRiseAlertService`, `CommunityRiseAlertWorker` to providers
  - [ ] T4b: Export `CommunityRiseAlertService` (needed by Story 6.3 to read predictive-sent Redis key pattern)

- [ ] T5: Tests
  - [ ] T5a: `community-rise-alert.service.spec.ts` — `evaluateThreshold`: returns `thresholdMet: true` when ≥30% of ≥3 stations rose ≥2%; returns `false` when < 30%; returns `false` when < 3 qualifying stations; `evaluateAndNotify`: skips when threshold not met; skips when community dedup key exists; sends normal copy when no predictive alert; sends "As expected" copy when predictive ≥6h ago; skips entirely when predictive <6h ago; sends only to users whose voivodeship matches; does not notify users with `rise_community_enabled: false`
  - [ ] T5b: Full regression suite — all existing tests still pass

## Dev Notes

### CommunityRiseCheckJobData type

```ts
// Extend apps/api/src/alert/price-drop-alert.constants.ts
export const COMMUNITY_RISE_CHECKS_QUEUE = 'community-rise-checks';

export interface CommunityRiseCheckJobData {
  voivodeship: string;
  fuelType: string;       // 'PB_95' | 'ON' | 'LPG' | etc.
  triggeredByStationId: string;  // station whose submission triggered this check
  verifiedAt: string;    // ISO datetime
}
```

### BullMQ job deduplication

Use `jobId` to prevent redundant threshold evaluations when multiple submissions arrive in rapid succession for the same voivodeship + fuel type:

```ts
await this.communityRiseChecksQueue
  .add(
    'community-rise-check',
    {
      voivodeship: station.voivodeship,
      fuelType: p.fuel_type,
      triggeredByStationId: stationId,
      verifiedAt: new Date().toISOString(),
    } satisfies CommunityRiseCheckJobData,
    {
      jobId: `community-rise:${station.voivodeship}:${p.fuel_type}`,
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 50 },
    },
  )
  .catch((err: Error) =>
    this.logger.warn(`Failed to enqueue community-rise-check: ${err.message}`),
  );
```

BullMQ ignores duplicate `jobId` if a job with that ID is already in the queue. This is important: many submissions within the same voivodeship in a short burst → only one threshold evaluation runs.

### Threshold evaluation SQL

Two-step CTE that finds stations with price data in both windows and calculates the rise:

```sql
WITH recent AS (
  SELECT DISTINCT ON (ph.station_id)
    ph.station_id,
    ph.price AS current_price
  FROM "PriceHistory" ph
  JOIN "Station" s ON s.id = ph.station_id
  WHERE s.voivodeship = ${voivodeship}
    AND ph.fuel_type = ${fuelType}
    AND ph.recorded_at >= NOW() - INTERVAL '24 hours'
  ORDER BY ph.station_id, ph.recorded_at DESC
),
previous AS (
  SELECT DISTINCT ON (ph.station_id)
    ph.station_id,
    ph.price AS prev_price
  FROM "PriceHistory" ph
  JOIN recent r ON r.station_id = ph.station_id
  WHERE ph.fuel_type = ${fuelType}
    AND ph.recorded_at < NOW() - INTERVAL '24 hours'
    AND ph.recorded_at >= NOW() - INTERVAL '48 hours'
  ORDER BY ph.station_id, ph.recorded_at DESC
)
SELECT
  COUNT(*)::int AS total_stations,
  COUNT(*) FILTER (
    WHERE (r.current_price - p.prev_price) / p.prev_price >= 0.02
  )::int AS rising_stations
FROM recent r
JOIN previous p ON p.station_id = r.station_id
```

Threshold met when: `rising_stations / total_stations >= 0.30` AND `total_stations >= 3`.

Minimum 3 qualifying stations guards against false positives in voivodeships with sparse data.

### Predictive alert timing check

Story 6.3 sets a Redis key when it sends a predictive alert. This key stores the sent-timestamp as its value so Story 6.2 can check the age:

Redis key: `alert:rise:predictive:{voivodeship}:{fuelType}`
Value: `Date.now().toString()` (Unix ms timestamp)
TTL: 72 hours (matching Story 6.3's dedup window)

```ts
private async checkPredictiveTiming(
  voivodeship: string,
  fuelType: string,
): Promise<'none' | 'too-soon' | 'eligible'> {
  try {
    const raw = await this.redis.get(`alert:rise:predictive:${voivodeship}:${fuelType}`);
    if (!raw) return 'none';
    const sentAt = parseInt(raw, 10);
    const ageMs = Date.now() - sentAt;
    const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
    return ageMs >= SIX_HOURS_MS ? 'eligible' : 'too-soon';
  } catch {
    return 'none'; // fail-open: treat as no predictive alert sent
  }
}
```

### getEligibleUsers() — voivodeship matching

Community rise alerts are regional — match users by their most recent fill-up station's voivodeship. No per-user radius calculation (voivodeship is the geographic unit for this alert type).

```ts
private async getEligibleUsers(voivodeship: string): Promise<EligibleUser[]> {
  // Users opted in with valid token
  const prefs = await this.prisma.notificationPreference.findMany({
    where: {
      rise_community_enabled: true,
      expo_push_token: { not: null },
    },
    select: { user_id: true, expo_push_token: true },
  });

  const validPrefs = prefs.filter((p) => this.expoPush.isValidToken(p.expo_push_token!));
  if (validPrefs.length === 0) return [];

  // Match by voivodeship of most-recent fill-up station
  const userIds = validPrefs.map((p) => p.user_id);
  const matches = await this.prisma.$queryRaw<Array<{ user_id: string }>>`
    SELECT DISTINCT ON (f.user_id) f.user_id
    FROM "FillUp" f
    JOIN "Station" s ON s.id = f.station_id
    WHERE f.user_id = ANY(${userIds}::uuid[])
      AND s.voivodeship = ${voivodeship}
    ORDER BY f.user_id, f.filled_at DESC
  `;

  const matchedIds = new Set(matches.map((m) => m.user_id));
  return validPrefs
    .filter((p) => matchedIds.has(p.user_id))
    .map((p) => ({ userId: p.user_id, pushToken: p.expo_push_token! }));
}
```

### evaluateAndNotify() — orchestration

```ts
async evaluateAndNotify(job: CommunityRiseCheckJobData): Promise<void> {
  const { voivodeship, fuelType } = job;

  // 1. Check 48h dedup — already alerted for this voivodeship+fuelType?
  const dedupKey = `alert:rise:community:${voivodeship}:${fuelType}`;
  const alreadySent = await this.checkDedup(dedupKey);
  if (alreadySent) {
    this.logger.debug(`Community rise already sent for ${voivodeship}:${fuelType} — skipping`);
    return;
  }

  // 2. Evaluate threshold
  const { thresholdMet, risingCount, totalCount } = await this.evaluateThreshold(voivodeship, fuelType);
  if (!thresholdMet) {
    this.logger.debug(
      `Community rise threshold not met for ${voivodeship}:${fuelType} — ${risingCount}/${totalCount} stations rose`,
    );
    return;
  }

  this.logger.log(
    `Community rise threshold met for ${voivodeship}:${fuelType} — ${risingCount}/${totalCount} stations`,
  );

  // 3. Check predictive alert timing
  const predictiveTiming = await this.checkPredictiveTiming(voivodeship, fuelType);
  if (predictiveTiming === 'too-soon') {
    this.logger.log(
      `Community rise skipped — predictive alert sent < 6h ago for ${voivodeship}:${fuelType}`,
    );
    return;
  }

  const copyVariant: 'normal' | 'as-expected' =
    predictiveTiming === 'eligible' ? 'as-expected' : 'normal';

  // 4. Find eligible users
  const users = await this.getEligibleUsers(voivodeship);
  if (users.length === 0) {
    this.logger.log(`No eligible users in ${voivodeship} for community rise alert`);
    await this.recordDedup(dedupKey);
    return;
  }

  // 5. Send notifications
  const fuelLabel = FUEL_LABELS[fuelType] ?? fuelType;
  const { title, body } = this.buildCopy(fuelLabel, copyVariant);
  const deepLink = `/map?fuelType=${fuelType}`;

  await this.sendAlerts(users, title, body, deepLink);

  // 6. Record dedup (48h)
  await this.recordDedup(dedupKey);
  this.logger.log(
    `Community rise alert sent to ${users.length} user(s) for ${voivodeship}:${fuelType} (${copyVariant})`,
  );
}
```

### Notification copy variants

```ts
private buildCopy(
  fuelLabel: string,
  variant: 'normal' | 'as-expected',
): { title: string; body: string } {
  if (variant === 'as-expected') {
    return {
      title: `${fuelLabel} prices have risen near you`,
      body: `As expected, ${fuelLabel} prices have now risen at stations near you.`,
    };
  }
  return {
    title: `${fuelLabel} prices rising near you`,
    body: `${fuelLabel} prices are rising across stations near you — consider filling up soon.`,
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

### Deep-link format

```ts
data: { route: `/map?fuelType=${fuelType}` }
```

Opens map view filtered to the specified fuel type — same deep-link pattern as existing map navigation.

### Redis dedup helpers

```ts
private async checkDedup(key: string): Promise<boolean> {
  try {
    return (await this.redis.get(key)) !== null;
  } catch {
    return false; // fail-open
  }
}

private async recordDedup(key: string): Promise<void> {
  try {
    await this.redis.set(key, '1', 'EX', 48 * 3600); // 48h
  } catch (e) {
    this.logger.warn(`Failed to record community-rise dedup key ${key}: ${(e as Error).message}`);
  }
}
```

### sendAlerts() — chunked Expo send

Follows same pattern as `PriceRiseAlertService.sendInChunks()`:

```ts
private async sendAlerts(
  users: EligibleUser[],
  title: string,
  body: string,
  deepLink: string,
): Promise<void> {
  const messages: ExpoPushMessage[] = users.map((u) => ({
    to: u.pushToken,
    title,
    body,
    data: { route: deepLink },
    sound: 'default' as const,
  }));

  const chunks = this.expoPush.chunkMessages(messages);
  for (const chunk of chunks) {
    try {
      const tickets = await this.expoPush.sendChunk(chunk);
      for (const ticket of tickets) {
        if (ticket.status === 'error') {
          if (ticket.details?.error === 'DeviceNotRegistered') {
            this.logger.warn('DeviceNotRegistered — stale push token detected');
          } else {
            this.logger.warn(`Push ticket error: ${ticket.message}`);
          }
        }
      }
    } catch (e) {
      this.logger.error(`Failed to send community-rise push chunk: ${(e as Error).message}`);
    }
  }
}
```

### EligibleUser type

```ts
// Internal type within community-rise-alert.service.ts
interface EligibleUser {
  userId: string;
  pushToken: string;
}
```

### NotificationPreference column consumed (from Story 6.4)

Story 6.2 reads — but does not define — `rise_community_enabled Boolean @default(false)`. Added by Story 6.4.

**Deployment sequencing**: 6.2 can be deployed before 6.4 (all users default to `false`, so no alerts fire). Story 6.4 must be deployed for any driver to opt in.

### Interaction with Story 6.3

Story 6.3 must set `alert:rise:predictive:{voivodeship}:{fuelType}` in Redis (value = timestamp string, TTL = 72h) when a predictive alert is sent. Story 6.2 reads this key to determine copy variant and skip-if-too-soon logic.

This dependency is a cross-story Redis contract — documented here and in Story 6.3's dev notes.

### Note on voivodeship as geographic unit

The spec says "within a driver's configured radius" but the implementation uses voivodeship as the geographic unit. This is an intentional simplification:

- Community rise alerts are regional movements, not single-station events
- Voivodeship is the natural administrative unit for fuel pricing in Poland (ORLEN rack prices align regionally)
- Per-user radius evaluation would require O(users × stations) distance queries on every submission verification — not feasible at scale
- The `alert_radius_km` preference (Story 6.4) applies to price-drop alerts (Story 6.1) where precise station targeting matters; for community rise alerts the voivodeship match is appropriate

### Project Structure Notes

- `apps/api/src/alert/price-drop-alert.constants.ts` (modified — add `COMMUNITY_RISE_CHECKS_QUEUE` + `CommunityRiseCheckJobData`)
- `apps/api/src/alert/community-rise-alert.service.ts` (new)
- `apps/api/src/alert/community-rise-alert.worker.ts` (new)
- `apps/api/src/alert/alert.module.ts` (modified — new providers + queue)
- `apps/api/src/photo/photo-pipeline.worker.ts` (modified — enqueue community-rise-check alongside price-drop-check from Story 6.1)
- `apps/api/src/photo/photo-pipeline.module.ts` (modified — register community-rise-checks queue)
- `apps/api/src/alert/community-rise-alert.service.spec.ts` (new)
- **No schema changes** — `rise_community_enabled` column defined in Story 6.4
- **No mobile changes** — deep-links to existing map screen with `fuelType` query param

### References

- Existing alert service + push pattern: [apps/api/src/alert/alert.service.ts](apps/api/src/alert/alert.service.ts)
- `PhotoPipelineWorker` verification hook: [apps/api/src/photo/photo-pipeline.worker.ts](apps/api/src/photo/photo-pipeline.worker.ts)
- `PriceHistory` model: [packages/db/prisma/schema.prisma](packages/db/prisma/schema.prisma#L194)
- `Station.voivodeship`: [packages/db/prisma/schema.prisma](packages/db/prisma/schema.prisma#L84)
- Story 6.1 queue setup (same hook point in PhotoPipelineWorker): [_bmad-output/implementation-artifacts/6-1-price-drop-alerts.md](_bmad-output/implementation-artifacts/6-1-price-drop-alerts.md)
- Story 6.3: sets `alert:rise:predictive:{voivodeship}:{fuelType}` Redis key consumed here
- Story 6.4: `rise_community_enabled` column on `NotificationPreference`
- Story epics spec: [_bmad-output/planning-artifacts/epics.md](_bmad-output/planning-artifacts/epics.md) — Story 6.2 (line ~2535)

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List

- `apps/api/src/alert/price-drop-alert.constants.ts` (modified)
- `apps/api/src/alert/community-rise-alert.service.ts` (new)
- `apps/api/src/alert/community-rise-alert.worker.ts` (new)
- `apps/api/src/alert/alert.module.ts` (modified)
- `apps/api/src/photo/photo-pipeline.worker.ts` (modified)
- `apps/api/src/photo/photo-pipeline.module.ts` (modified)
- `apps/api/src/alert/community-rise-alert.service.spec.ts` (new)
- `_bmad-output/implementation-artifacts/6-2-community-confirmed-rise-alerts.md` (this file)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)
