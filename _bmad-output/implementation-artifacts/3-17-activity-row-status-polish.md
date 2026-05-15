# Story 3.17: Activity Row Status Polish + Admin Cleanup

Status: done
Shipped: 2026-05-07 (commit dab4dd2)

**Trigger:** 2026-05-07 — 3.14 (commit `a56484b`) and 3.16 (commit `8ffc266`) just shipped. Both stories left the activity-row UX deliberately minimal ("Under review" generic fallback, no tap-to-explain) and deferred several admin-side polish items to here. This story closes those loops before launch — using the deterministic `flag_reason` taxonomy we already have in code, not waiting 30 days for frequency data (a richer copy revision based on real usage is explicitly tracked as a future iteration in Out of Scope below).

**Phase:** 1 (pre-launch quality loop). Coupled stories shipped: 3.14, 3.16. 3.15 (optimistic activity UI) — remaining slice was absorbed by 3.14 P-16 optimistic flag-wrong; not picked up.

---

## Story

As a **driver**,
I want to understand *why* one of my submissions was rejected or is still under review, and to know whether to retake the photo, fix something obvious, or wait,
so that I'm not staring at a blank "Under review" with no signal what to do next.

As an **admin**,
I want a one-tap `Approve older` action on conflict pairs (instead of "newer unusable then approve via single-row review"), a confirmation prompt before the destructive `Both unusable` action, and a click-through from a `user_flagged_wrong` row to the submission whose prices were restored,
so that paired-review is symmetric, accidental clicks don't lose data, and I can verify a flag-wrong restored the right prior prices.

### Why

3.14's AC5 set up three fallback strings for `shadow_rejected` rows: `Withdrawn — under review` for `user_flagged_wrong`, `Checking price match` for `price_conflict`, and a generic `Under review` for everything else. That last bucket today catches **eleven** distinct `flag_reason` values — each tells the driver something different and demands a different next-action:

- `pb95_outside_rack_band` / `on_outside_rack_band` / `lpg_outside_rack_band` (rack-relative rule fired) — admin will eyeball the photo; nothing to do.
- `dlq_final_failure` (pipeline gave up after 3 retries) — usually a transient infra hiccup; retake will probably succeed.
- `low_trust` (trust score below threshold) — driver can't fix this; admin reviews.
- `logo_mismatch` (photo doesn't match GPS-matched station's brand) — likely wrong station picked; retake at the right station.
- `dead_letter_discarded` (admin discarded the DLQ job) — terminal, no action.
- `no_prices_extracted` / `no_station_match` / `price_out_of_range` — captured at intake; rejected status, not shadow.
- `auto_resolved_by_*` (paired-review cascades from 3.16) — terminal; the partner submission won.
- `admin_marked_unusable` (paired-review's Both unusable / Newer unusable terminal) — terminal.

Three problems compound:
1. The driver sees the same generic copy regardless. No actionable signal.
2. There's no way to read the longer explanation — even if we wrote one, the row footprint is tiny.
3. Long-lived shadow_rejected rows give no sense of how long admin has been sitting on them.

3.17 replaces the generic with **deterministic per-reason inline copy** for the full taxonomy, adds a **bottom-sheet tap-to-explain modal** that lets us put a real explanation + a context-appropriate CTA, and shows a **staleness hint** (`· Od X dni`) on rows older than 6h.

On the admin side, 3.16's review explicitly deferred (a) a confirmation dialog for `Both unusable`, (b) a direct `Approve older` button (currently a 2-tap workaround via "newer unusable" + single-row approve of older), and (c) surfacing `restored_from_submission_id` from 3.14's audit log so admin can verify the right prior prices were rolled back. 3.17 picks all three up in one pass plus a small UK-locale typo fix.

---

## Acceptance Criteria

**AC1 — Per-reason inline copy on activity rows for the full known taxonomy:**
Given an activity row with `status: 'shadow_rejected'` OR `status: 'rejected'` AND a non-null `flag_reason`,
When the row renders,
Then the inline italic line shows reason-specific copy for every value in the known taxonomy:

| `flag_reason`                  | Inline label (PL)                          | Status branch     | Driver action implied |
|--------------------------------|--------------------------------------------|-------------------|-----------------------|
| `user_flagged_wrong`           | *Wycofane — w trakcie przeglądu*           | shadow_rejected   | Wait + retake offered |
| `price_conflict`               | *Sprawdzamy zgodność cen*                  | shadow_rejected   | Wait                  |
| `pb95_outside_rack_band`       | *Cena PB 95 odbiega od rynku — sprawdzamy* | shadow_rejected   | Wait                  |
| `on_outside_rack_band`         | *Cena ON odbiega od rynku — sprawdzamy*    | shadow_rejected   | Wait                  |
| `lpg_outside_rack_band`        | *Cena LPG odbiega od rynku — sprawdzamy*   | shadow_rejected   | Wait                  |
| `low_trust`                    | *Oczekuje na weryfikację konta*            | shadow_rejected   | Wait                  |
| `logo_mismatch`                | *Logo nie pasuje do stacji — sprawdzamy*   | shadow_rejected   | Maybe retake          |
| `dlq_final_failure`            | *Nie udało się przetworzyć — spróbuj ponownie* | shadow_rejected | Retake               |
| `auto_resolved_by_resubmit`    | *Zastąpione nowszym zgłoszeniem*           | rejected          | Terminal              |
| `auto_resolved_by_newer`       | *Zastąpione nowszym zgłoszeniem*           | rejected          | Terminal              |
| `auto_resolved_by_older`       | *Zastąpione wcześniejszym zgłoszeniem*     | rejected          | Terminal              |
| `admin_marked_unusable`        | *Zgłoszenie odrzucone przez moderację*     | rejected          | Terminal              |
| `duplicate_submission`         | *Już mamy świeże zgłoszenie z tej stacji*  | rejected          | Terminal              |
| `no_prices_extracted`          | *Nie udało się odczytać cen ze zdjęcia*    | rejected          | Retake closer         |
| `no_station_match`             | *Nie znaleziono stacji w pobliżu*          | rejected          | Retake at a station   |
| `price_out_of_range`           | *Cena poza zakresem — sprawdź zdjęcie*     | rejected          | Retake                |
| `no_gps_coordinates`           | *Brak lokalizacji — włącz GPS i ponów*     | rejected          | Retake with GPS       |
| `dead_letter_discarded`        | *Zgłoszenie zostało odrzucone*             | rejected          | Terminal              |
| any other / null `flag_reason` | *W trakcie przeglądu* (shadow_rejected) / *Odrzucone* (rejected) | either | Wait |

EN/UK translations follow the same matrix; copy authored per market when we expand. The PL strings ship as the canonical source.

**AC2 — Tap-to-explain modal for non-verified rows with a known flag_reason:**
Given a row in `shadow_rejected` or `rejected` AND its `flag_reason` is in the AC1 taxonomy (i.e., we have copy for it),
When the driver taps the row,
Then a bottom-sheet modal opens (matching the `FlagWrongConfirmSheet` pattern from 3.14: `Modal transparent visible animationType="slide"`, overlay tap-to-dismiss, handle bar, content card) showing:

- **Title:** the inline label from AC1.
- **Body:** a longer plain-language explanation (1–3 sentences) per `flag_reason`. PL canonical; see Dev Notes for the explanation table.
- **Photo thumbnail (where available):** if the row has `price_data` we don't render a photo (the photo is server-side R2-only and not on the client); the modal omits a thumbnail for v1. Tracked in Out of Scope as a future presigned-URL fetch.
- **Primary CTA:** context-appropriate, one of:
  - `Zrób nowe zdjęcie` (`/(app)/capture` route) for retake-able cases: `dlq_final_failure`, `logo_mismatch`, `no_prices_extracted`, `no_station_match`, `no_gps_coordinates`, `price_out_of_range`, `user_flagged_wrong`.
  - `Rozumiem` (dismiss only) for terminal cases: all `auto_resolved_*`, `admin_marked_unusable`, `duplicate_submission`, `dead_letter_discarded`.
  - `Skontaktuj się z pomocą` (opens an `mailto:` to the support address from `EXPO_PUBLIC_SUPPORT_EMAIL`) for admin-blocked cases: `low_trust`. Falls back to `Rozumiem` if env not set.
- **Secondary action:** `Zamknij` (dismiss).

For `verified` rows, tap continues to navigate to the station detail screen (existing behavior, unchanged). For `pending` rows, tap is a no-op (existing behavior). For rows with a `flag_reason` we don't have copy for (e.g. a future rule reason code), tap opens the modal with the generic AC1 fallback copy and a `Rozumiem` CTA.

**AC3 — Staleness hint on long-lived shadow_rejected rows:**
Given a row with `status: 'shadow_rejected'` AND `flag_reason !== 'shadow_banned'` (the laundering invariant from Story 4.3 stays unchanged) AND `Date.now() - new Date(item.created_at).getTime() > 6 * 3600 * 1000`,
When the row renders,
Then the inline italic line is suffixed with ` · Od X godz.` (≥6h) or ` · Od X dni` (≥48h, expressed in whole days, rounded down).

The threshold is 6 hours, not "the moment the row goes shadow_rejected" — for fresh flags the inline label alone is enough, and the staleness suffix would just add visual noise. PL-only humanization for v1; EN/UK fall back to PL string at runtime if the locale-specific keys aren't present (matches the existing `i18next` resolution).

**AC4 — Confirmation prompt before `Both unusable` (3.16 D-4):**
Given an admin viewing a `ConflictPairCard` and tapping the `Oba nieprzydatne` / `Both unusable` button,
When the click fires,
Then a confirmation modal opens (mirrors the mobile `FlagWrongConfirmSheet` pattern but in admin idiom — could be a Tailwind-native dialog) asking *Are you sure? Both submissions will be rejected and the dedup record cleared.* with two buttons: `Anuluj` / `Cancel` (left, secondary) and `Tak, oba nieprzydatne` / `Yes, mark both unusable` (right, primary destructive — red).

The action only fires when the admin explicitly confirms. The other two pair actions (`Approve newer`, `Newer unusable`) are non-destructive (one row to verified, the other to rejected with a recoverable reason) and stay one-tap. `Approve older` (AC5 below) is destructive in the same sense as `Both unusable` would be… actually no — it verifies the older and rejects the newer with `auto_resolved_by_older`, which is recoverable via admin re-review. One-tap is fine.

**AC5 — `Approve older` button on the conflict pair card (3.16 deferred AC9 carve-out):**
Given an admin viewing a `ConflictPairCard`,
When the card renders,
Then a fourth action button `Zatwierdź starsze` / `Approve older` appears alongside the existing three (`Approve newer`, `Newer unusable`, `Both unusable`),
And tapping it calls a new `POST /v1/admin/submissions/conflict/:conflictGroupId/approve-older` endpoint with body `{ submission_id: <older's id> }`.

**Backend behavior** (`AdminSubmissionsService.approveOlder(adminId, conflictGroupId, olderSubmissionId)`):
- Status guards on both rows (same `WHERE status='shadow_rejected' AND conflict_group_id=<id> AND flag_reason='price_conflict'` pattern as `approveNewer`).
- Atomic flip in a `prisma.$transaction`:
  - Older → `verified`, `flag_reason: null`.
  - Newer → `rejected`, `flag_reason: 'auto_resolved_by_older'` (NEW value — additive, no migration; `Submission.flag_reason` is already a nullable text column).
- Cache rewrite via `priceService.setVerifiedPrice` with the older's `price_data` (filter null/non-finite first, mirror `approveNewer`'s P-14 pattern).
- Consensus seed via `submissionDedupService.recordStationConsensus` `{ count: 2, confirmed: true, prices_hash: hash(older.price_data), last_at: now }` (mirrors P-24 from 3.16 — the next driver skips OCR after admin-confirmed prices).
- Audit: `APPROVE_OLDER` action on older; `AUTO_RESOLVED_BY_OLDER` on newer. Both reuse the per-row `partner_submission_id` notes pattern from 3.16 P-12.

