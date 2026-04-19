# Story 6.3: Predictive Price Rise Alerts

Status: ready-for-dev

## Story

As a **driver**,
I want to receive an early warning when fuel prices are likely about to increase,
So that I can fill up before the rise hits the pumps near me.

## Acceptance Criteria

**AC1 — Alert triggered by price-rise-signals queue:**
Given Story 6.0 publishes a `price-rise-signal` event to the `price-rise-signals` BullMQ queue
When the `PredictiveRiseAlertWorker` processes the job
Then it evaluates each fuel type in `signal.fuelTypes` for the per-type 72h dedup key
And for any fuel type not yet deduped, sends a push notification to all opted-in drivers

**AC2 — Notification copy:**
Given a predictive alert fires
When it is sent
Then the push body is: "Our data suggests fuel prices in your area may rise soon — worth filling up if you can."
And the notification deep-links to the map view
And the data source (ORLEN rack / Brent crude) is never mentioned to the driver

**AC3 — ORLEN rack takes precedence over Brent crude:**
Given both a Brent crude signal and an ORLEN rack signal fire within the same 24-hour window for the same fuel type
When both jobs are processed
Then only one notification is sent
And ORLEN rack takes precedence — achieved by adding a 60-second queue delay to Brent crude jobs in Story 6.0's `PriceRiseSignalPublisher`; the first job to process sets the dedup key, the second job sees it and skips

**AC4 — 72h dedup per fuel type:**
Given a predictive alert has been sent for a fuel type
When another market signal triggers within 72 hours for the same fuel type
Then no second alert is sent — one alert per price movement cycle

**AC5 — Opt-in:**
Given a driver has `rise_predictive_enabled: false` (Story 6.4 column, defaults to false)
When a predictive rise alert fires
Then no notification is sent for that driver
And the 72h dedup key is still set — prevents re-alerting even after driver enables the preference mid-cycle

**AC6 — No push token:**
Given a driver has no `expo_push_token`
When a predictive alert fires
Then no notification is sent — silently dropped

**AC7 — Phase 1 worker deprecated:**
Given Story 6.3 is deployed alongside Story 6.0
When the system starts
Then the Phase 1 `PriceRiseAlertWorker` scheduled jobs (06:05 and 14:05 Warsaw) are disabled — Story 6.0's `PriceRiseSignalPublisher` now publishes ORLEN rack signals to the same `price-rise-signals` queue, making the scheduled worker redundant

**AC8 — Story 6.2 coordination:**
Given a predictive alert is sent for a fuel type
When Story 6.2's community-rise check later evaluates the same fuel type
Then it can determine the predictive alert's sent timestamp from Redis key `alert:rise:predictive:{fuelType}` (value = Unix ms timestamp, TTL = 72h)

## Tasks / Subtasks

- [ ] T1: `PredictiveRiseAlertService` (AC1–AC6, AC8)
  - [ ] T1a: Create `apps/api/src/alert/predictive-rise-alert.service.ts`
  - [ ] T1b: Implement `processSignal(job: PriceRiseSignalJobData): Promise<void>` — main orchestration; iterates over `job.fuelTypes`; checks dedup; sends alerts; sets dedup key per fuel type
  - [ ] T1c: Implement `getEligibleUsers()` — queries `NotificationPreference` where `rise_predictive_enabled: true` + `expo_push_token` not null; returns `EligibleUser[]`
  - [ ] T1d: Implement `sendAlerts(users, signal)` — chunked Expo send; same `sendInChunks` pattern as `PriceRiseAlertService`
  - [ ] T1e: Implement `setDedup(fuelType)` — writes `alert:rise:predictive:{fuelType}` = `Date.now().toString()`, TTL 72h; fail-silently

