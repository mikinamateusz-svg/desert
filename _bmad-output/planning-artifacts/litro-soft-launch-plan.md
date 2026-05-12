# Litro Soft Launch Plan — Łódź Pilot

**Date:** 2026-04-18
**Owner:** Mateusz (founder)
**Status:** draft, pre-execution
**Related artifacts:** [epic-15-marketing-soft-launch.md](./epic-15-marketing-soft-launch.md), [Story 15.1 — Meta Ad Creative Production](../implementation-artifacts/15-1-meta-ad-creative-production.md)

---

## 1. Goals

The soft launch in Łódź is a **bounded, measurable experiment** with two distinct jobs:

1. **Cold-start mitigation** — get enough drivers using the app daily that the data flywheel starts producing fresh prices for top-traffic stations.
2. **Channel & unit-economics validation** — learn whether paid acquisition can produce active reporters at a CPI compatible with long-term economics, before committing larger budget or expanding to Warsaw / Poznań / Kraków.

**Out of scope** (deliberately) for this soft launch:
- Influencer marketing
- Founder-personal-story PR / media interviews
- Video / TikTok-style UGC creative
- Multi-channel launch (only Meta at start)
- iOS audience (deferred until Apple Developer enrollment + TestFlight)
- Public launch announcement / press

---

## 2. Why Łódź first

Reasons captured for the record:

- **Population & density** — ~660k residents, dense enough that a small initial user base can produce meaningful coverage of priority stations.
- **Founder presence** — local familiarity with stations and routes; ability to seed photos personally during the cold-start window.
- **Smaller competitive surface** — fewer entrenched habits than Warsaw; easier to capture mind-share with modest spend.
- **Geographically containable** — Meta and Google geo-targeting works cleanly down to a city-radius level (smallest ~1 km), so spend stays focused.
- **Validation before scale** — running a single-city pilot lets us validate creatives, CPI, and submission-rate funnel before deciding to expand.

---

## 3. Channel Strategy

### Channel choice: Meta only at launch

**Decision:** Run Meta Ads exclusively for the initial 1,000 PLN exploration window. Add channels only after Meta produces interpretable signal.

**Rationale:**
- Best PL geo-targeting granularity (city + radius)
- Cheapest CPM in PL among self-serve channels
- Works well with **static creative** — no founder face, no video, no UGC required
- Below 600 PLN/month per channel, Meta's auction optimizer never exits learning phase, making any signal noisy. Concentrating the entire 1k on one channel gives the cleanest read on whether the value prop and creative work.

### Channels deferred (and when they re-enter scope)

| Channel | Add when |
|---|---|
| **Google Search** (Łódź radius, fuel-related queries) | Meta validates as A-tier and budget rises to ≥ 2,000 PLN/month |
| **Waze Ads (self-serve Pin + Takeover)** | Meta proves creative works, OR Meta plateaus — Waze tests the "driver-en-route" moment |
| **Spotify Ad Studio** (city-targeted audio) | Considered post-Łódź once we have brand creative |
| **Local radio (Eska/RMF Łódź split)** | Considered when monthly spend > 5,000 PLN |
| **TikTok / Snap / Reddit / Wykop / DOOH** | Not on roadmap for this soft launch |

### Channels excluded by founder preference (do not reconsider for this launch)

- Influencer marketing
- Founder-personal-story PR / media features
- TikTok-style UGC video creative

---

## 4. Budget

**Initial test:** 1,000 PLN over ~30 days, daily cap ~33 PLN, single Meta campaign with one ad set.

**Scale-up trigger:** see Section 7 — Decision Gates.

**Expected outcomes at 1k PLN spend:**
- ~80–200 installs (CPI 5–12 PLN range typical for PL utility apps with decent creative)
- ~30–50% install-to-weekly-active conversion → 25–100 weekly active users
- ~5–15% weekly-active-to-submitter conversion → 1–15 weekly submitters

This is **exploratory data**, not a critical-mass injection. The 1k PLN budget does not, on its own, bootstrap Łódź data sustainability — see Section 5 for the cold-start bridge.

---

## 5. Cold-start data bridge — founder photo seeding

To prevent the app feeling empty while the user base builds, the founder will personally seed price photos.

**Plan:**
- Target: 30–50 photos/week, focused on top-traffic Łódź stations
- Routes: integrated with normal commute / cycling rides — not dedicated trips
- Backend: each founder submission tagged with an internal `seed=true` flag (single account, no rotation needed) for analytics
- **Time-box: 6 weeks** from soft launch start

