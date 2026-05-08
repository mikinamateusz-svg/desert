# Story 3.19 — Deferred Follow-ups

These items surfaced during the bmad-code-review of story 3.19 (admin station rename) on **2026-05-08**. Each is either a pre-existing pattern not caused by 3.19, or an enhancement explicitly out of scope for this story.

---

## Pre-existing patterns surfaced (no 3.19-specific action)

These exist across the admin app; address as a sweep, not story-by-story.

- **D1. Race between validation read and update on rename.** Two concurrent admins renaming the same station could both pass validation. Single-row `update` is "last writer wins"; AdminAuditLog captures both. Same pattern as `overridePrice`, `hideStation`, etc. Acceptable for low-concurrency admin work.
- **D2. `getStationDetail` follow-up read after the rename transaction is outside the `$transaction([...])` batch.** If the read fails after a successful update, the rename is committed but the caller surfaces an error. Same pattern as the other admin write+read flows. Caller can retry — re-read is idempotent.
- **D6. `StationDetail.name_manually_set_at` is `Date | null` server-side, `string | null` client-side.** Relies on NestJS's default JSON serializer converting Date to ISO string. Pre-existing pattern across all admin endpoints (`created_at`, `last_synced_at`, etc.) — consistent typing, no adapter needed.
- **D8. Audit log telemetry / metrics.** No Prometheus counter on `STATION_RENAME` (or any other admin action). Consistent gap across the admin surface; not unique to rename.
- **D10. Server-action CSRF / re-auth.** Next.js handles origin checks; admin auth is session-based at the layout level. Server actions inherit the protected layout's session check. Pre-existing posture.
- **D17. Component unmount mid-transition** (set-state-on-unmounted React warning). Pre-existing pattern in admin forms; React 18+ tolerates it. Not a regression.
- **D19. Log injection from name with control chars.** `logger.log("renamed: \"${name}\"...")` doesn't sanitize. Trust admin input boundary; not unique to rename.

## Concurrency / race edges (low priority)

- **D15. Optimistic-lock concurrency control on Station.update.** Last writer wins. AdminAuditLog records both renames in order, so we can reconstruct intent post-hoc. Adding `WHERE updated_at = ?` would be defensive but is not a known operational issue.

## Type / encoding edges

- **D12. `String.prototype.trim()` only handles ASCII whitespace** in older runtimes; modern V8 trims most Unicode whitespace including NBSP. Not currently a problem; revisit if a Polish keyboard layout starts producing NBSPs in admin input.
- **D13. UTF-16 `length` vs codepoint count for the 200-char cap.** A name with 100 emoji (200 UTF-16 code units = 100 codepoints) hits the cap differently than a 200-char ASCII string. Admin renaming a Polish fuel station won't realistically hit this; defer until someone actually puts an emoji in a station name.

## Audit / data model

- **B16. Audit `notes` is a JSON string instead of a structured column.** Cross-cutting concern; same convention as PRICE_OVERRIDE / CACHE_REFRESH / STATION_HIDE / STATION_UNHIDE. A typed `notes_json` column would let us index into it for "all renames of station X" queries; not a 3.19 problem.
- **D14. `existing.name === trimmed` is byte-strict.** "Orlen" → "ORLEN" is allowed (different bytes); "Orlen" → "Orlen  " (extra trailing space, after trim collapses to "Orlen") is rejected as identical. Both behaviours are intentional: case changes are legitimate edits; whitespace-only changes aren't.

## Out-of-scope enhancements

- **D3. Name uniqueness within a chain.** Two stations could be renamed to the same string — no DB constraint, no warning. Per spec out-of-scope; admin discretion. Could add a soft warning ("Another station already has this name") later if disambiguation accuracy matters.
- **B17. Telemetry on rename frequency.** As above, cross-cutting.
- **D9. `revalidatePath` may not cover all surfaces showing station names.** Only `/stations` (search/list) and `/stations/[id]` are revalidated. Audit-log views, price-override pages, etc. could surface a stale name until next request. Acceptable since stale display is read-only and self-corrects on next refresh.

## Migration

- **D4. `ALTER TABLE Station ADD COLUMN` takes ACCESS EXCLUSIVE lock.** Brief for a nullable column without default — under a second on the current Station row count. No mitigation needed at this scale; revisit if the table grows past 100k rows.
- **D5. No backfill / data-recovery story.** By design — pre-3.19 there was no manual-rename concept, so no historical state to recover. Renames going forward are auditable via AdminAuditLog `STATION_RENAME` rows.

## A11y polish (covered by patches; remaining)

- **D11. Manual-override badge tooltip uses `title=` attribute** (touch-invisible, hover-only). Patched by adding `aria-label`; visual tooltip still relies on `title`. A proper popover-on-tap component would be better but adds dependencies. Defer.

---

## Triage record

This list captures the `defer` bucket from the 3-19 bmad-code-review. The `patch` bucket (P1–P7: DTO `@MaxLength` + whitespace-only validator, double-click guard, localised error fallback, draft sync to prop, ARIA wiring, keyboard handlers, audit-failure rollback test) was applied in the same commit. The `bad_spec` bucket prompted spec amendments to AC6 and T2. The `reject` bucket was discarded as noise (false positives, by-design behaviours, cross-cutting pre-existing patterns).
