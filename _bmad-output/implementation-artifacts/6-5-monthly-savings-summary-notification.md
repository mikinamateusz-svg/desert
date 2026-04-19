# Story 6.5: Monthly Savings Summary Notification

Status: ready-for-dev

## Story

As a **driver**,
I want to receive a monthly summary of how much I saved on fuel,
So that I feel the cumulative value of using the app even when I haven't opened it in a while.

## Acceptance Criteria

**AC1 — Scheduled job:**
Given a scheduled job runs on the 1st of each month at 09:00 Warsaw time
When it calculates monthly summaries for the previous calendar month
Then for each driver with ≥1 fill-up with `area_avg_at_fillup` data in that month and positive total savings, their summary is computed and a push notification is sent

**AC2 — Notification copy with leaderboard rank:**
Given a driver's summary includes a leaderboard percentile (Story 6.7)
When the notification is sent
Then the body reads: "You saved 94 PLN on fuel in March — you're in the top 20% of savers in your area!"
And the notification deep-links to `/(app)/savings-summary?year=YYYY&month=M`

**AC3 — Notification copy without leaderboard rank:**
Given no leaderboard data is available for the driver (Story 6.7 not yet deployed, or insufficient area data)
When the notification is sent
Then the body reads: "You saved 94 PLN on fuel in March. Great month!"

**AC4 — No notification when no savings data:**
Given a driver had fill-ups in the previous month but none with `area_avg_at_fillup` set
When the job runs
Then no notification is sent for that driver — savings figure is required

**AC5 — No notification when no fill-ups:**
Given a driver had no fill-ups in the previous month
When the job runs
Then no notification is sent

**AC6 — Preference respected:**
Given a driver has `monthly_summary: false` in their `NotificationPreference`
When the job runs
Then no notification is sent, regardless of savings amount

**AC7 — No push token — silent calculation:**
Given a driver has no `expo_push_token`
When the job runs
Then the summary is calculated and a Redis key is set for Story 6.6 re-prompting (`monthly:summary:calculated:{userId}`)
And no push notification is sent

**AC8 — Chunked sending:**
Given the job runs for potentially thousands of users
When notifications are sent
Then messages are sent in chunks of 100 (Expo limit) with error handling per chunk — partial delivery is acceptable, job does not fail on chunk error

## Tasks / Subtasks

- [ ] T1: Schema — no changes needed (all data from `FillUp.area_avg_at_fillup` added in Story 5.3)

- [ ] T2: `MonthlySummaryNotificationService` (AC1–AC7)
  - [ ] T2a: Create `apps/api/src/monthly-summary/monthly-summary-notification.service.ts`
  - [ ] T2b: Implement `runForMonth(year, month)` — main orchestration; queries all eligible users in bulk; sends notifications in chunks; returns `{ sent, skipped, noToken }`
  - [ ] T2c: Implement `aggregateSavings(year, month)` — single bulk SQL query returning per-user totals for the month
  - [ ] T2d: Implement `buildNotificationPayload(totalSavingsPln, fillupCount, monthLabel, rankingPercentile)` — returns `{ title, body }` with or without leaderboard line (AC2, AC3)

- [ ] T3: `MonthlySummaryNotificationWorker` — BullMQ scheduled job (AC1)
  - [ ] T3a: Create `apps/api/src/monthly-summary/monthly-summary-notification.worker.ts`
  - [ ] T3b: Cron `'0 9 1 * *'` (09:00 on 1st of month), `tz: 'Europe/Warsaw'`, stable jobId `'monthly-summary-notification'`
  - [ ] T3c: In `process()`: calculate previous month's year/month; call `monthlySummaryNotificationService.runForMonth(year, month)`; log completion summary and `[OPS-ALERT]` on failure

- [ ] T4: `MonthlySummaryModule`
  - [ ] T4a: Create `apps/api/src/monthly-summary/monthly-summary.module.ts`
  - [ ] T4b: Import `PrismaModule`, `RedisModule`; provide `EXPO_PUSH_CLIENT`; export `MonthlySummaryNotificationService`
  - [ ] T4c: Import in `apps/api/src/app.module.ts`

- [ ] T5: Tests
  - [ ] T5a: `monthly-summary-notification.service.spec.ts` — `runForMonth`: sends notification for user with positive savings; does not send when `total_savings <= 0`; does not send when no fill-ups; does not send when `monthly_summary: false`; does not send when no push token but sets Redis key (AC7); sends "Great month!" copy when `rankingPercentile` is null; sends leaderboard copy when `rankingPercentile` is present; notification deep-links to correct savings-summary URL
  - [ ] T5b: Full regression suite — all existing tests still pass

## Dev Notes

