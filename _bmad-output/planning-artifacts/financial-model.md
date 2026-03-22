# desert — Financial Model

*Living document. Update assumptions as real data comes in — early actuals will be more reliable than these estimates.*

---

## Assumptions

**User behaviour:**
- Contribution rate: 25% of MAU submit at least one photo per month
- Average photos per contributing session: 2
- Photos/month = MAU × 25% × 2

**Station promotions:**
- Price: 50 PLN/active day (~$12)
- 7-day campaign = 350 PLN (~$85)
- Conversion rate (verified owners buying at least one campaign/month): 5% conservative, 10% optimistic
- Verified stations claimed: roughly 10% of total stations in active cities

**Data licensing:**
- Fuel price API: $500-1,500/mo per buyer
- Consumption API (Phase 2+, after Epic 5 matures): $1,000-3,000/mo per buyer
- Buyer count grows slowly — B2B sales cycles are long

**Website ads:**
- RPM (revenue per 1,000 pageviews): $2-5 for Polish motoring/finance niche
- Pageviews roughly 3-5× MAU per month (SEO pulls non-app users too)

**Exchange rate assumption:** 1 USD ≈ 4 PLN

---

## Infrastructure Costs by Traffic Tier

| Component | 1k-5k MAU | 10k-30k MAU | 100k MAU | 500k MAU | 1M MAU |
|---|---|---|---|---|---|
| Claude Haiku OCR | ~$2 | ~$10 | ~$55 | ~$225 | ~$450 |
| Neon PostgreSQL | ~$0 (free) | ~$19 | ~$80 | ~$150 | ~$250 |
| Upstash Redis | ~$0 (free) | ~$10 | ~$50 | ~$100 | ~$150 |
| Mapbox/HERE maps | ~$0 (free) | ~$20 | ~$100 | ~$300 | ~$500 |
| Google Places sync | ~$0 (free credit) | ~$0 | ~$20 | ~$40 | ~$60 |
| Railway compute | ~$20 | ~$30 | ~$80 | ~$200 | ~$350 |
| Vercel web/admin | ~$0 (free) | ~$0 | ~$20 | ~$40 | ~$60 |
| Cloudflare R2 | ~$0 | ~$0 | ~$5 | ~$10 | ~$15 |
| FCM push | $0 | $0 | $0 | $0 | $0 |
| **Total infra/mo** | **~$22** | **~$89** | **~$410** | **~$1,065** | **~$1,835** |

---

## Revenue by Traffic Tier

### Website Ads

| MAU | Est. pageviews/mo | RPM | Monthly revenue |
|---|---|---|---|
| 1k-5k | ~15,000 | $3 | ~$45 |
| 10k-30k | ~75,000 | $3 | ~$225 |
| 100k | ~350,000 | $4 | ~$1,400 |
| 500k | ~1,500,000 | $4 | ~$6,000 |
| 1M | ~3,000,000 | $5 | ~$15,000 |

*Note: SEO compounds over time — pageviews at the same MAU level grow as content accumulates. These estimates reflect 12+ months of content maturity.*

---

### Station Promotions

| MAU | Active cities | Verified stations | 5% conversion | 10% conversion |
|---|---|---|---|---|
| 1k-5k | 1 (Łódź) | ~20 | ~$85/mo | ~$170/mo |
| 10k-30k | 2-3 cities | ~100 | ~$425/mo | ~$850/mo |
| 100k | Major cities | ~500 | ~$2,125/mo | ~$4,250/mo |
| 500k | National | ~2,000 | ~$8,500/mo | ~$17,000/mo |
| 1M | National + growth | ~4,000 | ~$17,000/mo | ~$34,000/mo |

*Note: Station promotions require Epic 7 (Phase 2) to be live. No revenue from this stream at MVP.*

---

### Data Licensing

| MAU | Data maturity | Fuel price buyers | Consumption buyers | Monthly revenue |
|---|---|---|---|---|
| 1k-5k | Too early | 0 | 0 | $0 |
| 10k-30k | Early — 1 deal possible | 0-1 | 0 | $0-1,500 |
| 100k | Credible dataset | 1-3 | 0-1 | $1,500-7,500 |
| 500k | Strong dataset | 3-6 | 1-3 | $6,000-18,000 |
| 1M | Premium dataset | 5-10 | 3-6 | $12,000-36,000 |