- [ ] T2: `PredictiveRiseAlertWorker` — BullMQ `price-rise-signals` consumer (AC1, AC7)
  - [ ] T2a: Create `apps/api/src/alert/predictive-rise-alert.worker.ts` — `@Processor(PRICE_RISE_SIGNALS_QUEUE)` (imported from Story 6.0's `MarketSignalModule`)
  - [ ] T2b: In `process(job)`: call `predictiveRiseAlertService.processSignal(job.data)`; log `[OPS-ALERT]` on failure

- [ ] T3: Deprecate Phase 1 `PriceRiseAlertWorker` (AC7)
  - [ ] T3a: In `apps/api/src/alert/alert.worker.ts`: remove the two `queue.add()` cron schedule registrations for `price-rise-alert-morning` and `price-rise-alert-afternoon` — the worker class can remain but will no longer schedule itself
  - [ ] T3b: Add a log comment: `// Phase 1 scheduled alerts replaced by PredictiveRiseAlertWorker (Story 6.3) consuming price-rise-signals queue from Story 6.0`
  - [ ] T3c: The existing `PriceRiseAlertService.sendRiseAlerts()` is retained (still referenced in tests and ops tooling) but no longer triggered on a schedule

- [ ] T4: Register `price-rise-signals` queue in `AlertModule` (AC1)
  - [ ] T4a: Import `PRICE_RISE_SIGNALS_QUEUE` from `MarketSignalModule` (or re-export the constant — prefer re-export to avoid cross-module import coupling)
  - [ ] T4b: Add `BullModule.forFeature([{ name: PRICE_RISE_SIGNALS_QUEUE }])` to `AlertModule` imports
  - [ ] T4c: Add `PredictiveRiseAlertService`, `PredictiveRiseAlertWorker` to `AlertModule` providers

- [ ] T5: Brent crude delay in Story 6.0 `PriceRiseSignalPublisher` (AC3)
  - [ ] T5a: In `apps/api/src/market-signal/price-rise-signal.publisher.ts`: when `signalSource === 'brent_crude_pln'`, add `delay: 60_000` (60 seconds) to the BullMQ job options — gives ORLEN rack signals 60 seconds to process first

- [ ] T6: Tests
  - [ ] T6a: `predictive-rise-alert.service.spec.ts` — `processSignal`: sends alert for `orlen_rack` signal to opted-in users; sends alert for `brent_crude_pln` signal; skips when 72h dedup key exists; sends once when multiple fuel types in signal, each with its own dedup key; does NOT notify when `rise_predictive_enabled: false`; does NOT notify when no push token; sets `alert:rise:predictive:{fuelType}` with timestamp value after send; dedup key still set even when no eligible users
  - [ ] T6b: Full regression suite — all existing tests still pass

## Dev Notes

### processSignal() implementation

```ts
async processSignal(job: PriceRiseSignalJobData): Promise<void> {
  const newFuelTypes: string[] = [];

  // Check dedup per fuel type — process only those not already alerted
  for (const fuelType of job.fuelTypes) {
    const dedupKey = `alert:rise:predictive:${fuelType}`;
    const alreadySent = await this.checkDedup(dedupKey);
    if (!alreadySent) {
      newFuelTypes.push(fuelType);
    } else {
      this.logger.debug(`Predictive rise already sent for ${fuelType} — skipping`);
    }
  }

  if (newFuelTypes.length === 0) return;

  this.logger.log(
    `Predictive rise signal: ${job.signalSource}, fuel types: ${newFuelTypes.join(', ')}, ` +
    `pctMovement: ${(job.pctMovement * 100).toFixed(1)}%`,
  );

  // Find opted-in users (query once — same users for all fuel types in this signal)
  const users = await this.getEligibleUsers();

  if (users.length === 0) {
    this.logger.log('No opted-in users with valid push tokens for predictive rise alert');
  } else {
    this.logger.log(`Sending predictive rise alerts to ${users.length} device(s)`);
    await this.sendAlerts(users);
  }

  // Record dedup keys for all new fuel types (even if no users — prevents re-alerting)
  for (const fuelType of newFuelTypes) {
    await this.setDedup(fuelType);
  }
}
```

### getEligibleUsers()

```ts
private async getEligibleUsers(): Promise<EligibleUser[]> {
  const prefs = await this.prisma.notificationPreference.findMany({
    where: {
      rise_predictive_enabled: true,
      expo_push_token: { not: null },
    },
    select: { expo_push_token: true },
  });

  return prefs
    .filter((p) => this.expoPush.isValidToken(p.expo_push_token!))
    .map((p) => ({ pushToken: p.expo_push_token! }));
}
```

### Notification content

```ts
const PUSH_TITLE = 'Fuel prices may be rising';
const PUSH_BODY =
  'Our data suggests fuel prices in your area may rise soon — worth filling up if you can.';

// In sendAlerts():
const messages: ExpoPushMessage[] = users.map((u) => ({
  to: u.pushToken,
  title: PUSH_TITLE,
  body: PUSH_BODY,
  data: { route: '/map' },
  sound: 'default' as const,
}));
```

This is identical to the Phase 1 copy — intentional. The driver experience must be consistent across Phase 1 and Phase 2.

### Redis dedup

```ts
private async checkDedup(key: string): Promise<boolean> {
  try {
    return (await this.redis.get(key)) !== null;
  } catch {
    return false; // fail-open: treat as new signal if Redis unavailable
  }
}

private async setDedup(fuelType: string): Promise<void> {
  const key = `alert:rise:predictive:${fuelType}`;
  try {
    // Value is timestamp — Story 6.2 reads this to determine age vs 6h threshold
    await this.redis.set(key, Date.now().toString(), 'EX', 72 * 3600);
  } catch (e) {
    this.logger.warn(`Failed to set predictive dedup key for ${fuelType}: ${(e as Error).message}`);
  }
}
```

**Redis key contract with Story 6.2:**
- Key: `alert:rise:predictive:{fuelType}` (e.g. `alert:rise:predictive:PB_95`)
- Value: Unix timestamp in milliseconds as a string (e.g. `"1744034400000"`)
- TTL: 72 hours
- Story 6.2 reads this key to determine whether to send "As expected" copy or skip

**Correction to Story 6.2 dev notes**: The predictive key is `alert:rise:predictive:{fuelType}` (no voivodeship), not `alert:rise:predictive:{voivodeship}:{fuelType}` as written in Story 6.2. The predictive alert is national — all opted-in users receive it regardless of voivodeship. Story 6.2 implementation should use the per-fuelType key.

### ORLEN rack precedence via queue delay

In `apps/api/src/market-signal/price-rise-signal.publisher.ts` (Story 6.0), add delay for Brent signals:

```ts
await this.queue.add('price-rise-signal', jobData satisfies PriceRiseSignalJobData, {
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 20 },
  // Brent crude signals delayed 60s — gives ORLEN rack time to process first (precedence)
  ...(jobData.signalSource === 'brent_crude_pln' ? { delay: 60_000 } : {}),
});
```

When both signals fire in the same ingestion run:
1. ORLEN rack job enqueued immediately → processes → sets `alert:rise:predictive:PB_95` (and other types) → sends alert
2. Brent crude job enqueued with 60s delay → processes → finds dedup keys already set → skips

### Phase 1 worker deprecation

The existing `PriceRiseAlertWorker` registered two cron jobs:
- `price-rise-alert-morning` at 06:05 Europe/Warsaw
- `price-rise-alert-afternoon` at 14:05 Europe/Warsaw

These polled `MarketSignal.significant_movement` from the last 2 hours. With Story 6.0 deployed, the same ORLEN rack signals are now published directly to `price-rise-signals` queue by `PriceRiseSignalPublisher` — making the scheduled poll redundant.

**Transition**: Remove the `queue.add()` cron registrations from `alert.worker.ts`. The BullMQ recurring jobs already in the queue will stop being re-scheduled on the next process restart.

The `PriceRiseAlertService.sendRiseAlerts()` method is retained as a safety valve — it can still be triggered manually via admin ops if needed.

### NotificationPreference column consumed (from Story 6.4)

Story 6.3 reads `rise_predictive_enabled Boolean @default(false)` — added by Story 6.4. Defaults to `false`, so no Phase 2 predictive alerts fire until drivers configure preferences.

**Migration note**: Users who had `sharp_rise: true` in Phase 1 do NOT automatically receive Phase 2 predictive alerts — they must opt in via Story 6.4's preferences screen. The Phase 1 `PriceRiseAlertService` (now unused by schedule) was reading `sharp_rise`. The Phase 2 `PredictiveRiseAlertService` reads `rise_predictive_enabled`.

If a seamless migration is desired (retain Phase 1 subscribers), Story 6.4 should include a one-time migration that copies `sharp_rise → rise_predictive_enabled` for existing users. This is noted as a Story 6.4 implementation decision.

### `PRICE_RISE_SIGNALS_QUEUE` constant sharing

The constant is defined in `apps/api/src/market-signal/price-rise-signal.publisher.ts` (Story 6.0). Rather than importing across module boundaries, re-export it from a shared constants file or accept the cross-module import:

```ts
// Option A: re-export in AlertModule constants
// apps/api/src/alert/price-drop-alert.constants.ts
export { PRICE_RISE_SIGNALS_QUEUE } from '../market-signal/price-rise-signal.publisher.js';

// Option B: duplicate constant (simpler, not DRY)
export const PRICE_RISE_SIGNALS_QUEUE = 'price-rise-signals'; // must match Story 6.0
```

Prefer Option A to prevent string drift. The dev agent should verify the queue name matches exactly.

### EligibleUser + sendInChunks (reuse pattern)

```ts
interface EligibleUser {
  pushToken: string;
}

// sendInChunks — same pattern as PriceRiseAlertService; extract to shared helper if desired
private async sendAlerts(users: EligibleUser[]): Promise<void> {
  const messages: ExpoPushMessage[] = users.map((u) => ({
    to: u.pushToken,
    title: PUSH_TITLE,
    body: PUSH_BODY,
    data: { route: '/map' },
    sound: 'default' as const,
  }));

  const chunks = this.expoPush.chunkMessages(messages);
  for (const chunk of chunks) {
    try {
      const tickets = await this.expoPush.sendChunk(chunk);
      for (const ticket of tickets) {
        if (ticket.status === 'error') {
          if (ticket.details?.error === 'DeviceNotRegistered') {
            this.logger.warn('DeviceNotRegistered — stale token on predictive rise alert');
          } else {
            this.logger.warn(`Push ticket error: ${ticket.message}`);
          }
        }
      }
    } catch (e) {
      this.logger.error(`Failed to send predictive rise chunk: ${(e as Error).message}`);
    }
  }
}
```

### Project Structure Notes

- `apps/api/src/alert/predictive-rise-alert.service.ts` (new)
- `apps/api/src/alert/predictive-rise-alert.worker.ts` (new)
- `apps/api/src/alert/alert.module.ts` (modified — new providers + `price-rise-signals` queue registration)
- `apps/api/src/alert/alert.worker.ts` (modified — remove cron schedule registrations, add deprecation comment)
- `apps/api/src/market-signal/price-rise-signal.publisher.ts` (modified — add 60s delay for brent_crude_pln signals)
- `apps/api/src/alert/predictive-rise-alert.service.spec.ts` (new)
- **No schema changes** — `rise_predictive_enabled` column from Story 6.4
- **No mobile changes** — deep-links to existing `/map` route

### References

- Phase 1 alert service (pattern to follow): [apps/api/src/alert/alert.service.ts](apps/api/src/alert/alert.service.ts)
- Phase 1 alert worker (to be partially deprecated): [apps/api/src/alert/alert.worker.ts](apps/api/src/alert/alert.worker.ts)
- `PriceRiseSignalJobData` + `PRICE_RISE_SIGNALS_QUEUE`: Story 6.0 — [apps/api/src/market-signal/price-rise-signal.publisher.ts](apps/api/src/market-signal/price-rise-signal.publisher.ts)
- `PriceRiseSignalPublisher.maybePublish()`: Story 6.0 — Brent delay added here
- Story 6.2: reads `alert:rise:predictive:{fuelType}` set by this story
- Story 6.4: `rise_predictive_enabled` column on `NotificationPreference`
- Story epics spec: [_bmad-output/planning-artifacts/epics.md](_bmad-output/planning-artifacts/epics.md) — Story 6.3 (line ~2567)

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List

- `apps/api/src/alert/predictive-rise-alert.service.ts` (new)
- `apps/api/src/alert/predictive-rise-alert.worker.ts` (new)
- `apps/api/src/alert/alert.module.ts` (modified)
- `apps/api/src/alert/alert.worker.ts` (modified — deprecate scheduled cron jobs)
- `apps/api/src/market-signal/price-rise-signal.publisher.ts` (modified — Brent 60s delay)
- `apps/api/src/alert/predictive-rise-alert.service.spec.ts` (new)
- `_bmad-output/implementation-artifacts/6-3-predictive-rise-alerts.md` (this file)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)