### aggregateSavings() — bulk query

Single query to get all eligible users' savings for the previous month:

```sql
SELECT
  f.user_id,
  COUNT(*)::int                                                   AS fillup_count,
  SUM((f.area_avg_at_fillup - f.price_per_litre_pln) * f.litres)::float AS total_savings_pln
FROM "FillUp" f
WHERE f.filled_at >= ${monthStart}
  AND f.filled_at <  ${monthEnd}
  AND f.area_avg_at_fillup IS NOT NULL
GROUP BY f.user_id
HAVING SUM((f.area_avg_at_fillup - f.price_per_litre_pln) * f.litres) > 0
```

`monthStart` = first day of previous month (midnight UTC); `monthEnd` = first day of current month.

Returns only users with positive savings — negative months are excluded (AC4, consistent with Story 5.7's share button rule).

### runForMonth() implementation

```ts
async runForMonth(year: number, month: number): Promise<RunResult> {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd   = new Date(year, month, 1);
  const monthLabel = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' })
    .format(monthStart); // e.g. "March 2026"

  // 1. Bulk savings aggregate
  const savings = await this.aggregateSavings(monthStart, monthEnd);
  if (savings.length === 0) {
    this.logger.log(`No eligible users with positive savings for ${monthLabel}`);
    return { sent: 0, skipped: 0, noToken: 0 };
  }

  // 2. Load notification preferences for these users
  const userIds = savings.map((s) => s.user_id);
  const prefs = await this.prisma.notificationPreference.findMany({
    where: { user_id: { in: userIds } },
    select: { user_id: true, expo_push_token: true, monthly_summary: true },
  });
  const prefMap = new Map(prefs.map((p) => [p.user_id, p]));

  let sent = 0, skipped = 0, noToken = 0;
  const messages: Array<{ token: string; title: string; body: string; deepLink: string }> = [];

  for (const row of savings) {
    const pref = prefMap.get(row.user_id);
    if (!pref?.monthly_summary) { skipped++; continue; }

    if (!pref.expo_push_token || !this.expoPush.isValidToken(pref.expo_push_token)) {
      // AC7: set re-prompt signal for Story 6.6
      await this.redis
        .set(`monthly:summary:calculated:${row.user_id}`, '1', 'EX', 45 * 24 * 3600)
        .catch(() => {}); // best-effort
      noToken++;
      continue;
    }

    // rankingPercentile: null until Story 6.7 ships
    const { title, body } = this.buildNotificationPayload(
      row.total_savings_pln,
      row.fillup_count,
      monthLabel,
      null, // rankingPercentile
    );

    messages.push({
      token: pref.expo_push_token,
      title,
      body,
      deepLink: `/savings-summary?year=${year}&month=${month}`,
    });
    sent++;
  }

  // 3. Send in chunks
  await this.sendInChunks(messages, year, month);

  this.logger.log(
    `Monthly summary for ${monthLabel}: sent=${sent}, skipped=${skipped}, noToken=${noToken}`,
  );
  return { sent, skipped, noToken };
}
```

### buildNotificationPayload()

```ts
private buildNotificationPayload(
  totalSavingsPln: number,
  fillupCount: number,
  monthLabel: string,        // e.g. "March 2026"
  rankingPercentile: number | null,
): { title: string; body: string } {
  const savingsRounded = Math.round(totalSavingsPln);
  const title = `You saved ${savingsRounded} PLN on fuel in ${monthLabel}`;

  const body = rankingPercentile !== null
    ? `${title} — you're in the top ${rankingPercentile}% of savers in your area!`
    : `${title}. Great month!`;

  return { title: 'Your monthly fuel summary is ready', body };
}
```

Note: `title` is the push notification title shown in the OS notification shade; `body` contains the specific savings amount. Keeping them separate allows the OS to truncate gracefully.

### sendInChunks()

```ts
private async sendInChunks(
  messages: Array<{ token: string; title: string; body: string; deepLink: string }>,
  year: number,
  month: number,
): Promise<void> {
  const pushMessages: ExpoPushMessage[] = messages.map((m) => ({
    to: m.token,
    title: m.title,
    body: m.body,
    data: { route: `/(app)/savings-summary?year=${year}&month=${month}` },
    sound: 'default' as const,
  }));

  const chunks = this.expoPush.chunkMessages(pushMessages);
  for (const chunk of chunks) {
    try {
      const tickets = await this.expoPush.sendChunk(chunk);
      for (const ticket of tickets) {
        if (ticket.status === 'error') {
          if (ticket.details?.error === 'DeviceNotRegistered') {
            this.logger.warn('DeviceNotRegistered on monthly summary — stale token');
          } else {
            this.logger.warn(`Push ticket error: ${ticket.message}`);
          }
        }
      }
    } catch (e) {
      // Partial delivery — log and continue next chunk
      this.logger.error(`Monthly summary chunk failed: ${(e as Error).message}`);
    }
  }
}
```

### Previous month calculation

```ts
// In MonthlySummaryNotificationWorker.process():
function previousMonth(): { year: number; month: number } {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1); // first day of previous month
  return { year: d.getFullYear(), month: d.getMonth() + 1 };    // month is 1-indexed
}
```

The job fires on the 1st of each month at 09:00 Warsaw, so `now.getMonth() - 1` always gives the correct previous month (including December → November across year boundary because `Date` handles negative month indices).

### Cron expression

`'0 9 1 * *'` — at 09:00 on the 1st of every month.
`tz: 'Europe/Warsaw'` — Warsaw time (09:00 CET/CEST, which is 08:00 or 07:00 UTC depending on DST).

```ts
await this.queue.add(
  MONTHLY_SUMMARY_JOB,
  {},
  {
    repeat: { pattern: '0 9 1 * *', tz: 'Europe/Warsaw' },
    jobId: 'monthly-summary-notification',
    ...JOB_OPTIONS,
  },
);
```

`jobId` is stable — BullMQ creates only one repeat entry regardless of how many times the process restarts.

### Deep-link format

```
Route: /(app)/savings-summary?year=YYYY&month=M
Notification data: { route: '/(app)/savings-summary?year=2026&month=3' }
```

The savings summary screen (Story 5.7) handles `year` and `month` as query params and loads the appropriate month's data on mount.

### Redis key for Story 6.6 re-prompting

When a user has no push token (or `expo_push_token` is null/invalid):

```ts
await this.redis.set(
  `monthly:summary:calculated:${userId}`,
  '1',
  'EX', 45 * 24 * 3600, // 45 days — survives until next month's job
);
```

Story 6.6 reads this key on app open to decide whether to show the re-prompt.

### Leaderboard rank (Story 6.7)

`rankingPercentile` is `null` in this story — Story 6.7 will populate it. The `buildNotificationPayload()` handles null gracefully with the "Great month!" copy (AC3). When Story 6.7 ships, `runForMonth()` will be extended to join leaderboard data — not a breaking change.

### RunResult type

```ts
interface RunResult {
  sent: number;
  skipped: number; // monthly_summary: false
  noToken: number; // no push token — re-prompt key set
}
```

### NotificationPreference columns consumed

Story 6.5 reads — but does not define:
- `monthly_summary Boolean @default(true)` — Phase 1 column, already in schema
- `expo_push_token String?` — Phase 1 column, already in schema

No schema changes in this story.

### Project Structure Notes

- New directory: `apps/api/src/monthly-summary/`
  - `monthly-summary-notification.service.ts` (new)
  - `monthly-summary-notification.worker.ts` (new)
  - `monthly-summary.module.ts` (new)
  - `monthly-summary-notification.service.spec.ts` (new)
- `apps/api/src/app.module.ts` (modified — import `MonthlySummaryModule`)
- **No schema changes**
- **No mobile changes** — notification deep-links to existing `savings-summary.tsx` screen (Story 5.7)

### References

- Worker cron pattern: [apps/api/src/station/station-sync.worker.ts](apps/api/src/station/station-sync.worker.ts)
- `ExpoPushProvider` + chunked send: [apps/api/src/alert/expo-push.provider.ts](apps/api/src/alert/expo-push.provider.ts)
- `EXPO_PUSH_CLIENT` injection token: [apps/api/src/alert/expo-push.token.ts](apps/api/src/alert/expo-push.token.ts)
- Savings summary screen (deep-link target): Story 5.7 — `apps/mobile/app/(app)/savings-summary.tsx`
- Story 6.6: reads `monthly:summary:calculated:{userId}` Redis key set here
- Story 6.7: will populate `rankingPercentile` in `buildNotificationPayload()`
- Story epics spec: [_bmad-output/planning-artifacts/epics.md](_bmad-output/planning-artifacts/epics.md) — Story 6.5 (line ~2650)

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List

- `apps/api/src/monthly-summary/monthly-summary-notification.service.ts` (new)
- `apps/api/src/monthly-summary/monthly-summary-notification.worker.ts` (new)
- `apps/api/src/monthly-summary/monthly-summary.module.ts` (new)
- `apps/api/src/monthly-summary/monthly-summary-notification.service.spec.ts` (new)
- `apps/api/src/app.module.ts` (modified)
- `_bmad-output/implementation-artifacts/6-5-monthly-savings-summary-notification.md` (this file)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)
