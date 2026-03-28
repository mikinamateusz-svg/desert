# Story web-4 — Ad Slot Infrastructure

**Status:** review
**Epic:** web — Web App — Public Site & Content
**Story ID:** web-4
**Created:** 2026-03-28

---

## User Story

As a **developer**,
I want ad slot placeholder components in place throughout the site,
So that integrating a real ad network requires only swapping the placeholder content — no layout changes.

**Why:** Ad revenue is a planned monetisation channel. Reserving space now avoids costly layout refactors later and lets us test page layouts with realistic spatial constraints.

---

## Acceptance Criteria

- **AC1 — AdSlot component:** A reusable `AdSlot` component accepts `slotId`, `className`, and optional `label` props; renders a dashed-border placeholder div with `data-slot-id` attribute

- **AC2 — Slot inventory placed:** Ad slots are placed in: station detail desktop sidebar, station detail mobile inline, and map sidebar bottom

- **AC3 — No ads on map mobile:** The main map view has no ad slot on mobile (full-screen map must not be obscured)

- **AC4 — Easy swap-in:** The `AdSlot` component has a comment indicating where to replace placeholder content with real ad network code (e.g. GPT tag)

---

## Slot Inventory

| Slot ID | Location | Size | Breakpoint |
|---|---|---|---|
| `station-detail-sidebar` | Station detail right column | 250px h | Desktop only (hidden on mobile) |
| `station-detail-inline` | Station detail below CTAs | 100px h | Mobile only (hidden on desktop) |
| `sidebar-map-bottom` | Map sidebar bottom | 120px h | Desktop only (lg+, inside sidebar) |

---

## File List

- `apps/web/components/AdSlot.tsx` — placeholder component with `data-slot-id`, `aria-hidden="true"`, dashed border

---

## Dev Agent Record

### Completion Notes

- `aria-hidden="true"` on all ad slots — placeholder divs carry no meaningful content for screen readers
- `label` prop defaults to `'Reklama'` (Polish for "Advertisement") — the placeholder label visible during development
- Component is intentionally minimal: no state, no effects, pure presentation — designed to be replaced in one edit when a real ad script is integrated

### Change Log

- 2026-03-28: Story created and implemented
