# Story 3.18: Admin All-Submissions Firehose Page

Status: ready-for-dev

**Trigger:** 2026-05-07 — post-soft-launch observation. Today admin `/submissions` shows only the *queue* (flagged / pending / shadow_rejected / rejected / paired-conflict) — i.e., things needing human action. Auto-verified submissions never appear there because they don't need action. Operator wants a separate **firehose** view that surfaces *every* submission regardless of status, so the admin can see what's flowing through the pipeline (including the silent-success path), inspect any submission, view the photo while still retained, and edit prices on any record. Reuses the existing detail page (`/submissions/[id]`) for click-through — that page already handles all statuses, has the photo viewer, and exposes the price editor.

**Phase:** 1 (post-launch operability). Coupled stories: extends 3.16's admin queue surface; not blocking any other Phase 1 work.

---

## Story

As an **admin**,
I want a separate page listing every submission the pipeline processed (not just ones flagged for review), with the same row → detail click-through pattern as the review queue,
so that I can audit pipeline output end-to-end, spot-check auto-verified submissions, and edit prices on any record without first triaging through the queue filters.

### Why

The queue page is intentionally narrow: `listFlagged` filters to statuses that need action and adds paired-conflict grouping logic, both of which assume the row needs work. Auto-verified submissions are deliberately excluded — the queue would be unusable diluted with success cases.

But operationally, "I want to see everything that just went through" has come up repeatedly during the soft-launch:
- Spot-checking the verified path (did the OCR get it right? was the right station matched?).
- Auditing pipeline throughput visually (firehose feel, not aggregate metrics).
- Editing prices on a verified row when the operator notices a mismatch in the wild — currently requires a station→submission lookup.

A separate page keeps the queue clean (existing UX preserved) while giving operators a generic "all submissions" surface. The detail page handles every status today, so click-through reuse is free.

---

## Acceptance Criteria

**AC1 — New admin route `/submissions/all` listing every submission:**
Given an authenticated admin,
When they navigate to `/submissions/all`,
Then the page renders a paginated list of submissions across **all** statuses (`pending`, `verified`, `shadow_rejected`, `rejected`),
And the default sort is `created_at DESC` (most recent first),
And the default page size is 20 (matches queue),
And the list is **not** filtered by `flag_reason` by default (queue defaults dropped).

**AC2 — Each row displays the same shape as the queue list, with status visible:**
Given a row in the all-submissions list,
When it renders,
Then it shows: `created_at` timestamp, station name (or "— unmatched —" when null), submitter user id (or display name if available), per-fuel price summary (same `formatPrice` pattern as queue), status badge, and `flag_reason` when non-null,
And the row is a `<Link>` to `/submissions/[id]` (existing detail page — no changes there).

**AC3 — Status filter (multi-select; defaults to all):**
Given the all-submissions page,
When the admin opens the status filter,
Then they can multi-select any combination of `pending`, `verified`, `shadow_rejected`, `rejected`,
And the default selection is **all four** (the page is "all" by default),
And clearing the filter back to all-selected returns to the unfiltered view.

**AC4 — Date range filter:**
Given the all-submissions page,
When the admin sets a `from` and/or `to` date,
Then the list filters to submissions whose `created_at` falls within `[from, to]` inclusive,
And the filter persists in the URL (`?from=YYYY-MM-DD&to=YYYY-MM-DD`) so the view is shareable/bookmarkable.

**AC5 — Pagination matches queue pattern:**
Given more than 20 submissions match the active filters,
When the page renders,
Then pagination controls (prev / next / page X of Y) appear at the bottom,
And the URL preserves the active page (`?page=N`),
And page changes preserve all other filters in the URL.

**AC6 — Click-through to existing detail page works for every status:**
Given any row in the all-submissions list,
When the admin clicks it,
Then `/submissions/[id]` opens with the existing detail UI (photo viewer, price editor, audit log, status history),
And action buttons (approve / reject / requeue) render only when `status === 'shadow_rejected'`,
And the page is read-only for `verified`, `pending`, and `rejected` rows.

(*Note: original spec assumed no detail-page changes were needed; in fact, `getDetail` previously rejected non-shadow_rejected rows. The minimal coupling required to satisfy this AC is documented under "Notes for the implementer".*)

**AC7 — Nav surface: rename the queue page label, add the firehose label:**
Given the admin sidebar/nav,
When it renders,
Then the existing `/submissions` link is labelled **"Review queue"** (PL: *Kolejka recenzji* / UK: *Черга рецензії*) instead of generic "Submissions",
And a new sibling link **"All submissions"** (PL: *Wszystkie zgłoszenia* / UK: *Усі заявки*) points to `/submissions/all`,
And the URL `/submissions` itself is **unchanged** (no redirect, no route move) — only the label changes, to avoid breaking bookmarks/external links.