*Note: Consumption API requires 12+ months of Epic 5 (pump meter) adoption before it's commercially interesting. Fuel price API is sellable from ~6 months post-launch if data quality is high.*

---

## Combined P&L by Traffic Tier

| MAU | Infra cost | Ads | Promotions (mid) | Data licensing (mid) | **Total revenue** | **Net/mo** |
|---|---|---|---|---|---|---|
| 1k-5k | ~$22 | ~$45 | $0 | $0 | **~$45** | **+$23** |
| 10k-30k | ~$89 | ~$225 | ~$640 | ~$750 | **~$1,615** | **+$1,526** |
| 100k | ~$410 | ~$1,400 | ~$3,190 | ~$4,500 | **~$9,090** | **+$8,680** |
| 500k | ~$1,065 | ~$6,000 | ~$12,750 | ~$12,000 | **~$30,750** | **+$29,685** |
| 1M | ~$1,835 | ~$15,000 | ~$25,500 | ~$24,000 | **~$64,500** | **+$62,665** |

---

## Break-Even Analysis

**Infrastructure break-even** (covering hard costs only, excl. Mateusz's time):

- Covered by ads alone from ~1k-5k MAU — essentially from day one if SEO works
- Hard cost floor: ~$22/mo at launch, ~$89/mo at 10k MAU
- Maximum negative exposure at zero revenue: $100-150/mo × months to first revenue
- With $5-7k ceiling: **3-4 years of pure infrastructure runway**

**First meaningful revenue milestone:** ~10k-30k MAU — all three streams contributing, net positive ~$1,500/mo

---

## Key Uncertainties

| Variable | Impact | Notes |
|---|---|---|
| Maps cost at scale | Medium | Mapbox tile rendering depends on sessions/user — monitor early |
| Station owner conversion rate | High | 5-10% is an estimate — real rate unknown until Phase 2 |
| Data licensing deal timing | High | One deal changes everything — B2B sales cycles unpredictable |
| SEO content traction | Medium | Compounds slowly, hard to forecast |
| Contribution rate | Medium | 25% assumption — may be higher with good UX, lower with friction |
| Compute spikes | Low-Medium | Rush hour concurrency — Railway auto-scales but costs rise |

---

## Milestones to Revisit This Model

- **After Łódź launch:** update contribution rate assumption with real data
- **After Phase 2 launch:** update station owner conversion rate with real data
- **After first data licensing conversation:** update deal size and buyer count estimates
- **At 10k MAU:** maps cost actuals will reveal if Mapbox estimate is accurate

---

---

## Acquisition Valuation Model

*Based on real transaction research conducted 2026-03-20. Sources: Waze/Google, GasBuddy/PDI/OPIS, Nextdoor SPAC, Foursquare, Yanosik SA (WSE: YAN), CEE M&A data.*

---

### Key Comparable Transactions

| Transaction | Year | Users | Deal value | Implied $/MAU | Notes |
|---|---|---|---|---|---|
| **Waze → Google** | 2013 | ~50M MAU | ~$1.1B | **~$22/MAU** | Near-zero revenue — pure data/community premium. Most relevant strategic comparable. |
| **GasBuddy → PDI** | 2021 | ~5M MAU | Undisclosed (~$100-300M est.) | **~$20-60/MAU** | Closest direct comparable — crowdsourced fuel prices. Strategic value was B2B data layer. |
| **GasBuddy → OPIS** | 2025 | Undisclosed | Undisclosed | — | Further pivot to fuel price intelligence / B2B data |
| **Nextdoor IPO** | 2021 | ~42M WAU | $4.3B | **~$102/WAU** | Hyperlocal community premium at peak. Now trades at ~$10/WAU — shows range |
| **Yanosik SA (public)** | 2024 | ~3M MAU | ~$37M market cap | **~$12/MAU** | Polish crowdsourced navigation app — closest Polish public comparable. Private acquisition would add 30-50% premium → ~$17-18/MAU |

**The GasBuddy transaction is the single most important comparable** — same model (crowdsourced fuel prices), same strategic rationale (B2B data layer + consumer network). Desert is an earlier-stage version of exactly what PDI paid for.

---

### Valuation Framework

Three scenarios depending on buyer type and maturity stage:

#### Scenario A — Financial buyer (pre-revenue or early revenue)
Private equity, no strategic premium. Needs clear cash flow.
- **Multiple:** $5-10/MAU
- Requires: demonstrable monetisation, positive unit economics

| MAU | Valuation |
|---|---|
| 50k | $250k - $500k |
| 100k | $500k - $1M |
| 500k | $2.5M - $5M |
| 1M | $5M - $10M |

#### Scenario B — Strategic buyer, data premium
Oil majors (Orlen, Shell, BP), navigation platforms (Google Maps, HERE, Apple Maps), fuel price data companies (OPIS, Platts, e-petrol.pl), mobility platforms.
- **Multiple:** $20-50/MAU (Waze/GasBuddy range)
- Requires: self-sustaining contributor network, coverage density, data freshness proof

| MAU | Conservative ($20/MAU) | Optimistic ($50/MAU) |
|---|---|---|
| 50k | $1M | $2.5M |
| 100k | $2M | $5M |
| 500k | $10M | $25M |
| 1M | $20M | $50M |

#### Scenario C — Revenue-generating, strategic acquirer
Multiple streams proven, B2B data licensing active, growth trajectory clear.
- **Multiple:** 5-10x ARR with strategic premium

| ARR | Multiple | Valuation |
|---|---|---|
| €500k | 5x | €2.5M |
| €1M | 7x | €7M |
| €2M | 7x | €14M |
| €5M | 10x | €50M |

---

### What Drives the Premium

In order of impact on valuation:

1. **Active contributor rate** — % of MAU who actually report prices (not just consume). Even 2-5% active reporters makes the network defensible. This is the GasBuddy moat.
2. **Coverage density** — % of Polish stations covered with fresh data (<24h). 80%+ coverage is the defensibility threshold.
3. **B2B data licensing proof** — even one paying enterprise customer transforms the valuation conversation from "potential" to "proven." Single biggest valuation lever.
4. **Data freshness** — average age of price data across covered stations. Lower = more valuable.
5. **Geographic exclusivity** — no comparable crowdsourced fuel price dataset exists for Poland. Scarcity has value.
6. **DAU/MAU ratio** — fuel apps naturally lower than daily apps (refuelling is weekly). Offset by emphasising contributor rate and data freshness metrics instead.

---

### Most Likely Acquirer Profile

| Buyer type | Why they'd buy | When | Premium level |
|---|---|---|---|
| **Fuel price data/analytics** (OPIS, Platts, e-petrol.pl) | Want Polish market data feed | 100k+ MAU, data licensing proven | High |
| **Oil/fuel majors** (Orlen, Shell) | Competitive price intelligence, control narrative | 200k+ MAU, national coverage | Very high |
| **Navigation platforms** (Google/Waze, HERE, Apple) | Fill crowdsourced fuel price gap in CEE | 500k+ MAU, proven contributor network | Highest |
| **Polish strategic** (Allegro, OLX, Yanosik) | User base acquisition, adjacent product | 100k+ MAU | Medium |
| **Private equity** | Cash flow business | €1M+ ARR, profitable | Low |

**The Orlen angle is worth noting specifically.** PKN Orlen is Poland's dominant fuel retailer and one of the largest companies in CEE. An independent app with 500k+ Polish drivers and real-time price data for all their competitors is strategically uncomfortable for them — and strategically valuable. They could be a buyer or a partner.

---

### The Waze Lesson

Waze had near-zero revenue at acquisition. Google paid $1.1B for:
- A self-sustaining contributor community Google couldn't replicate
- Time-stamped, location-tagged crowdsourced data
- The impossibility of rebuilding the network from scratch

Desert's data has the same structural properties in the Polish fuel market. The contributor network, once self-sustaining, is the moat — not the app itself.

**Bottom line:** at 500k MAU with a self-sustaining contributor network and at least one B2B data licensing deal as proof, a strategic acquirer in the $10-25M range is realistic. At 1M MAU with national coverage, $20-50M is the strategic buyer range based on comparable transactions.

---

*Last updated: 2026-03-20*
