# Story 3.18 — Deferred Follow-ups

These items surfaced during the bmad-code-review of story 3.18 (admin all-submissions firehose) on **2026-05-08**. Each is either a pre-existing pattern not caused by 3.18, or an enhancement explicitly out of scope for this story. Tracked here so they don't get forgotten when the firehose grows or when a related story revisits the area.

---

## Pre-existing patterns surfaced (no 3.18-specific action)

These are present in the queue page as well; the firehose just inherits them. Address as a sweep when the underlying surface is being modernised — not story-by-story.

- **D1. `row.user_id.slice(0, 8)` could throw on null.** Type guarantees non-null; same pattern as queue page's `SingleRow`. Defense-in-depth optional.
- **D3. `price_data` cast from `Prisma.JsonValue` without runtime validation.** Same cast in `listFlagged`. A zod-validator at the API boundary would catch malformed historic JSONB, but it's a cross-cutting concern (consider during the next OCR-pipeline pass).
- **D4. `page` exceeding `totalPages` renders empty without redirect.** Same in queue page. Consider a tiny "redirect to page 1 if requested page is past total" helper if it becomes a real complaint.
- **D5. `adminFetch` error swallowing into a single generic message.** Pre-existing — doesn't distinguish 401 / 500 / network. A typed error surface would help operator debugging.
- **D6. `new Date(row.created_at).toLocaleString(locale)` renders 'Invalid Date' on malformed input.** Same pattern as queue page; trust the API contract for now.
- **D7. Detail page only redirects to login on 404; 401/403 falls into generic error.** Pre-existing; relevant to overall admin auth UX, not 3.18.

## Concurrency / UX edges

- **D2. `pushUpdate` no debouncing on rapid filter clicks.** The router push isn't debounced; older state could overwrite newer if a user spams the toggle. Low risk on admin (single operator); revisit if the page gets shared/team usage.
- **D10. Status race between firehose row card and detail page click.** The card shows a status badge captured at server-render; if admin acts on the row in another tab in the interim, the detail page silently strips action buttons. Inherent to admin queues — not unique to firehose. Mitigation would be an "out of date" toast on the detail page when status differs from the linker hint, but that's a broader UX investment.

## Performance / scale

- **D8. Distant past/future dates trigger full table scans.** No min/max bounds enforced on `from`/`to`. Bounded by the index recommendation below; not a launch-week concern at <10k rows.
- **D9. No composite `(status, created_at DESC)` index on `Submission`.** Currently relying on whatever single-column index exists on `created_at`. Add a Postgres index when:
  (a) firehose row count > ~50k AND p95 list latency exceeds 500 ms, OR
  (b) any user complains about pagination feel.
  Revisit alongside the Phase 2 OCR-pipeline performance pass.

## Test gaps

- **D12. No dedicated auth test for `listAll` controller route.** `@Roles(UserRole.ADMIN)` is class-level; no sibling endpoint has its own auth test either. Consistent gap. If we ever do add a single-route role exception or relax for partner access, this test pattern needs to be filled in.

## Out-of-scope enhancements

- **D11. No `flag_reason` filter on the firehose.** Spec explicitly excluded per-fuel/flag filters as out-of-scope. Easy to add later if operators ask for it.

## Localisation review

- **D13. Ukrainian "Черга рецензії" idiom.** Unusual word choice for "Review queue"; "Черга модерації" might read more naturally in admin context. Needs native-speaker review when the UK locale gets a proper localisation pass (post-MVP).

---

## Triage record

This list captures the `defer` bucket from the 3-18 bmad-code-review. The `patch` bucket was applied as fixes in the same commit (P1–P8). The `bad_spec` bucket prompted amendments to the spec doc itself. The `reject` bucket was discarded as noise (false positives or by-design behaviour).