**AC8 — Backend endpoint scoped to admin role:**
Given a non-admin user (DRIVER) calls `GET /v1/admin/submissions/all`,
Then the request is rejected with 403 Forbidden,
And admin requests succeed.

**AC9 — Performance: server-side pagination + bounded query:**
Given the page is loaded with no filter (worst case: full table),
When the query executes,
Then it uses `LIMIT 20 OFFSET (page-1)*20` and returns within p95 ≤ 500 ms on production scale (post-launch; expected <10k rows for the launch window),
And the query reads only the fields the list view renders (no `select *`),
And the `total` count uses `COUNT(*)` filtered by the same predicates (acceptable at current scale; revisit if rows exceed ~100k).

---

## Tasks

### Backend (T1–T3, plus T1b added during dev)

**T1b — Relax `getDetail` for all statuses (added during dev, post-spec):**
Remove the `ConflictException` thrown when `submission.status !== shadow_rejected`. Surface the actual `status` field on the returned `FlaggedSubmissionDetail`. Return the actual DB `flag_reason` (preserve null for verified rows) instead of `?? 'logo_mismatch'` fallback. Widen `FlaggedSubmissionRow.flag_reason` to `string | null` (queue-layer fallback in `listFlagged` is preserved so queue runtime contract is unchanged). Tests: replace the existing "throws ConflictException for non-shadow_rejected" case with three new cases asserting verified / pending / rejected detail returns the row and `status` matches.

**T1 — `AdminSubmissionsService.listAll(page, limit, filters)`:**
Add a new service method alongside `listFlagged`. Returns `{ items, total, page, limit }` with the same row shape as queue's flat (`single`) variant — no pair grouping (firehose treats every submission as a standalone row).

Filters: `{ statuses?: SubmissionStatus[], from?: Date, to?: Date }`.
Query: single Prisma `findMany` + `count`, both with the same `where` clause built from filters. Use `orderBy: { created_at: 'desc' }`. Always include `station`, `submitter` (id only — display name optional follow-up), and `price_data` snapshot.

**T2 — `GET /v1/admin/submissions/all` controller endpoint:**
New route on the same controller (`v1/admin/submissions`). Parses query params: `page` (default 1), `limit` (default 20, max 100), `statuses` (comma-separated), `from`, `to`. Validates and forwards to `listAll`. `@Roles(UserRole.ADMIN)`.

**T3 — Backend tests:**
Add `admin-submissions.service.spec.ts` cases for `listAll`:
- Returns all statuses by default (no `statuses` filter).
- Filters correctly when `statuses: ['verified']` is passed.
- Date range filter applies on `created_at`.
- `total` matches the count of rows that would be returned without pagination.
- Sort order is `created_at DESC`.
- Pagination math: page 2 with limit 20 skips 20 rows.

Controller spec: 403 for non-admin caller; 200 with payload for admin.

### Admin UI (T4–T7, plus T4b added during dev)