**Discipline gate at week 6:**
- Founder submissions should be **≤ 25%** of total weekly submissions
- If founder submissions are still ≥ 50% of total at week 6 → **stop seeding** and treat as a signal that the user funnel is broken (UX, onboarding, or value prop), not that more spend will fix it
- If healthy → taper founder seeding over 2 more weeks and stop

**Coverage math:**
- ~120–150 stations in Łódź
- Priority subset: top 20–30 high-traffic stations needing fresh price every 48 h → ~75–105 photos/week
- 30–50 founder photos/week = ~30–65% of priority-station refresh need
- Combined with even 100–200 installed users at modest submission rate → priority freshness sustainable from day one

---

## 6. Creative principles & copy

### Format priorities (in order of asset effort)

1. **Static images** — primary creative, three concepts × three crops (1:1, 4:5, 9:16)
2. **Optional simple GIF / short MP4 of app screen recording** (no face, no narration) — only if static creative validates and we want to test motion lift
3. **No UGC, no founder appearance, no live-action video**

### Copy A/B framing

Run two text variants on the same image set; let Meta auction-optimize:

- **Variant A — geo-specific (Łódź in headline)**
  - *"Tankuj taniej w Łodzi — sprawdź ceny na każdej stacji"*
  - *"Łodzianie, nie przepłacajcie na stacji. Zobacz najtańsze paliwo dziś."*
- **Variant B — universal (reusable when expanding)**
  - *"Nie przepłacaj za paliwo. Zobacz najtańsze stacje w okolicy."*
  - *"Zaoszczędź ok. 150–250 zł/mies. na paliwie. Sprawdź gdzie tankować taniej."*

Assets stay identical across A/B; only the headline + primary text strings differ.

### PL ad-copy patterns to apply

- **Specific number > vague claim** — "Zaoszczędź 200 zł/mies." beats "Oszczędzaj"; numbers must be defensible
- **Question hook** — "Wiesz, gdzie jest dziś najtańsze paliwo w Łodzi?"
- **Imperative + verb** — *Sprawdź*, *Zobacz*, *Tankuj*
- **Local identity word** — *Łodzianie* outperforms city-name only
- **Pain hook** — *Nie przepłacaj*
- Avoid corporate Polish — *appka* or *aplikacja* both fine; *aplikacja mobilna* sounds B2B

---

## 7. Success metrics & decision gates

### North-star metric for the soft launch

**Sustainable Łódź data flywheel** — defined as: ≥ 70% of top-30 priority Łódź stations have a fresh community price (≤ 48 h old) on any given day, *without* founder seeding contributing > 25% of weekly submissions.

### Tactical metrics tracked weekly

| Metric | Target to continue spend | Tracked in |
|---|---|---|
| **Meta CPI** | < 10 PLN | Meta Ads Manager |
| **Install → weekly active** | ≥ 30% | Existing analytics (TBD: GA / Mixpanel / custom) |
| **Weekly active → submitter** | ≥ 8% | API / submissions DB |
| **Founder seeding share** | ≤ 25% by week 6 | API submissions table, `seed=true` flag |

### Decision gates

| Gate | Trigger | Action |
|---|---|---|
| **G1 — Half-budget review** | 500 PLN spent (~day 14) | Pause underperforming ad variants. Keep top creative running. If no creative meets CPI < 15 PLN → reformulate copy/imagery before continuing. |
| **G2 — End of test** | 1,000 PLN spent | Decide: scale up to 2–3k/mo on Meta + add Google Search; switch primary channel; or pause and rework. |
| **G3 — Founder seeding review** | Week 6 from launch | Confirm founder share ≤ 25%. If not → pause spend, investigate funnel. |
| **G4 — Geographic expansion** | 8 weeks of stable submission flywheel in Łódź | Plan Warsaw or second-city pilot using validated Variant B universal creative. |

### What "fail" looks like (and what we'd do about it)

- **CPI > 15 PLN with no winning variant after 500 PLN spent** → creative or value prop is wrong. Don't double down. Rewrite copy, possibly redesign imagery, or rethink the offer.
- **Install → active < 20%** → onboarding friction or app value isn't landing. Stop spend; fix the app, then resume.
- **Active → submitter < 3%** → submission UX is blocking the flywheel. Stop spend; fix the loop, then resume.
- **Founder seeding share > 50% at week 6** → user acquisition isn't producing reporters at the rate needed. Likely UX/value-prop issue, not budget issue. Pause and diagnose.

---

## 8. Dependencies & prerequisites

