# Epic 15: Marketing & Soft Launch — Łódź Pilot

**Date:** 2026-04-18
**Status:** ready-for-dev (Story 15.1)
**Owner:** Mateusz (founder)
**Plan:** [litro-soft-launch-plan.md](./litro-soft-launch-plan.md)

---

## Goal

Run a bounded, single-city paid acquisition pilot in Łódź to validate (a) whether paid Meta Ads can produce active price reporters at a sustainable cost-per-install, and (b) whether the data flywheel — community submissions sustaining priority-station price freshness — can hold without founder intervention.

A successful pilot produces the data needed to confidently expand to a second city. A failed pilot tells us whether the issue is creative, channel, value-prop, or onboarding — before we burn significant budget.

---

## Why this epic exists

Marketing is a separate work stream from app store launch prep (Epic 12). Where Epic 12 is a one-shot set of prep tasks (domains, builds, listings, store accounts), Epic 15 is **operational, ongoing, and budget-driven**: creative production cycles, ad-campaign management, weekly metric reviews, decision gates that gate further spend.

Without a tracked epic for this stream:
- Creative work has no clear owner or definition-of-done
- Ad spend has no formal decision gates — easy to drift into wasted budget
- Paid-channel learnings don't feed back into product decisions in a structured way

---

## Scope

**In scope** (this epic):
- Static creative production for Meta (image ads, copy variants)
- Meta campaign setup, launch, and operational management
- Decision gates at half-budget and end-of-test
- Founder photo-seeding discipline (cap at 6 weeks)
- Channel-mix expansion decisions (Google Search add-on, Waze) when warranted

**Out of scope** (this epic):
- App store listing copy / screenshots / metadata — these belong to **Story 12.5**
- Custom marketing landing pages — deferred until iOS launch (handled separately)
- PR, press, influencer marketing — explicitly excluded by founder preference for the soft launch
- TikTok / Reddit / Snap / DOOH paid channels — not on roadmap for this pilot

---

## Stories

### Story 15.1: Meta Ad Creative Production *(ready-for-dev)*

**File:** [15-1-meta-ad-creative-production.md](../implementation-artifacts/15-1-meta-ad-creative-production.md)

Produce the static image creatives, Polish copy bank, and search-style ad copy needed to launch the Meta campaign. Three design concepts × three crops × two copy variants. No video, no UGC, no founder appearance. Hand-off-ready creative pack.

---

### Story 15.2: Meta Campaign Setup & Launch *(planned, not yet drafted)*

Set up the Meta Ads Manager campaign, ad sets, and ad variants using the Story 15.1 creative pack. Configure Łódź geo-targeting (15 km radius), Android-only OS targeting, App Install objective, daily budget cap, and conversion event wiring. Launch with the agreed daily cap. Pre-spend smoke test: confirm tracking pixel fires from the click → Play Store visit chain.

**Pre-requisites:** Story 15.1 complete; Google Play Install Referrer wired into analytics; founder `seed=true` flag in place.

---

### Story 15.3: Decision Gate Reviews — G1, G2, G3 *(planned)*

Three gated reviews during/after the pilot:
- **G1 — Half-budget review (~day 14):** kill underperforming creative, scale up winners
- **G2 — End-of-test review (~day 30):** decide scale-up / channel switch / rework
- **G3 — Founder seeding review (week 6):** confirm seeding share ≤ 25% and taper

Each review produces a written one-pager appended to this epic with the decision and supporting data.

---

### Story 15.4: Founder Photo Seeding Discipline *(planned)*

Operational support: backend `seed=true` flag on founder submissions, daily/weekly reporting of seeding share vs total submissions, exclusion of seed submissions from user-facing "fresh community price" indicators, hard stop at week 6 unless explicitly extended at G3.

**Pre-requisites:** confirm with API stack where the seed flag lives, and that map / station-detail freshness logic excludes seed submissions correctly.

---

### Story 15.5: Google Search Campaign Add-on *(planned, contingent on G2)*

Triggered only if G2 decision is to scale. Łódź radius targeting on Polish fuel-search queries. Small daily budget supplementing Meta. Reuses headline copy bank from Story 15.1.

---

### Story 15.6: Waze Self-Serve Pin + Takeover *(planned, contingent on G2)*

Triggered if Meta plateaus or as a complementary channel after G2. Tests the "driver-en-route" moment that no other channel hits. Requires Pin (200×200) and Takeover (1080×1080) creative — extension of Story 15.1's pack.

---

## Acceptance criteria for the epic

The epic is complete (for the soft-launch pilot phase) when:

- [ ] Story 15.1 ships a creative pack ready for Meta upload
- [ ] Story 15.2 launches a campaign with all tracking working
- [ ] At least 1,000 PLN of Meta spend is concluded with G1 + G2 reviews documented
- [ ] G3 review confirms founder seeding share ≤ 25% (or, if not, that a structural decision was made — pause/diagnose)
- [ ] A go/no-go decision on second-city expansion is recorded with supporting data

After this gate the epic stays "in-progress" if expansion proceeds (15.5 / 15.6 stories activate); otherwise it transitions to "complete — pending re-open" pending product/UX fixes from a failed pilot.

---

## Constraints & non-goals

- **No personal-brand exposure.** No founder face, voice, or story in any creative or PR. All ads are app-screen-only.
- **No video commitments at MVP.** Static images only; an optional simple GIF / screen recording is permissible if static creative validates.
- **Cost-conscious by design.** Initial budget is 1,000 PLN. Scale-up only after evidence-based decision gate G2.
- **Łódź-only geo-targeting.** No accidental national spend.
- **Android-only OS targeting** until iOS launches.

---

## Dependencies on other epics

| Dependency | Why |
|---|---|
| **Epic 11 — Legal & Compliance** | Privacy policy + terms must be live at stable URL before any user-facing ad runs |
| **Epic 12 — App Store & Launch Prep** | Google Play live (12.4 + 12.7) is a hard prerequisite for App Install ads |
| **Story 0.1 — Pre-Launch Hardening** | Submission funnel must be technically stable before paid spend creates user load |
| **Story 4.7 — API Cost Tracking Dashboard** | Required to monitor OCR cost spike during user-acquisition ramp |

---

## Open questions for the epic

These are tracked at the epic level so each story doesn't have to re-resolve them:

1. **Analytics tooling decision** — Mixpanel / PostHog / GA4 / custom? Influences how install → active → submitter funnel is reported.
2. **Click destination** — direct Play Store deep-link, or an internal `/pobierz` redirect under our domain? The latter gives tracking control.
3. **Brand voice in PL copy** — *appka* (colloquial) vs *aplikacja* (neutral). Decide once, apply across all stories.
4. **Founder seed flag schema** — confirm column name, default value, and exclusion logic in freshness queries before Story 15.4 starts.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-18 | Epic created | Soft launch in Łódź planned; Marketing not covered by existing Epics 11–14 |