**T4b — Gate `<ReviewActions>` in the existing detail page (added during dev, post-spec):**
Wrap the existing `<ReviewActions>` render in `{submission.status === 'shadow_rejected' && (...)}`. Drop the now-dead `409 → notFound()` branch in the catch (T1b removed the ConflictException source). Update the `flag_reason` rendering to handle `null` (after T1b's type widening). No new logic, no new affordances — just the minimum required for AC6 click-through to render correctly for non-shadow rows.


**T4 — New page `apps/admin/app/(protected)/submissions/all/page.tsx`:**
Server Component; shape mirrors `submissions/page.tsx`. Reads filters from `searchParams`, calls `adminFetch<AllSubmissionsResult>('/v1/admin/submissions/all?...')`, renders the same row layout as queue's flat case. No `ConflictPairCard` (firehose has no pair grouping). Each row is a `<Link>` to `/submissions/[id]`.

**T5 — Filter component `AllSubmissionsFilter.tsx`:**
Status multi-select (checkbox group: pending / verified / shadow_rejected / rejected; all checked by default), date-range inputs (`from`, `to` — type=date). On change, updates URL via `useRouter().push()` preserving other params. Visually consistent with `SubmissionsFilter.tsx`.

**T6 — Nav update:**
In the layout that renders the admin sidebar (likely `apps/admin/app/(protected)/layout.tsx` or a `Sidebar` component), rename the existing `Submissions` link to `Review queue` (i18n key change) and add a new sibling `All submissions` link to `/submissions/all`. Keep them adjacent under the same section.

**T7 — i18n keys (PL/EN/UK):**
Add to `apps/admin/lib/i18n.ts` PL/EN/UK blocks:
- `nav.submissionsReview` — "Review queue" / "Kolejka recenzji" / "Черга рецензії"
- `nav.submissionsAll` — "All submissions" / "Wszystkie zgłoszenia" / "Усі заявки"
- `sections.allSubmissions.title` — "All submissions" (etc.)
- `sections.allSubmissions.description` — short subtitle (e.g., "Every submission processed by the pipeline, including auto-verified.")
- `allSubmissions.statusFilterLabel`, `allSubmissions.dateFromLabel`, `allSubmissions.dateToLabel`
- Status badge labels reuse existing `t.review.status.*` if already present; add only what's missing.

Verify keys exist in the `Translations` type (per project convention — silent runtime failure if added to data but not type).

### Code Review (T8)

**T8 — Run `bmad-code-review` after dev complete:**
Per memory `feedback_code_review.md`. Focus areas to flag in the review prompt:
- Did `listAll` accidentally reuse pair-grouping logic from `listFlagged`? (it shouldn't — firehose has no pairs).
- Is the `where` predicate built correctly when `statuses` is empty or all four (should be no `status` filter, not `IN ()` which Postgres rejects)?
- Are the i18n keys present in `Translations` type (silent-failure risk)?
- Does the URL filter round-trip (set filter → reload page → filter persists)?
- Does click-through to `/submissions/[id]` work for `verified` rows specifically (they were never reached from the queue before)?

---

## Out of Scope

These are intentional non-goals for this story; track separately if needed.

- **Bulk actions** (e.g., "approve all selected"). Single-row review via the existing detail page is enough; bulk introduces audit-log complications and isn't a soft-launch need.
- **CSV/JSON export**. If operators want offline analysis, that's a follow-up — current Phase 2 analytics infra can serve from the DB directly.
- **Saved filter presets** ("my view: last 7 days, verified only"). YAGNI for a launch-week tool.
- **Free-text search by station name / user**. Adds full-text-index complexity; revisit if list browsing becomes hard at scale.
- **Real-time updates** (WebSocket / polling). Page reload is fine.
- **Partner/fleet-portal access**. Admin-only.
- **Per-fuel filter** (e.g., "show only LPG submissions"). Easy to add later if needed.
- **Data-driven decision to demote a status**. The detail page's existing edit/approve/reject affordances cover the action surface — no new mutation endpoints introduced here.

---

## Notes for the implementer

- **Detail page** (`apps/admin/app/(protected)/submissions/[id]/page.tsx`) — *minor read-path changes are required and were unanticipated by the original spec*. The original spec assumed the page already handled every status; in fact `getDetail` threw `ConflictException` for non-`shadow_rejected` rows, which the page mapped to `notFound()`. Three minimal changes were applied during dev to make AC6 actually work:
  1. `getDetail` no longer throws on non-`shadow_rejected`; it returns the row and surfaces `status` in the response shape.
  2. The detail page no longer maps 409 → `notFound()` (dead branch after the API change).
  3. `<ReviewActions>` (approve/reject/requeue) is gated by `submission.status === 'shadow_rejected'` — the only status those endpoints support.
  No new actions, no new mutation surface, no logic for non-shadow rows beyond reading what already existed.
- **Queue page and `listFlagged` service** stay behaviourally untouched. *However*, the shared `FlaggedSubmissionRow.flag_reason` interface had to widen from `string` to `string | null` so the firehose can reuse `FlaggedSubmissionDetail` (verified rows have `null` flag_reason in DB). Runtime contract is preserved by keeping `listFlagged`'s `?? 'logo_mismatch'` and `?? 'price_conflict'` fallbacks at the service layer — queue-context callers still see non-null strings. The two queue UI render sites that read `flag_reason` got a defensive null-guard, but the values they receive are unchanged. This is type-system drift, not behavioural drift.
- Don't introduce a shared "ListSubmissions" component yet. Two pages with the same row shape is fine; premature abstraction would couple queue evolution to firehose evolution.
- `listAll` returns a flat array with no `kind` discriminator (no pair grouping). The list page consumes it directly as `items: SubmissionRow[]`.
- The status badge component used in the queue list (or its inline equivalent in `submissions/page.tsx`) is reusable for the firehose. Either lift it into a small shared component under `apps/admin/components/` or duplicate inline — duplication is fine if lifting requires more than a `mv`.