### Hard prerequisites — must be in place before launch

- [x] Android app live in Google Play (production)
- [x] Public website with at least a download CTA (no marketing landing page required for v1 — direct-to-Play-Store ad routing is sufficient)
- [x] Privacy policy + terms published at stable URLs
- [ ] **Submission funnel validated end-to-end with friends-and-family beta** — at least 5–10 real submissions per day flowing through OCR + verification before paid spend begins
- [ ] **Analytics in place** to measure CPI, install → active, active → submitter
- [ ] **Founder backend flag** — `seed=true` on founder-account submissions, queryable in admin

### Soft prerequisites — desired but not blocking

- iOS app live in App Store *(deferred — this soft launch is Android-only by design)*
- Custom domain live with email forwarding
- Localized landing page section optimised for ad traffic *(skipped — Play Store conversion is sufficient at this budget)*

### Risks & open items

| Risk | Mitigation |
|---|---|
| Apple Developer enrollment not yet done — iOS users in Łódź wasted from any future cross-OS campaign | Use Android-only OS targeting in Meta until iOS launches; defer Apple-specific spend. |
| Personal-account ownership of all infra (per memory) — could be brand exposure if anyone digs into store / privacy listing | No mitigation in this plan; tracked in [project_accounts.md](../../../.claude/projects/c--Users-Mateusz-projects-desert/memory/project_accounts.md). |
| Submission OCR cost spike if launch drives more uploads than expected | OCR spend cap (per [project_ocr_spend_cap.md](../../../.claude/projects/c--Users-Mateusz-projects-desert/memory/project_ocr_spend_cap.md)) protects spend; monitor admin cost dashboard daily during ramp. |
| Founder seeding becomes a permanent crutch | Hard 6-week cap and decision gate G3 protect against this. |

---

## 9. Execution sequence

| Phase | What | When |
|---|---|---|
| **0 — Prep** | Story 15.1 — produce Meta creatives + copy bank. Add founder `seed` flag. Validate analytics signal. | Before launch |
| **1 — Pilot launch** | Meta campaign live, 1,000 PLN over 30 days, Łódź 15 km radius, Android-only. Founder photo seeding starts. | Day 0–30 |
| **2 — Half-budget review (G1)** | Pause losing variants, keep winners running. | Day ~14 |
| **3 — End-of-test review (G2)** | Decide: scale, switch channel, or rework. | Day ~30 |
| **4 — Founder seeding review (G3)** | Confirm seeding share ≤ 25%; taper if healthy. | Week 6 |
| **5 — Optional channel add** | If G2 says scale: add Google Search; consider Waze. | Day 30+ |
| **6 — Expansion gate (G4)** | Decide on Warsaw / second-city pilot. | ~Week 8+ |

---

## 10. Tracking — where this work lives

- **Epic:** [Epic 15 — Marketing & Soft Launch](./epic-15-marketing-soft-launch.md)
- **First story:** [Story 15.1 — Meta Ad Creative Production](../implementation-artifacts/15-1-meta-ad-creative-production.md)
- **Sprint status:** registered in [sprint-status.yaml](../implementation-artifacts/sprint-status.yaml)
- **Memory references:**
  - [project_accounts.md](../../../.claude/projects/c--Users-Mateusz-projects-desert/memory/project_accounts.md) — personal-account exposure
  - [project_deferred.md](../../../.claude/projects/c--Users-Mateusz-projects-desert/memory/project_deferred.md) — Apple Developer enrollment
  - [project_ocr_spend_cap.md](../../../.claude/projects/c--Users-Mateusz-projects-desert/memory/project_ocr_spend_cap.md) — OCR cost containment during ramp

---

## 11. Open product/PM questions

These are intentionally listed so they don't fall through the cracks. Each warrants a decision before Story 15.1 ships:

1. **Analytics stack** — what tracks install → active → submitter? Existing custom DB queries, or a tool (Mixpanel, GA4, PostHog)?
2. **Submission seed flag** — confirm where in the API the founder `seed=true` flag lives, and that it's excluded from "community freshness" metrics on the user-facing map.
3. **Hard rejection of any creative with founder face / voice** — confirm written into the creative brief so the designer doesn't propose it.
4. **Brand voice for Polish copy** — is *"appka"* acceptable, or do we stay with *"aplikacja"*? Decide once and stick with it across all variants.
5. **Click destination** — direct Play Store install link, or a /pobierz redirect on the existing web app for tracking? Recommend the latter (single redirect under our control = better CPI debugging) — to confirm.