Same `loadConflictPair` validation: throws `BadRequestException` if `submission_id` doesn't match the older half, `ConflictException` if pair is no longer intact or has more than 2 active members.

Visual ordering on the card: `Approve newer` (primary) | `Approve older` (secondary) | `Newer unusable` (tertiary) | `Both unusable` (destructive, with confirmation).

**AC6 — Admin detail page surfaces `restored_from_submission_id` for `user_flagged_wrong` rows (3.14 D-4):**
Given an admin opens `/submissions/:id` for a row with `flag_reason: 'user_flagged_wrong'`,
When the page loads,
Then a new detail section *Restored from* / *Przywrócono z* shows the `restored_from_submission_id` value from the matching `AdminAuditLog` row's `notes` JSON (action `USER_FLAGGED_WRONG`, the most recent for this submission),
And the value is rendered as a clickable `<Link href={`/submissions/${restoredFromId}`}>...</Link>` so the admin can navigate to that submission's detail (or shows *—* if the audit row exists but `restored_from_submission_id` is null, which is the "no previous, cache invalidated" case).

If no audit row matches (defensive: every flag-wrong should have written one, but a `.catch()` could have eaten it), the section is omitted entirely — no error, no placeholder.

**Backend addition** (`AdminSubmissionsService.getDetail` extension):
- After fetching the existing submission detail, when `submission.flag_reason === 'user_flagged_wrong'`, query `prisma.adminAuditLog.findFirst({ where: { submission_id: id, action: 'USER_FLAGGED_WRONG' }, orderBy: { created_at: 'desc' }, select: { notes: true } })`.
- Parse `notes` JSON; extract `restored_from_submission_id`. Defensive `try/catch` around `JSON.parse` — bad JSON → omit the field (don't 500 the detail page).
- Surface as new optional field `restored_from_submission_id: string | null` on `FlaggedSubmissionDetail`.

**AC7 — UK locale typo fix (3.16 D-6):**
Given the existing UK locale strings in `apps/admin/lib/i18n.ts`:
- `flagReason.price_conflict: 'Сирпечні ціни'`
- `conflictGroupBadge: 'Сирпечні заявки'`

When the locale loads,
Then both strings read `Конфліктні` rather than `Сирпечні` (`Сирпечні` is not a Ukrainian word — it was a fat-finger / pseudo-translation in 3.16). Final UK strings:
- `flagReason.price_conflict: 'Конфліктні ціни'`
- `conflictGroupBadge: 'Конфліктні заявки'`

**AC8 — Test coverage:**
- Unit: `apps/api/src/admin/admin-submissions.service.spec.ts` — `approveOlder` happy path (transactional flip + cache + consensus seed + distinct audit actions); status-guard race (newer count: 0 → ConflictException with rollback); BadRequestException for wrong submission id; ConflictException for pair-not-intact and N>2.
- Unit: `apps/api/src/admin/admin-submissions.service.spec.ts` — `getDetail` returns `restored_from_submission_id` when audit row exists; null when audit notes lack the field; field omitted when audit row missing entirely or notes JSON is malformed.
- Mobile component logic: extract the per-reason copy lookup into a pure helper (`flagReasonCopy(flag_reason): { label: string; explanation: string; cta: 'retake'|'dismiss'|'support' }`) in `apps/mobile/src/components/activity/flagReasonCopy.ts` so it can be unit-tested without rendering. Cover: every code in AC1, the null fallback, an unknown code (returns generic + `dismiss` CTA).
- Mobile component logic: `staleness(createdAt: Date, now: Date): string | null` helper for AC3 — covers `<6h → null`, `6h..47h → 'Od X godz.'`, `>=48h → 'Od X dni'`.
- Manual: regression on 3.14 self-flag → modal opens, retake CTA navigates to capture; 3.16 paired-review → confirmation appears for Both unusable, Approve older flips correctly; UK locale renders without `Сирпечні`.

---

## Tasks / Subtasks

Numbered for sequencing. Two slices: backend (T1–T4) + admin UI (T5–T7) + mobile (T8–T11).

### Backend slice (T1–T4)

- [ ] **T1 — `AdminSubmissionsService.approveOlder` method (AC: 5)**
  - [ ] Add public method `approveOlder(adminUserId, conflictGroupId, olderSubmissionId): Promise<void>` to `apps/api/src/admin/admin-submissions.service.ts`.
  - [ ] Reuse the existing `loadConflictPair` (validates pair intact + N≤2; throws `BadRequestException` if `olderSubmissionId !== pair.older.id`).
  - [ ] Wrap the two flips in `prisma.$transaction` matching `approveNewer`'s P-9 pattern: older → `verified`, newer → `rejected` with `flag_reason: 'auto_resolved_by_older'`. Both updates use `updateMany` with status + group + `flag_reason: 'price_conflict'` guards; throw `ConflictException` on `count: 0`.
  - [ ] Outside the transaction (best-effort): filter `pair.older.price_data` for finite prices, build `StationPriceRow`, call `priceService.setVerifiedPrice(pair.older.station_id, priceRow)` with `.catch()` log.
  - [ ] Outside the transaction (best-effort): `submissionDedupService.recordStationConsensus(pair.older.station_id, { count: 2, confirmed: true, prices_hash: SubmissionDedupService.hashPriceData(validOlderPrices), last_at: Date.now() })` with `.catch()` log.
  - [ ] Add the two new audit-action constants near the existing 3.16 ones: `AUDIT_ACTION_APPROVE_OLDER = 'APPROVE_OLDER'` and `AUDIT_ACTION_AUTO_RESOLVED_BY_OLDER = 'AUTO_RESOLVED_BY_OLDER'`. Per-row audit writes wrapped in `.catch(() => {})` per the 3.16 P-11 pattern.

- [ ] **T2 — `POST /v1/admin/submissions/conflict/:conflictGroupId/approve-older` endpoint (AC: 5)**
  - [ ] Add to `apps/api/src/admin/admin-submissions.controller.ts`. Decorators: `@Post('conflict/:conflictGroupId/approve-older')`, `@Roles(UserRole.ADMIN)`, `@HttpCode(HttpStatus.OK)`.
  - [ ] `@Param('conflictGroupId', ParseUUIDPipe) conflictGroupId: string`, `@Body() body: ConflictNewerDto` (the existing DTO works — same `submission_id: string` UUID-validated body shape; consider renaming to `ConflictPairTargetDto` for clarity, or just reuse as-is and document in a comment that it's also used for the older target).
  - [ ] Returns `{ status: 'resolved' }` matching the existing three actions.

- [ ] **T3 — `getDetail` surfaces `restored_from_submission_id` (AC: 6)**
  - [ ] Extend `FlaggedSubmissionDetail` interface with `restored_from_submission_id: string | null` (optional field — not present on rows where audit row missing or `flag_reason !== 'user_flagged_wrong'`, but expose it as `string | null` for type stability).
  - [ ] In `AdminSubmissionsService.getDetail`, after the existing submission fetch and BEFORE the photo-URL resolution: when `submission.flag_reason === 'user_flagged_wrong'`, query the most recent matching audit row, parse `notes` JSON, extract `restored_from_submission_id`. Wrap parse in try/catch — return `null` on any failure (don't 500).
  - [ ] Mirror the field on the admin side — add to `apps/admin/lib/types.ts` `FlaggedSubmissionDetail`.

- [ ] **T4 — Backend tests (AC: 8)**
  - [ ] `admin-submissions.service.spec.ts`: 4 new tests for `approveOlder` (happy path with cache/consensus/audit; status-race on newer; BadRequest for wrong id; ConflictException for >2 members). Reuse the existing `mockTransaction` callback handling from 3.16's spec.
  - [ ] `admin-submissions.service.spec.ts`: 3 new tests for `getDetail` restored_from surfacing (audit row present with notes; audit row present but notes missing the field; audit row missing entirely). Add `mockAuditLogFindFirst = jest.fn()` and wire into the existing prisma mock.

### Admin UI slice (T5–T7)

- [ ] **T5 — `Approve older` button on the conflict pair card (AC: 5)**
  - [ ] Add `approveOlderInConflict` server action to `apps/admin/app/(protected)/submissions/actions.ts`, mirroring `approveNewerInConflict`.
  - [ ] Add a new translation key `t.review.conflictApproveOlder` (PL: `Zatwierdź starsze` / EN: `Approve older` / UK: `Затвердити старішу`). Add to all three locales' `review` blocks.
  - [ ] In `ConflictPairCard.tsx`, add a fourth button between `Approve newer` and `Newer unusable`, styled as a soft-green secondary action (`bg-emerald-100 text-emerald-900 hover:bg-emerald-200`) — visually echoing the primary green `Approve newer` to signal "also-approve" while staying clearly subordinate, and distinct from the tertiary `Newer unusable`. (Original spec called for a border/white/gray-700 button; the soft-green styling reads more cleanly alongside the primary action and was confirmed during T12 review.) Uses the existing `handle` helper.
  - [ ] Update the `copy` prop type + the page.tsx pass-through to include `approveOlder` and the new `older` action handler.

- [ ] **T6 — `Both unusable` confirmation (AC: 4)**
  - [ ] Add a `confirmingBothUnusable: boolean` local state to `ConflictPairCard.tsx`. The `Both unusable` button toggles to confirmation mode (replaces the button row with a tight inline confirm: *Are you sure?* + `Cancel` / `Yes, mark both unusable`) — keeps the user in-context, no full modal needed.
  - [ ] On confirm, fire `markBothUnusableInConflict` (existing). On cancel, return to the four-button row.
  - [ ] i18n keys: `t.review.confirmBothUnusableTitle` (PL: `Oznaczyć oba jako nieprzydatne?`, EN: `Mark both unusable?`), `t.review.confirmBothUnusableYes` (PL: `Tak, oba nieprzydatne`, EN: `Yes, both unusable`). Cancel reuses existing `t.review.cancel`.
  - [ ] Visual: the confirm button uses `bg-red-600 hover:bg-red-700 text-white` to signal destructive intent — distinct from the existing gray "both unusable" trigger.

- [ ] **T7 — Admin detail page surfaces `restored_from_submission_id` (AC: 6, 7)**
  - [ ] In `apps/admin/app/(protected)/submissions/[id]/page.tsx`, after the existing detail rows and only when `submission.flag_reason === 'user_flagged_wrong'` AND `submission.restored_from_submission_id`, render a new `<DetailRow label={t.review.restoredFromLabel}>` containing a `<Link href={`/submissions/${submission.restored_from_submission_id}`}>...</Link>` that shows the truncated id `XXXXXXXX…`.
  - [ ] When `restored_from_submission_id` is null but the row IS `user_flagged_wrong` (the "cache invalidated, no prior" case), render the row with a `—` value so admin sees the explicit "no prior to restore" signal.
  - [ ] When the row is not `user_flagged_wrong` at all, omit the section.
  - [ ] i18n keys: `t.review.restoredFromLabel` (PL: `Przywrócono z`, EN: `Restored from`, UK: `Відновлено з`), `t.review.restoredFromNone` (PL: `brak (cache odświeżony estymatami)`, EN: `none (cache fell back to estimates)`, UK: `немає (кеш оновлено оцінками)`).
  - [ ] **AC7 typo fix:** in the same i18n.ts pass, replace `'Сирпечні ціни'` → `'Конфліктні ціни'` and `'Сирпечні заявки'` → `'Конфліктні заявки'` (UK block only).

### Mobile slice (T8–T11)

- [ ] **T8 — `flagReasonCopy` helper (AC: 1, 2, 8)**
  - [ ] Create `apps/mobile/src/components/activity/flagReasonCopy.ts` exporting:
    ```ts
    export type FlagReasonCta = 'retake' | 'dismiss' | 'support';
    export interface FlagReasonCopy {
      label: string;        // for the inline italic line on the row
      explanation: string;  // for the modal body
      cta: FlagReasonCta;
    }
    export function flagReasonCopy(flagReason: string | null, status: 'shadow_rejected' | 'rejected', t: TFunction): FlagReasonCopy;
    ```
  - [ ] All copy strings come from the i18n bundle (T11 adds the keys). The function is a pure switch on `flag_reason` returning the matching keys' values.
  - [ ] Unknown / null `flag_reason`: return generic fallback (`Under review` for shadow_rejected, `Odrzucone` for rejected) with `cta: 'dismiss'`.
  - [ ] Co-located unit tests in `apps/mobile/src/components/activity/__tests__/flagReasonCopy.test.ts`: every code in AC1, null, unknown — assert label/explanation pulled from t() and cta is the expected value.

- [ ] **T9 — `staleness` helper + `SubmissionRow` integration (AC: 3, 8)**
  - [ ] Add `apps/mobile/src/components/activity/staleness.ts` exporting `staleness(createdAt: Date, now: Date, t: TFunction): string | null`. Returns `null` when `<6h`, `Od X godz.` (using `t('contribution.flagWrong.stalenessHours', { count: hoursFloor })`) when `6..47h`, `Od X dni` when `≥48h`.
  - [ ] In `SubmissionRow.tsx`, when rendering the `isShadowRejected` branch, compose: `{label}{stalenessSuffix ? ` · ${stalenessSuffix}` : ''}`. Reuse the existing `Date.now()` pattern; pass `new Date()` for `now`.
  - [ ] Unit tests in `apps/mobile/src/components/activity/__tests__/staleness.test.ts`: 5h59m → null; 6h0m → "Od 6 godz."; 47h59m → "Od 47 godz."; 48h → "Od 2 dni"; 7d2h → "Od 7 dni"; very old (1y) → "Od 365 dni".

- [ ] **T10 — `FlagReasonExplainSheet` component + `SubmissionRow` integration (AC: 2)**
  - [ ] Create `apps/mobile/src/components/activity/FlagReasonExplainSheet.tsx`. Match the `FlagWrongConfirmSheet` pattern: `<Modal transparent visible animationType="slide">` + tap-to-dismiss overlay + handle bar + content card.
  - [ ] Props: `{ visible: boolean; flagReason: string | null; status: 'shadow_rejected' | 'rejected'; onDismiss: () => void; }`.
  - [ ] Inside: pull copy via `flagReasonCopy`. Render title (from `label`), body (from `explanation`), single primary CTA whose label and behavior depend on `cta`:
    - `'retake'` → `Zrób nowe zdjęcie` button → `router.push('/(app)/capture')` then dismiss.
    - `'dismiss'` → `Rozumiem` button → just dismiss.
    - `'support'` → `Skontaktuj się z pomocą` → `Linking.openURL('mailto:' + (process.env.EXPO_PUBLIC_SUPPORT_EMAIL ?? ''))` then dismiss; falls back to dismiss-only when env unset.
  - [ ] Secondary `Zamknij` always dismisses.
  - [ ] In `SubmissionRow.tsx`, replace the current "non-tappable for non-verified" pattern with:
    - `verified` rows: tap navigates to station (existing).
    - `shadow_rejected` or `rejected` rows with a non-null `flag_reason`: tap opens `FlagReasonExplainSheet`.
    - `pending` rows or rows with null `flag_reason`: tap is no-op (existing).
  - [ ] Wrap the row body in `TouchableOpacity` for non-pending statuses, with `activeOpacity={0.6}` matching the existing verified path.

- [ ] **T11 — i18n keys for AC1/AC2/AC3 + manual regression (AC: 1, 2, 3)**
  - [ ] Add a new `contribution.flagReason` block (parallel to existing `contribution.flagWrong`) to `apps/mobile/src/i18n/locales/pl.ts`. Keys: one short `label` and one long `explanation` per code in the AC1 table — 17 codes × 2 = 34 keys, plus the two generic fallbacks (`underReviewGeneric`, `rejectedGeneric`) and the staleness keys (`stalenessHours`, `stalenessDays`).
  - [ ] Mirror to `en.ts` and `uk.ts` with reasonable English/Ukrainian translations. (PL is canonical; if any UK string is uncertain, mark with a `// TODO: native review` comment per the project pattern but don't block ship.)
  - [ ] Update existing `contribution.flagWrong.withdrawnLabel` etc. — these are unchanged; the new block coexists with the old one for clarity (the new `flagReason` block houses the generic taxonomy; the old `flagWrong` block stays scoped to the user-flagged-wrong specific UX).

### Code review (T12)

- [x] **T12 — `bmad-code-review` adversarial pass**
  - [ ] Run after T11 against the full diff (backend + admin + mobile).
  - [ ] Findings folded back as Review Patches (Dev Agent Record below).

---

## Dev Notes

### Architecture compliance

- **No new tables, no migrations.** `auto_resolved_by_older` is a new `flag_reason` value; the column is already a nullable text type, so no schema change.
- **NestJS module wiring stays as-is.** `AdminSubmissionsService` already gets `SubmissionDedupService` via `PhotoModule` (added in 3.16); `approveOlder` reuses that injection.
- **Atomic state transitions.** All paired-review actions (now four: approveNewer, approveOlder, markNewerUnusable, markBothUnusable) wrap their flips in `prisma.$transaction` with status guards — same pattern. A future audit could DRY them into a single helper `transitionPair(group, newerData, olderData, ...)` but inline is fine for v1; the explicitness aids review.
- **Best-effort side effects.** Cache writes, consensus seeds, audit log writes are all `.catch()`-wrapped. The DB state-change is the only required operation.
- **Mobile i18n is canonical-PL.** When new keys are added without complete EN/UK translations, the `i18next` resolver falls back to the value in the namespace's first available locale (in our setup, PL) — verified existing pattern. EN/UK are best-effort placeholders for the Łódź launch and will get a proper localization pass before market expansion.
- **Activity-row tap target.** Currently `verified` rows are wrapped in `TouchableOpacity` and other rows are static. Extending tappability to `shadow_rejected`/`rejected` doesn't introduce new accessibility concerns — the modal's `accessibilityRole="button"` and explicit `accessibilityLabel` from the inline label cover screen readers.

### Testing standards

- Backend: Jest + ts-jest under `apps/api`. Tests live alongside the file under test. Spec mocks every direct dependency. The 3.16 admin spec already has `mockSubmissionDedupService` + `mockTransaction` callback handling; T4 extends rather than rebuilds.
- Mobile: Jest under `apps/mobile`. Pure-helper tests (`flagReasonCopy`, `staleness`) follow the established `apps/mobile/src/utils/__tests__/` pattern. No React component tests — manual regression substitutes per Story 3.14's standard.
- Admin: in-house fetch-spy (Story 0.2). Existing AC8 reads add at most a happy-path action test for `approveOlder` if maintenance-of-pattern requires it; otherwise existing single-row admin coverage transits.

### Source tree alignment

- Backend: `apps/api/src/admin/admin-submissions.{controller,service}.ts` extend; `admin-submissions.service.spec.ts` extends.
- Admin UI: `apps/admin/app/(protected)/submissions/actions.ts`, `ConflictPairCard.tsx`, `[id]/page.tsx` extend; `lib/i18n.ts` + `lib/types.ts` extend.
- Mobile: `apps/mobile/src/components/activity/` gains two new helpers (`flagReasonCopy.ts`, `staleness.ts`) + one new component (`FlagReasonExplainSheet.tsx`); `SubmissionRow.tsx` extends; `apps/mobile/src/i18n/locales/{pl,en,uk}.ts` extend.

### Reused vs new — no wheel reinvention

- **Reuse**: `FlagWrongConfirmSheet`'s bottom-sheet pattern (`Modal` + overlay + handle + content card + actions) — `FlagReasonExplainSheet` mirrors it with one CTA instead of two. The `loadConflictPair` helper, transactional flip pattern, audit log emit pattern, consensus seed pattern, cache write pattern — all from 3.16's `approveNewer`. The `flagReason` translation map already exists in admin i18n; new entries slot in. The mobile `SubmissionRow` `shadowRejectedLabel` helper from 3.14 is **replaced by** the new `flagReasonCopy` (3.14 was a 3-case switch; 3.17 is the full taxonomy + explanation).
- **New**: `flagReasonCopy` + `staleness` helpers, `FlagReasonExplainSheet` component, `approveOlder` service method + controller endpoint + admin server action + UI button, `Both unusable` inline confirmation flow, admin detail page `restored_from` row, the `auto_resolved_by_older` flag_reason value.
- **NOT to build**: a separate "FlagReasonRegistry" service or DB-backed copy table (the taxonomy is small and changes infrequently — code is the source of truth); push notifications when shadow_rejected resolves (separate feature, post-MVP); a generic "admin paired actions" abstraction (four explicit methods is more readable than one configurable one).

### Project Structure Notes

Story stays inside conventions established by 3.10 / 3.14 / 3.16. The one expansion worth calling out: this is the first time we surface `AdminAuditLog.notes` content on the admin detail page (3.14 wrote the JSON; 3.17 reads it back). The pattern — `findFirst` matching submission_id + action, parse notes with try/catch — is small enough to inline; if a third call site appears we'll extract a `parseAuditNotes` helper.

The mobile-side first-time pattern: the activity row gains a tap-to-explain interaction for non-verified rows. Today only verified rows are tappable. The interaction is intentionally light (no destructive action, no mutation — just an informational sheet) so the existing screen-reader and pull-to-refresh behaviors don't need adjustment.

### References

- [Story 3.14 — Self-Flag Wrong Prices](./3-14-self-flag-wrong-prices.md) — `FlagWrongConfirmSheet` pattern reused for `FlagReasonExplainSheet`; the `restored_from_submission_id` field comes from the audit log this story writes.
- [Story 3.16 — Consensus-Based Submission Dedup](./3-16-consensus-based-dedup.md) — `approveNewer` / `markNewerUnusable` / `markBothUnusable` patterns reused for `approveOlder`; `ConflictPairCard` extended with a fourth button; D-4 (confirmation) and D-6 (UK typo) absorbed.
- [Story 3.7 — Price Validation & Database Update](./3-7-price-validation-database-update.md) — origin of the `pb95_outside_rack_band`, `on_outside_rack_band`, `lpg_outside_rack_band` rule reason codes that AC1 covers explicitly.
- [Story 3.10 — Submission Deduplication](./3-10-submission-deduplication.md) — origin of `duplicate_submission`.
- [Story 3.8 — Pipeline Retry & DLQ](./3-8-pipeline-retry-dead-letter-queue.md) — origin of `dlq_final_failure`.
- [Story 3.5 — OCR Price Extraction](./3-5-ocr-price-extraction.md) — origin of `no_prices_extracted`, `low_trust`, `price_out_of_range`.
- [Story 3.4 — GPS-to-Station Matching](./3-4-gps-to-station-matching.md) — origin of `no_gps_coordinates`, `no_station_match`.
- [Story 3.6 — Logo Recognition](./3-6-logo-recognition-secondary-signal.md) — origin of `logo_mismatch`.
- [Story 4.3 — Shadow Ban](./4-3-shadow-ban.md) — `shadow_banned` is laundered to pending in the driver-facing list; this story does NOT change that — the AC3 staleness suffix and AC2 modal are gated on `flag_reason !== 'shadow_banned'` to preserve the secrecy invariant.
- `apps/api/src/admin/admin-submissions.service.ts` — extend (`approveOlder`, `getDetail`).
- `apps/api/src/admin/admin-submissions.controller.ts` — extend (`approve-older` endpoint).
- `apps/api/src/admin/admin-submissions.service.spec.ts` — extend (T4 tests).
- `apps/admin/app/(protected)/submissions/ConflictPairCard.tsx` — extend (4th button + Both unusable confirm).
- `apps/admin/app/(protected)/submissions/[id]/page.tsx` — extend (restored_from row).
- `apps/admin/app/(protected)/submissions/actions.ts` — extend (`approveOlderInConflict`).
- `apps/admin/lib/{i18n,types}.ts` — extend (UK typo + new keys + `restored_from_submission_id`).
- `apps/mobile/src/components/activity/SubmissionRow.tsx` — extend (tap-to-explain wiring + staleness suffix).
- `apps/mobile/src/components/activity/FlagReasonExplainSheet.tsx` — new component.
- `apps/mobile/src/components/activity/flagReasonCopy.ts` — new helper.
- `apps/mobile/src/components/activity/staleness.ts` — new helper.
- `apps/mobile/src/i18n/locales/{pl,en,uk}.ts` — extend (`contribution.flagReason` block).

### Modal copy table (PL canonical)

For T11 — drives the `contribution.flagReason.<code>.{label,explanation}` and the modal body strings. Keep these short — drivers are skim-reading on a phone.

| `flag_reason`              | Modal title (label)                          | Modal body (explanation)                                                                                              | CTA      |
|----------------------------|-----------------------------------------------|------------------------------------------------------------------------------------------------------------------------|----------|
| `user_flagged_wrong`       | Wycofane — w trakcie przeglądu                | Sprawdzimy zdjęcie. Możesz od razu zrobić nowe — z bliska lub pod lepszym kątem to bardzo pomaga.                      | retake   |
| `price_conflict`           | Sprawdzamy zgodność cen                       | Inny kierowca podał inne ceny dla tej stacji. Czekamy na rozstrzygnięcie. Twoje zgłoszenie wraca do gry, jeśli wygra.  | dismiss  |
| `pb95_outside_rack_band`   | Cena PB 95 odbiega od rynku                   | OCR odczytał cenę PB 95 daleko od typowych w okolicy. Sprawdzamy ręcznie — zwykle to drobny błąd odczytu.              | dismiss  |
| `on_outside_rack_band`     | Cena ON odbiega od rynku                      | OCR odczytał cenę ON daleko od typowych w okolicy. Sprawdzamy ręcznie — zwykle to drobny błąd odczytu.                 | dismiss  |
| `lpg_outside_rack_band`    | Cena LPG odbiega od rynku                     | OCR odczytał cenę LPG daleko od typowych w okolicy. Sprawdzamy ręcznie — zwykle to drobny błąd odczytu.                | dismiss  |
| `low_trust`                | Oczekuje na weryfikację konta                 | Twoje konto jest jeszcze świeże. Zgłoszenia trafiają do moderacji do czasu pierwszych potwierdzeń. To minie z czasem. | support  |
| `logo_mismatch`            | Logo nie pasuje do stacji                     | Zdjęcie nie pasuje do logo stacji wybranej z mapy. Sprawdź czy stacja jest właściwa — lub zrób nowe zdjęcie.           | retake   |
| `dlq_final_failure`        | Nie udało się przetworzyć zdjęcia             | Coś poszło nie tak po stronie naszego serwera. Spróbuj zrobić zdjęcie jeszcze raz.                                     | retake   |
| `auto_resolved_by_resubmit`| Zastąpione nowszym zgłoszeniem                | Zrobiłeś/aś nowsze zdjęcie tej stacji. Wcześniejsze zgłoszenie zostało rozliczone automatycznie.                       | dismiss  |
| `auto_resolved_by_newer`   | Zastąpione nowszym zgłoszeniem                | Inne zgłoszenie z tej stacji zostało zatwierdzone jako bardziej aktualne. To normalne — dzięki za udział.              | dismiss  |
| `auto_resolved_by_older`   | Zastąpione wcześniejszym zgłoszeniem          | Inne zgłoszenie z tej stacji zostało zatwierdzone jako bardziej wiarygodne. To normalne — dzięki za udział.            | dismiss  |
| `admin_marked_unusable`    | Zgłoszenie odrzucone przez moderację          | Po przejrzeniu uznaliśmy, że tego zdjęcia nie da się dobrze odczytać. Następnym razem celuj bliżej w ceny na pylonie.  | dismiss  |
| `duplicate_submission`     | Już mamy świeże zgłoszenie z tej stacji       | Ktoś inny zgłosił ceny tej stacji w ciągu ostatnich 12 godzin. Spróbuj ponownie później lub na innej stacji.           | dismiss  |
| `no_prices_extracted`      | Nie udało się odczytać cen                    | Na zdjęciu nie widać czytelnych cen. Spróbuj zrobić nowe — z bliska, równo i z dobrym oświetleniem.                    | retake   |
| `no_station_match`         | Nie znaleziono stacji w pobliżu               | Według GPS nie ma stacji w okolicy. Sprawdź czy GPS jest włączony i celuj w pylon stacji.                              | retake   |
| `price_out_of_range`       | Cena poza zakresem                            | Odczytana cena wykracza poza dopuszczalny zakres dla tego paliwa. Możliwe, że OCR pomylił cyfry. Zrób nowe zdjęcie.    | retake   |
| `no_gps_coordinates`       | Brak danych lokalizacji                       | Nie udało się ustalić lokalizacji w trakcie wysyłki. Włącz GPS i zrób nowe zdjęcie.                                    | retake   |
| `dead_letter_discarded`    | Zgłoszenie zostało odrzucone                  | Zgłoszenie nie zostało przetworzone — admin je odrzucił po wielokrotnych próbach.                                      | dismiss  |
| _generic shadow_rejected_  | W trakcie przeglądu                           | Twoje zgłoszenie czeka na ręczne sprawdzenie przez moderację. Daj nam chwilę.                                          | dismiss  |
| _generic rejected_         | Odrzucone                                     | Z tym zgłoszeniem coś było nie tak. Sprawdź następne zdjęcia — z bliska i czytelnie pomaga najbardziej.                | dismiss  |

---

## Out of Scope

- **Data-driven copy refinement.** After 30 days of production data, revisit the AC1 matrix and tighten copy for the codes that turn out to be most frequent. Tracked as a follow-up iteration, not a separate story (just a copy-only PR when the data is in).
- **Photo thumbnail in the modal.** R2 photos are admin-side only; surfacing on mobile requires a presigned-URL endpoint with TTL (similar to admin's `getPresignedUrl`). Defer until we have a clear UX need — the explanation copy should carry most of the weight.
- **Push notifications when admin resolves a shadow_rejected row.** Closes a real loop but is its own feature with its own consent + delivery considerations. Post-MVP.
- **Re-architecting `Submission.flag_reason` as a Postgres enum.** Adds migration burden and constrains future flexibility. Text column with a documented taxonomy in code is fine.
- **Admin-side staleness aggregation.** AC3 staleness is mobile-side; the admin queue could surface "oldest unreviewed shadow_rejected" but the existing `created_at ASC` ordering already does the job for the queue use-case.
- **EN/UK copy quality pass.** The story ships PL canonical with reasonable EN/UK translations. A native-review pass on UK is part of the broader market-expansion track, not 3.17.
- **`Approve older` keyboard shortcut on admin desktop.** The four-button card is fine for v1. If admin-side ergonomics matter at volume, that's a separate UX iteration.

---

## Regression Checklist (pre-push)

- [ ] `pnpm -r type-check` green
- [ ] `pnpm -r lint` green
- [ ] `pnpm -r test` green (full API suite + new admin tests + new mobile helper tests)
- [ ] Manual: open Activity screen on mobile → tap a verified row → station detail opens (existing behavior unchanged)
- [ ] Manual: tap a `shadow_rejected` row with `flag_reason: 'user_flagged_wrong'` → modal opens with title/body/retake CTA → tap retake → camera opens
- [ ] Manual: tap a `rejected` row with `flag_reason: 'duplicate_submission'` → modal opens with `Rozumiem` CTA → dismisses
- [ ] Manual: tap a `pending` row → no-op (existing)
- [ ] Manual: row that's been `shadow_rejected` for >6h → inline label suffix shows `· Od X godz.`
- [ ] Manual: row that's been `shadow_rejected` for >48h → inline label suffix shows `· Od X dni`
- [ ] Manual: row in `shadow_rejected` with `flag_reason: 'shadow_banned'` is laundered to `pending` on the wire (Story 4.3 invariant) → no modal, no staleness suffix
- [ ] Manual: admin opens conflict pair card → four buttons render (Approve newer / Approve older / Newer unusable / Both unusable)
- [ ] Manual: admin clicks `Approve older` → older verifies, newer rejects with `auto_resolved_by_older`, cache shows older's prices, dedup record seeded confirmed
- [ ] Manual: admin clicks `Both unusable` → inline confirmation appears → `Cancel` returns to four-button row → no DB change → click again → confirm → both rejected
- [ ] Manual: admin opens detail of a `user_flagged_wrong` submission → "Restored from" row visible → click → navigates to source submission
- [ ] Manual: admin opens detail of a `user_flagged_wrong` submission with no prior verified (cache fell to estimates) → "Restored from" row shows `—` with the "none (cache fell back)" copy
- [ ] Manual: switch admin locale to UK → conflict copy renders `Конфліктні` (not `Сирпечні`)
- [ ] Manual: 3.14 self-flag → still works (modal opens, retake navigates) — no regression
- [ ] Manual: 3.16 paired-review with `Approve newer` and `Newer unusable` — still works one-tap (no regression from confirmation pattern)

---

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (1M context)

### Debug Log References

### Completion Notes List

- All 12 tasks (T1–T12) complete.
- Test counts post-review: API **1180/1180** pass (was 1177; +3 net for new P-1/P-2/P-3 + P-17 coverage). Mobile **50/50** pass (no test count change).
- 17 of 17 review patches (P-1..P-17) applied. 5 deferred items (D-1..D-5) logged below. 1 spec deviation (BAD-SPEC-1, button styling) resolved by amending T5 inline above to document the chosen `bg-emerald-100` styling.
- Most consequential changes after review: UUID validation on `restored_from_submission_id` (P-1) closes a Link-href injection vector; tappable predicate now correctly excludes shadow_banned and null-flag_reason rows (P-4/P-5) tightening the Story 4.3 secrecy invariant defense; 400 BadRequest is now distinguishable in the admin UI (P-10) so a stale view shows "refresh and retry" rather than a generic toast.

### File List

**Backend (uncommitted at time of review):**
- `apps/api/src/admin/admin-submissions.service.ts` — new `approveOlder` (T1) + `loadConflictPair` extended with `expectedTarget` (T1) + `getDetail` audit-log surfacing (T3) + new `readRestoredFromAudit` private helper (T3) + `UUID_REGEX` static (P-1) + empty-validPrices guard on both `approveNewer` and `approveOlder` (P-3) + `loadConflictPair` ordering invariant comment (P-14) + new `AUDIT_ACTION_APPROVE_OLDER` / `AUDIT_ACTION_AUTO_RESOLVED_BY_OLDER` constants.
- `apps/api/src/admin/admin-submissions.controller.ts` — new `POST conflict/:conflictGroupId/approve-older` endpoint (T2) reusing `ConflictNewerDto`.
- `apps/api/src/admin/admin-submissions.service.spec.ts` — 4 `approveOlder` tests (T4) + 5 `getDetail.restored_from` tests (T4) + P-1/P-2 UUID/empty-string rejection tests + P-3 empty-prices test + P-16 explicit per-call mocks + P-17 audit-failure + cache-write-failure tolerance tests. 52 total tests in suite (was 38 pre-3.17, +14 net).

**Admin UI:**
- `apps/admin/lib/types.ts` — `FlaggedSubmissionDetail.restored_from_submission_id: string | null`.
- `apps/admin/lib/i18n.ts` — added `conflictApproveOlder` / `confirmBothUnusableTitle` / `confirmBothUnusableYes` / `restoredFromLabel` / `restoredFromNone` / `errorBadRequest` keys in PL/EN/UK; AC7 typo fix for UK locale (`Сирпечні` → `Конфліктні` × 2).
- `apps/admin/app/(protected)/submissions/ConflictPairCard.tsx` — fourth `Approve older` button (T5, soft-green styling per BAD-SPEC-1 amendment) + `Both unusable` inline confirmation (T6) + `'badRequest'` error branch (P-10) + auto-revert confirm-state on error (P-11) + `errorBadRequest` copy slot in `Props.copy`.
- `apps/admin/app/(protected)/submissions/[id]/page.tsx` — `Restored from` `<DetailRow>` (T7) + `truncateId` helper (P-15).
- `apps/admin/app/(protected)/submissions/page.tsx` — wires `errorBadRequest` into the ConflictPairCard copy bag.
- `apps/admin/app/(protected)/submissions/actions.ts` — `approveOlderInConflict` server action (T5) + `'badRequest'` branch on all four conflict actions (P-10).

**Mobile:**
- `apps/mobile/src/components/activity/flagReasonCopy.ts` — pure helper (T8). Post-review: literal-union `KnownFlagReason` type with `Record<KnownFlagReason, FlagReasonCta>` exhaustiveness enforcement (P-13) + `isKnownFlagReason` type guard.
- `apps/mobile/src/components/activity/staleness.ts` — pure helper (T9). Stale comment refresh (P-12).
- `apps/mobile/src/components/activity/FlagReasonExplainSheet.tsx` — new component (T10). Post-review: support-CTA fallback when env unset (P-7) + `Linking.openURL` rejection caught and logged (P-6).
- `apps/mobile/src/components/activity/SubmissionRow.tsx` — explainable rows tappable (T10). Post-review: `tappable` excludes `shadow_banned` AND null-flag_reason rows (P-4 + P-5) + `accessibilityRole="button"` and `accessibilityHint` on the wrapping `TouchableOpacity` (P-8).
- `apps/mobile/src/components/activity/__tests__/flagReasonCopy.test.ts` — 10 tests (T8). Pass after P-13 type tightening (no test changes needed).
- `apps/mobile/src/components/activity/__tests__/staleness.test.ts` — 9 tests (T9). Pass after P-9 plural-key restructure (helper still emits the same logical key, plural dispatch is i18next runtime concern).
- `apps/mobile/src/i18n/locales/{pl,en,uk}.ts` — full `contribution.flagReason` block (T11) + plural keys `_one`/`_few`/`_many`/`_other` for `stalenessHours` and `stalenessDays` (P-9) + `tapHintStation` / `tapHintExplain` (P-8).

### Review Patches

T12 bmad-code-review (2026-05-07) surfaced 17 fixable patches (P-1..P-17), 5 deferred items (D-1..D-5), and 1 spec deviation (BAD-SPEC-1). All patches applied in this slice.

**Critical — security / data corruption:**

- **P-1** — `readRestoredFromAudit` validates the parsed value is a canonical RFC 4122 UUID via a class-static `UUID_REGEX` before returning. Closes the open-redirect / log-injection surface where a malformed audit row could inject `'../whatever'` or a full URL into `<Link href={`/submissions/${restored_from_submission_id}`}>` on the admin detail page.
- **P-2** — UUID validation in P-1 inherently rejects empty strings, fixing the broken `/submissions/` link that an empty `restored_from_submission_id` would have produced.
- **P-3** — `approveNewer` and `approveOlder` now skip the cache write AND the consensus seed when `validNewerPrices` / `validOlderPrices` is empty (every entry was null/non-finite). Without this guard, `priceService.setVerifiedPrice` would have been called with `prices: {}`, wiping any existing verified prices for the station. Mirrors Story 3.16 P-3.
- **P-4** — `tappable` predicate excludes `shadow_banned` rows. Story 4.3 secrecy invariant: even though backend laundering currently masks shadow_banned, a future regression could leak the raw value, and the tap-to-explain modal would have surfaced it. Defensive guard is now correct on the row level.
- **P-5** — `tappable` predicate also excludes rows with `flag_reason === null`. Spec T10 explicitly required null-flag_reason to be a no-op; pre-review the row was tappable and showed generic copy.

**Medium — UX / reliability / a11y:**

- **P-6** — `Linking.openURL` for the support `mailto:` now `.catch()`-wraps and logs. On a device without a mail client the rejection used to spam unhandled-promise warnings; the user got dismissed with no signal. Logged-and-dismissed is still imperfect (deferred polish: a fallback toast or copy-to-clipboard), but the noise is cleaned up.
- **P-7** — Support CTA collapses to `dismiss` at runtime when `EXPO_PUBLIC_SUPPORT_EMAIL` is unset. Previously the button labelled itself "Skontaktuj się z pomocą" but the action silently dismissed. Now the label and behaviour match.
- **P-8** — Tappable shadow_rejected/rejected rows have `accessibilityRole="button"` + `accessibilityHint` (`tapHintStation` / `tapHintExplain` i18n keys per branch). Screen readers announce the rows as buttons rather than static text.
- **P-9** — `stalenessHours` / `stalenessDays` i18n keys split into proper CLDR plural forms (`_one`/`_few`/`_many` for PL/UK; `_one`/`_other` for EN). Reachable range starts at 6h (hours) and 2d (days), so `_one` is theoretically unreachable today, but the keys are in place for any future threshold change.
- **P-10** — All four conflict server actions (`approveNewerInConflict` / `approveOlderInConflict` / `markNewerUnusableInConflict` / `markBothUnusableInConflict`) now branch on `e.status === 400` and return `{ error: 'badRequest' }`. `ConflictPairCard` surfaces the new `errorBadRequest` copy ("Widok jest nieaktualny — odśwież stronę i spróbuj ponownie") so an admin acting on a stale view gets the right hint.
- **P-11** — Inline `Both unusable` confirmation auto-reverts to the four-button row when an action errors. The error message renders below; admin gets a clear re-evaluation moment instead of being stranded in confirm-state with a stale destructive prompt.

**Low — polish / cleanup:**

- **P-12** — `staleness.ts` comment no longer references "3.14 P-17 ageMs >= 0 guard" (which doesn't apply to a `< SIX_HOURS_MS` check).
- **P-13** — `flagReasonCopy.ts` defines `KnownFlagReason` as a literal union sourced from the `KNOWN_FLAG_REASONS` const array. `CTA_BY_CODE` is typed as `Record<KnownFlagReason, FlagReasonCta>` so a contributor adding a new code without picking its CTA is a compile error. Runtime narrowing via `isKnownFlagReason` type guard.
- **P-14** — `loadConflictPair` newer/older indexing dependency on `orderBy: { created_at: 'desc' }` documented inline. A future refactor that flips the sort would silently approve the wrong half across all four paired-review handlers; the comment makes the dependency loud.
- **P-15** — `truncateId` helper renders an ellipsis only when the input is actually longer than 8 chars. Defensive against a future call site where the source string isn't a guaranteed UUID.
- **P-16** — `approveOlder` "happy path" test uses explicit `mockResolvedValueOnce` for both `updateMany` calls + `expect(mockSubmissionUpdateMany).toHaveBeenCalledTimes(2)`. A regression that drops one of the two flips would now fail loud.
- **P-17** — Three new `approveOlder` failure-tolerance tests: audit-log write failure (resolves), `setVerifiedPrice` failure (still seeds consensus), empty `validOlderPrices` (skips both cache write and consensus seed per P-3). Closes the AC8 coverage gap.

**Bad-spec resolution:**

- **BAD-SPEC-1** — Spec T5 originally specified "border, white background, gray-700 text" for the `Approve older` button. Implementation chose `bg-emerald-100 text-emerald-900` (soft-green secondary) which reads more cleanly alongside the primary green `Approve newer`. Spec T5 amended inline above to document the chosen styling.

### Review Deferred Items

- **D-1 — `setVerifiedPrice` failure compensation.** Cache can drift from DB after a successful verify if the cache write fails. Best-effort pattern carried over from 3.14/3.16; a reconciliation worker is the proper fix. Defer.
- **D-2 — `recordStationConsensus` failure surfacing in metrics.** Currently `.catch()`-logged with no observability. Will fold into the broader metrics dashboard work in Phase 2.
- **D-3 — Concurrent `approveNewer` vs `approveOlder` cache-write race.** Mitigated in practice by status guards (only one transaction commits successfully); the cache-write race is theoretical and would manifest as a slightly out-of-order final cache state. Acceptable for v1.
- **D-4 — `__DEV__` warning when `flagReasonCopy` falls back for an unknown backend code.** Useful for the planned 3.17b iteration once we have 30 days of production data on `flag_reason` frequencies.
- **D-5 — Mobile `Translations` interface (admin has one; mobile is loose-typed).** Would catch i18n key typos at compile time. Cross-cutting refactor — not scoped to 3.17.
