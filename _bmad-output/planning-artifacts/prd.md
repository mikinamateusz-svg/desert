---
stepsCompleted: ['step-01-init', 'step-02-discovery', 'step-02b-vision', 'step-02c-executive-summary', 'step-03-success', 'step-04-journeys', 'step-05-domain', 'step-06-innovation', 'step-07-project-type', 'step-08-scoping', 'step-09-functional', 'step-10-nonfunctional', 'step-11-polish']
inputDocuments: []
workflowType: 'prd'
classification:
  projectType: 'Mobile app + backend platform (web portal v2+)'
  domain: 'Transportation / Local Services / Consumer + B2B data monetization'
  complexity: 'Medium (MVP) → High (full vision)'
  projectContext: 'greenfield'
  launchMarket: 'Poland → global expansion'
  architecturePhilosophy: 'Build to differentiate, integrate existing solutions everywhere else'
  revenuePillars: ['Station promoted placement (Phase 2)', 'Station deal advertising (Phase 2)', 'Anonymous data licensing', 'Fleet subscriptions (Phase 3)']
  coldStartStrategy: 'Seeded regional estimates (voivodeship-level), community-refined over time'
  stationMatchingStrategy: 'GPS geolocation (primary) + logo recognition (confirmation) via existing APIs'
  coreUXPrinciple: '10 seconds and done — user points and shoots, everything else is handled async server-side'
briefCount: 0
researchCount: 0
brainstormingCount: 0
projectDocsCount: 0
---

# Product Requirements Document - desert

**Author:** Mateusz
**Date:** 2026-03-17

## Executive Summary

A community-powered mobile platform that gives drivers real-time, crowdsourced fuel prices at stations around them — with zero manual effort. Drivers contribute price data by photographing price boards at stations; AI reads the prices, geolocates the photo against the nearest station (confirmed via logo recognition), and instantly updates a shared database. The result: every driver always knows they're paying a fair price, and never feels like the sucker at an expensive station.

Targeting Polish drivers first — a market with record-high fuel prices, strong deal-seeking culture, and no established competitor — before expanding globally on a proven playbook. Free forever for drivers, who feed the system with data in exchange for always-current prices, personalised price alerts, monthly savings summaries, and a social leaderboard to compete against fellow drivers.

The platform serves three distinct categories of actors, each deriving different value:
- **Drivers** — free access to real-time prices, proactive alerts, and savings intelligence in exchange for community data contributions. Optional progressive capture unlocks deeper value: price board photo alone grants community access and leaderboard; adding a pump meter photo unlocks personal savings summaries; adding an odometer photo unlocks consumption tracking and history.
- **Gas stations and chains** — paid promotional and advertising tools to reach price-conscious drivers at the exact moment of decision.
- **Data buyers** (navigation platforms, logistics companies, financial analysts, oil companies, insurers, car manufacturers, regulators, market research firms) — licensed access to anonymous aggregate datasets spanning fuel prices, driver purchasing behaviour (volumes, frequency, station preferences), and real-world vehicle consumption metrics (l/100km by region, vehicle type, season). Stations hold fragments of this in silos; this platform aggregates it neutrally across the market. Full buyer landscape to be validated as dataset matures — principle is to collect comprehensively now and monetise as value becomes clear.

This multi-sided model creates a genuinely diversified and resilient business: driver growth feeds station advertising value, station data enriches the dataset, and dataset density unlocks data licensing revenue. Each stream reinforces the others. Professional drivers and fleet operators represent a further segment where the value shifts from emotional to financial — material fuel cost savings at scale, with route-optimised refuelling as a planned capability.

### What Makes This Special

**Zero-effort contribution:** One photo, 10 seconds, done. AI and geolocation handle everything async — the user is back on the road before processing completes.

**Feels like a friend, not a tool:** Price drop notifications alert drivers when a nearby station gets cheaper — a personal tip, not a generic update. Sharp-rise alerts prompt action before prices climb further. The app works for drivers even when they're not actively using it.

**The right psychological hooks:** Per-litre price pain is disproportionately felt even when the absolute saving is small. Loss aversion, monthly savings summaries, and a social leaderboard ("you're in the top 15% of savers in Warsaw this month") turn rational frugality into an identity and a competition — a very Polish one.

**Proactive intelligence, not just a lookup tool:** Predictive pricing fed by crude oil markets, seasonal patterns, and geopolitical signals delivers a "fuel price weather forecast" no Polish competitor currently offers. Unique insight = unique value = stickiness.

**Build to differentiate, integrate everything else:** OCR via existing vision APIs, maps via Google Maps Places, auth and push notifications off the shelf. Engineering effort concentrated on community flywheel, AI matching logic, and data layer — the actual moat.

**First-mover in Poland:** No established competitor. Community-driven apps compound with density — getting there first is the advantage.

## Success Criteria

### User Success

The product succeeds for users when drivers instinctively consult the app before deciding where to refuel — treating it as a trusted friend rather than an occasional lookup tool.

**Engagement tiers:**
- **L1 (Consumer):** Opens the app — counted as active user
- **L2 (Contributor):** Submits at least one price board photo per month — feeds the community flywheel
- **L3 (Power user):** Uses additional capture services (pump meter, odometer) — deeper personal value and richer dataset

**Target metrics:**
- **WAU** as primary engagement heartbeat (fuel is a weekly-or-less activity; DAU is structurally low)
- **Photo submission rate:** ≥25% of MAU submit at least one photo per month
- **App store rating:** 4.5+ sustained (4.0 absolute floor — product must be easy and reliable, no reason to settle lower)
- Contribution rate expected to be context-sensitive: users more likely to submit when they notice a price discrepancy vs. when price matches what's shown

### Business Success

**12-month north star:** 100–200k MAU in Poland. At this density, the community flywheel is self-sustaining and price data is reliably fresh across the network.

**Longer-term north star:** Millions of MAU in Poland alone if product-market fit is strong. Global expansion multiplies that by orders of magnitude — sky is the limit.

**First monetisation milestone:** Any revenue event from any stream (data licensing deal, first paying station promotion) validates the business model regardless of timing.

**Organic station contributor acquisition:** Station owners self-updating prices (especially price drops) treated as a leading indicator of platform value and a free growth channel.

**Data licensing:** Initial outreach targets analytics firms, insurance companies, and automotive data portals. Buyer landscape to be validated through early conversations — no fixed hypothesis at this stage.

### Technical Success

**Data freshness:** Defined by accuracy, not age. Prices are considered fresh when they reflect reality — stable prices from weeks ago are valid; changed prices from hours ago are stale. System detects market-wide price movements via macro signals (crude oil prices, regional submission patterns, market news) and proactively flags affected stations as "prices may have changed" before drivers arrive — setting expectations, reducing frustration, and nudging contributors to update.

**Speed and frictionlessness:**
- Finding the best-priced station nearby or along a route is immediate
- Photo upload UX: photo taken → immediate "Thank you" confirmation displayed → full async processing behind the scenes. User is done in under 10 seconds with no perceptible wait.
- No additional steps beyond taking the photo — one tap, done

**AI accuracy at launch:** Approximate is acceptable. The community self-corrects — drivers visiting a station with a wrong price have strong incentive to submit an update. Accuracy improves organically with usage. Logo recognition + GPS matching needs to be reliable enough to assign submissions to the correct station the majority of the time.

### Measurable Outcomes

| Metric | Target | Timeframe |
|---|---|---|
| MAU | 100–200k | 12 months post-launch |
| MAU north star | Millions (Poland alone) | Long-term |
| WAU/MAU ratio | To be baselined | Post-launch |
| Photo submission rate | ≥25% of MAU | Ongoing |
| App store rating | 4.5+ | Sustained |
| First monetisation event | Any stream | As early as possible |

## User Journeys

### Journey 1: Marek — The Casual Driver

*Marek, 34, IT project manager in Warsaw. Drives 20 minutes to the office every day. Fuel is an afterthought — he fills up when the warning light comes on, at whatever station is nearest. He's never felt ripped off exactly, but he's also never felt like he was making a smart decision.*

**Opening scene:** It's Tuesday evening. The fuel light blinks on during Marek's commute home. There's an Orlen on his route but he vaguely remembers his colleague mentioning prices are high there. He doesn't know where else to go.

**Rising action:** A friend sends him the app. Marek opens it — instantly sees a map with nearby stations, colour-coded by price. The Orlen on his route is indeed the most expensive in a 3km radius. There's a BP two streets over, 18 groszy cheaper per litre. He'd never have known. He drives the extra 400 metres.

**Climax:** At the pump, filling up, he notices the price board doesn't match what the app shows. Slight discrepancy. He thinks — *"I could fix that."* He opens the app, takes a photo of the board, uploads it. Thank you. Done. 8 seconds. He feels unexpectedly good about it.

**Resolution:** Marek now checks the app every time the fuel light comes on. He's not obsessed — he just doesn't feel like a sucker anymore. He's submitted maybe 10 photos in three months. He doesn't think of himself as a contributor. He just thinks of it as a useful app.

*Reveals requirements: map view with colour-coded pricing, station detail screen, one-tap photo upload, immediate confirmation UX, lightweight account creation at first launch.*

---

### Journey 2: Kasia — The Competitive Saver

*Kasia, 28, runs her own small courier business, drives 800km per month. Fuel is a real cost for her. She tracks expenses in a spreadsheet. She's the kind of person who reads Which? and compares energy tariffs for fun. She will absolutely find the cheapest station.*

**Opening scene:** Kasia hears about the app and is immediately intrigued by the savings tracking feature. She downloads it on the spot.

**Rising action:** First fill-up with the app: she takes the price board photo, then the pump meter photo. The app calculates her savings vs. the area average — 23 PLN this fill-up. Small, but visible. She notices the leaderboard. She's in the bottom third of savers in her district. *That's not acceptable.*

**Climax:** By the end of the month Kasia has submitted 11 photos — she's updated prices at every station on her regular routes. She's moved to the top 20% on the leaderboard. Her monthly savings summary arrives: 94 PLN saved vs. average. She screenshots it and sends it to a friend. *"Try beating that."*

**Resolution:** The app is now open on every fill-up without exception. She checks it before long drives to plan her refuelling stops. She's recommended it to four people. She's the community that makes the product work.

*Reveals requirements: pump meter OCR and savings calculation, monthly savings summary, leaderboard with geographic segmentation, social sharing of savings, contributor streak/history.*

---

### Journey 3: Zofia — The Personal Stats Enthusiast

*Zofia, 41, secondary school teacher. Drives a diesel Skoda Octavia. She keeps a physical logbook of every fill-up — date, litres, price, odometer. Has done for 11 years. She loves the data. She will never take a community photo — that's not her thing. But she would absolutely use an app that automates her logbook.*

**Opening scene:** Zofia's daughter shows her the app. Zofia is initially uninterested — she's fine with her notebook. But then she sees the odometer and pump meter capture features. Her eyes light up.

**Rising action:** First fill-up: she takes the pump meter photo and the odometer photo. The app calculates her l/100km automatically. It matches her manual calculation almost exactly. She feels validated — and then she feels something else: *this is so much faster than writing it down.*

**Climax:** Three months in, Zofia has a complete digital consumption history. She can see her fuel efficiency dropping slightly over winter — something she'd noticed but never had cleanly visualised. She's never submitted a single price board photo. She has never looked at the leaderboard. She doesn't care about the community features at all.

**Resolution:** Zofia is a loyal, retained user who gets deep personal value from the app without contributing to the community dataset. She's recommended it to three colleagues for the logbook feature alone.

*Reveals requirements: pump meter + odometer OCR without requiring price board submission, personal consumption history and visualisation, l/100km calculation, fuel cost trends, app value must exist independently of community participation.*

---

### Journey 4: Tomasz — The Long-Haul Driver

*Tomasz, 47, drives an articulated lorry for a logistics company. Covers 6,000–8,000km per month. Fuel is 35% of his operating cost. He keeps meticulous records in a battered notebook. His company reimburses him but monitors his fuel efficiency closely. Every grosz counts — genuinely.*

**Opening scene:** Tomasz hears about the app from another driver at a truck stop near Łódź. Sceptical — he's seen plenty of apps that don't understand the reality of the road. But he tries it.

**Rising action:** He quickly realises the app covers motorway stations — including the ones that are notoriously overpriced. He starts planning refuelling stops 50km ahead on his route, timing them to hit the cheaper stations just off the motorway exits rather than the highway giants. The route optimisation is rough for now — he does it manually by checking the map — but the data is there.

**Climax:** End of the first month. Tomasz calculates he's saved approximately 380 PLN in fuel costs compared to his usual pattern. He shows his manager. His manager asks what app he's using.

**Resolution:** Tomasz is a daily active user. He submits odometer photos to track his consumption patterns by route and load type — data he's always wanted but never had automatically. He's quietly lobbying his manager to put it on all company vehicles.

*Reveals requirements: route-aware price discovery (not just radius), motorway station coverage, consumption tracking with history, odometer OCR, professional/fleet interest signal for future B2B features.*

---

### Journey 5: Piotr — The Station Manager

*Piotr, 52, manages a family-owned petrol station on the outskirts of Kraków. Not a chain — independent. He competes with an Orlen 800 metres away. When he lowers his prices, he needs people to know. Currently he relies on passing traffic and the occasional banner. It's not enough.*

**Opening scene:** A regular customer tells Piotr his station is showing up on some app with outdated prices — apparently higher than Orlen nearby, when actually he'd dropped his diesel price two days ago. He looks up the app, creates an account.

**Rising action:** Piotr updates his prices directly from the station manager portal. Within hours, his station shows correctly on the map — now visibly cheaper than the Orlen. He notices a small but real uptick in cars pulling in that afternoon.

**Climax:** The app team reaches out about a promotional placement — the ability to appear highlighted when users search in his area, for a modest monthly fee. Piotr tries it for a month. The uplift is measurable — not huge, but clear. Better ROI than the banner.

**Resolution:** Piotr is now a paying customer. He updates prices himself every time they change — he's invested in his accuracy on the platform. He's become one of the most reliable data contributors in Kraków, which ironically helps all his competitors too. He doesn't mind — his station's visibility is what he's paying for.

*Reveals requirements: station manager web portal (v2), self-service price update flow, station verification/authentication, promotional placement product, station analytics (views, clicks, footfall correlation).*

---

### Journey 6: Platform Admin / Ops

*The ops team is small — likely one or two people initially. Their job is to keep the data trustworthy and the system running. They're the invisible quality layer between the community's raw contributions and the prices drivers rely on.*

**Opening scene:** A cluster of suspicious submissions comes in from the same GPS coordinates — identical prices submitted 12 times in 20 minutes. Looks automated or malicious.

**Rising action:** The admin dashboard flags the anomaly automatically. The ops person reviews the submissions, identifies a likely bot pattern, temporarily flags the station's prices as unverified, and blocks the source. They check nearby legitimate submissions to restore accurate data.

**Climax:** A station chain contacts support claiming their competitor is submitting false high prices to make them look expensive. The ops team can pull the submission history for that station — timestamps, device IDs (anonymised), frequency patterns — and investigate.

**Resolution:** The platform maintains data integrity without exposing user data. The ops team has the tools to investigate, act, and restore trust quickly. The community doesn't notice — which is exactly the point.

*Reveals requirements: admin dashboard with anomaly detection, submission audit trail (anonymised), manual override and price flagging tools, station claim and verification workflow, abuse reporting system.*

---

### Journey 7: Data Buyer (Future — Post Critical Mass)

*An analyst at a logistics consultancy needs reliable, real-time regional fuel price indices for Poland. Currently they scrape static data from PKN Orlen's website and supplement with manual spot checks. It's slow, patchy, and always slightly out of date.*

**Opening scene:** They discover the platform has an API. The coverage across Poland — thousands of community-verified data points, updated continuously — is better than anything they've seen.

**Rising action:** They sign up for API access, integrate the regional price feed into their internal dashboards. Within a week they've replaced their manual process entirely.

**Climax:** A client asks for a consumption trend analysis by voivodeship over the last 18 months. The analyst pulls it directly from the API — historical depth, regional granularity, fuel type breakdown. Something that would have taken weeks to compile manually takes an afternoon.

**Resolution:** The consultancy is a paying API subscriber. They cite the platform in published research, driving inbound interest from other analysts and researchers.

*Reveals requirements: data licensing API with authentication, regional aggregation endpoints, historical data access, anonymisation guarantees, pricing tiers for different data depths.*

---

### Journey Requirements Summary

| Capability Area | Driven by |
|---|---|
| Map view with colour-coded station prices | Marek, Zofia |
| One-tap photo upload with instant confirmation | Marek, Kasia, Tomasz |
| Price board OCR + GPS + logo matching | Marek, Kasia, Piotr |
| Pump meter OCR + savings calculation | Kasia, Zofia |
| Odometer OCR + consumption tracking | Tomasz, Zofia |
| Monthly savings summary + social sharing | Kasia |
| Leaderboard with geographic segmentation | Kasia |
| Route-aware price discovery | Tomasz |
| Station manager portal + self-update flow | Piotr |
| Promotional placement product | Piotr |
| Admin dashboard + anomaly detection | Ops |
| Submission audit trail + abuse tools | Ops |
| Data licensing API | Data buyer |
| Personal consumption history + visualisation | Zofia |
| App value independent of community contribution | Zofia |

## Domain-Specific Requirements

### Privacy & GDPR Compliance

- Platform operates under GDPR (Polish/EU jurisdiction) from day one — non-negotiable
- **Data architecture:** Account-linked personal data (consumption history, savings, submissions) stored per user for personal insights features; all data used for platform analytics and licensing is anonymised at the point of aggregation
- **Consent model:** Layered, not bundled — core service consent at signup; feature-specific consent (e.g. consumption tracking) at first use; anonymous data licensing requires no individual consent if properly anonymised
- **Required user rights:** Right to erasure (full account + submission history deletion), data export, consent withdrawal — must be designed into data model from day one, not retrofitted
- **Data minimisation:** Collect only what is needed for stated purposes; raw GPS coordinates used for station matching then anonymised — not stored linked to user identity
- Legal review of T&C and privacy policy required before launch

### Data Integrity

- Community-contributed data is the core asset — integrity is a product-critical concern, not just a technical one
- **Multi-layer integrity chain:**
  1. **Camera-only capture:** Photo submission flow opens device camera directly — gallery upload not permitted. Enforces real-time capture, eliminates recycled or fabricated images at source
  2. **EXIF validation:** GPS coordinates at capture cross-checked against submitted station location; timestamp recency validated; device authenticity signals checked. Manipulated or resubmitted images fail before reaching further layers
  3. **Anomaly detection:** Automatic flagging of suspicious submission patterns (high frequency from same location, prices outside market range for fuel type/region, coordinated multi-account patterns)
  4. **Shadow banning:** Submissions from flagged users silently excluded from live dataset. User sees normal behaviour; manipulated data never surfaces. Triggered by abuse reports, anomaly detection, or cross-user correlation. Preferred over outright blocking — bad actors continue unaware, no incentive to create new accounts
- **Station verification:** Claimed station accounts (managers) require verification before self-update permissions granted

### Technical Constraints

- **Geolocation:** GPS coordinates captured at photo submission time, used immediately for station matching, then anonymised — not stored as raw coordinates linked to user identity. Location permission is mandatory for photo submission — drivers who have not granted it are shown a blocking prompt with a deep-link to app location settings; submission is not possible without it
- **Fuel taxonomy per market:** Each supported market has a defined fuel type dictionary (Poland: LPG, Diesel, 95, 98, 99). AI OCR matches against known list — unknown inputs flagged for review, never published unvalidated
- **Async processing:** All photo processing (OCR, station matching, price validation) happens asynchronously — user receives immediate "Thank you" confirmation, never waits for processing

### Third-Party API Considerations

- **Maps provider — hybrid architecture:** Use Google Places API to seed and periodically sync the station database (one-time/periodic cost for data quality); use Mapbox or HERE Maps for ongoing mobile map display (lower per-load cost). Target 60–70% reduction in Maps API spend vs. Google-only approach. HERE Maps particularly relevant given strong European automotive/transport POI coverage
- **Vision/OCR:** PoC completed across two rounds (2026-03-18/19 synthetic + 2026-03-20 real-world field photos). Key findings:
  - **Traditional OCR (EasyOCR, PaddleOCR): 20%** — not viable regardless of engine. Context-free text extraction cannot handle real-world station photo variability.
  - **Claude Vision (claude-opus-4-6): 100% on photos with a visible price board.** Round 1 (20 synthetic photos): 80% overall, 4 failures were wide-angle shots unreadable even by humans. Round 2 (30 photos, 10 real field shots from Polish stations): 77% overall, all 7 failures were logo-only or misdirected shots with no price board in frame — not OCR failures. On every photo where a price board was actually visible, the model extracted prices correctly. Cost: ~$0.0045/image.
  - **Google Gemini Flash: accuracy untested** — free tier exhausted during PoC (per-project daily quota unreliable without billing enabled). To be validated with billing enabled.
  - **Production recommendation: Claude Haiku 4.5** (~$0.0009/image). Same model family as Opus, sufficient capability for this task. Estimated cost: ~$12/month at mid-case volume (13,500 photos/month = 100K users, 30% MAU, 15% contribution rate). Negligible at scale.
  - **Key UX finding (confirmed by both rounds):** photo capture flow must guide users to shoot the price board close-up. The framing overlay in Story 3.1 directly addresses the only observed failure mode.
  - **Gemini Flash accuracy validation pending** — if Haiku cost ever becomes a concern at very high scale, Gemini Flash (~$7.50/month) is the next candidate to validate.
  - **GPS-to-POI matching:** ✅ real-world validated (2026-03-20). 11 GPS-tagged field photos: 10/11 (91%) station matches at 200m radius. 1 miss = Google Places coverage gap, not systemic. Photos shot from a moving car — production scenario (driver stationary at pump) expected to perform better. Production radius locked at 200m.
- **Push notifications:** Firebase Cloud Messaging — free
- **App store policies:** User-generated photo content requires content moderation consideration — low risk for fuel price imagery; policy compliance to be confirmed with Apple App Store and Google Play guidelines

### Risk Mitigations

| Risk | Mitigation |
|---|---|
| Bad actors manipulating prices | Camera-only capture + EXIF validation + anomaly detection + shadow banning |
| Maps API costs at scale | Hybrid architecture (Google Places for data, Mapbox/HERE for display); aggressive caching |
| GDPR non-compliance | Legal review pre-launch; layered consent; data minimisation by design |
| Cold start (no data at launch) | Seeded voivodeship-level estimates, clearly marked — community refines over time |
| AI mismatching station/price | Logo recognition + GPS dual-confirmation; human review queue for low-confidence matches |
| Runway pressure from API costs | Target first data licensing revenue within 6 months of launch — dataset has commercial value well before consumer critical mass |
| GPS-to-POI match fails in dense urban areas | PoC validates before architecture commitment; fallback to manual review queue |
| OCR accuracy insufficient in poor conditions | Human review queue for low-confidence extractions; community self-correction over time |
| B2B data monetisation takes longer than expected | Tiered fallback: in-app ads → data portal advertising → station promotions → B2B licensing — each tier independently viable |
| Data portal distracts from app focus | Portal scoped separately from core app — complementary SEO acquisition funnel and ad revenue stream |

## Innovation & Novel Patterns

### Detected Innovation Areas

**Zero-effort AI-powered crowdsourcing**
The core contribution model inverts the typical UX burden of crowdsourced apps. Rather than manual data entry, users photograph a price board; AI handles OCR, station matching, and database update asynchronously. The user is done in under 10 seconds with no perceptible wait. This removes the primary barrier to contribution that limits competing approaches.

Station matching uses a two-layer architecture: GPS geolocation as the primary signal (device within forecourt proximity of a known POI), confirmed by logo recognition where confidence is sufficient. Low-confidence matches route to a human review queue rather than failing silently. This architecture is pragmatic — GPS-to-POI matching is tractable; logo recognition adds confidence but is not load-bearing.

**Progressive data capture with tiered personal value**
Each additional photo type unlocks a deeper layer of personal value without requiring users to commit upfront. The full contribution ladder, from least to most effort:

1. **Pump photo only** — user is already at the pump; confirms fuel type (pre-suggested from history and price); captures one price point and enables personal cost tracking. Zero detour required.
2. **Price board photo** — captures all fuel prices at the station in one shot; grants community access and leaderboard participation.
3. **Pump meter photo** — unlocks personal savings summaries vs. area average.
4. **Odometer photo** — unlocks fuel consumption tracking and history (l/100km).

The pump-only path (Level 1) is deliberately designed for users who won't walk to the price board. One price point per fill-up is infinitely more valuable than zero contribution — and the user is already at the pump. Fuel type is pre-suggested based on previous entries and price context; one tap to confirm. This onboards a class of contributor who would otherwise provide nothing.

**Multi-sided data flywheel**
Consumer data contributions generate a commercially valuable anonymous dataset (fuel prices, purchasing behaviour, real-world consumption metrics by vehicle type, region, and season). This unlocks a B2B licensing tier that funds the free consumer product. The flywheel: driver growth → data density → commercial value → revenue → product investment → driver growth.

**Proactive staleness intelligence**
Rather than waiting for prices to be corrected reactively, the platform detects market-wide price movement signals (crude oil prices, regional submission patterns, market news) and proactively flags affected stations as "prices may have changed" — managing driver expectations before arrival and nudging contributors to update.

### Market Context & Competitive Landscape

No established community-driven fuel price platform exists in Poland. The market has record-high fuel prices and a strong deal-seeking cultural disposition — conditions that maximise the perceived value of accurate, real-time pricing. First-mover advantage compounds with community density; the dataset becomes more defensible as it grows.

### Monetisation Fallback Stack

B2B data licensing is the long-term prize but requires scale. The monetisation ladder provides revenue at every stage:

- **Early:** In-app advertising + public data portal with display advertising (low friction, no sales cycle required)
- **Mid:** Station promoted placement (enhanced map visibility, flat fee — modest direct sales effort, clear value proposition for independent stations) + Station deal advertising (chain-level offers displayed in station sheet, billed by active days) + Data licensing API (no scale dependency once data quality is proven)
- **Later (Phase 3):** Fleet subscriptions (clear ROI for business buyers, revisit when fleet demand signals emerge)
- **Later:** B2B data licensing API (longer sales cycle, higher contract value)

The public data portal (fuel price trends, regional consumption benchmarks, l/100km by vehicle type) is independently valuable: SEO-rich content drives organic app acquisition, and the portal itself is ad-monetisable. It is a complementary acquisition and revenue channel, not a competing product.

**Freemium model:** Core app is free for all standard users — this is non-negotiable for network effect and contribution volume. Standard users will never pay enough to matter. Fleet users are the premium segment: companies operating 5+ vehicles have a genuine, measurable business need (fuel cost management, expense tracking, route optimisation) and a clear ROI case for a subscription. Fleet tier is the primary recurring revenue vehicle.

### Validation Approach

**Critical PoC — to be executed before full architecture commitment:**
- **Layer 1:** GPS-to-POI matching accuracy — ✅ **COMPLETED (2026-03-19).** Synthetic test across 15 real Polish stations in 5 cities (Warsaw, Kraków, Wrocław, Gdańsk, Poznań) using Google Places API (`type=gas_station`, filters to fuel stations only). Results: **100% at realistic GPS noise (≤100m), 87% at extreme 200m offset.** Production approach confirmed: `rankby=distance` nearest gas_station lookup within 100–200m radius. The 200m failures are dense urban edge cases where two stations are unusually close — not a real-world concern for a user standing on a forecourt. Real-world validation (Option A — photos with GPS EXIF) in progress to confirm field accuracy.
- **Layer 2:** OCR price extraction accuracy — ✅ **COMPLETED (2026-03-18/19).** Tested 20 real Polish station price board photos. Results: Claude Vision (Opus) 80%, Traditional OCR (EasyOCR, PaddleOCR) 20%. **Production choice: Claude Haiku 4.5 (~$12/month at mid-case volume).** Gemini Flash accuracy pending billing enablement — cost savings marginal vs Haiku at current scale. Critical UX requirement confirmed: close-up photo capture guidance is mandatory.

Logo recognition to be validated separately as a confidence signal, not a primary matcher.

- **Layer 3:** Pump-photo OCR (fill-up transaction extraction) — ✅ **COMPLETED (2026-03-21).** Real-world ORLEN pump display photo tested for dispensed fuel type, price/litre, litres, and total cost. Odometer OCR tested with two real-world instrument cluster photos. Key findings:
  - **Claude Haiku: insufficient for pump displays.** Correct on litres only. Misidentified dispensed fuel, misread 7-segment total cost digits (328.84 vs 383.84), and hallucinated diesel prices by repeating a readable value across unreadable rows.
  - **Claude Sonnet 4.6: accurate on all critical fields.** Dispensed fuel ✅, price/litre 7.99 ✅, litres 48.04 ✅, total cost 383.84 ✅. Returned null (not hallucinated values) for prices obscured by a promotional banner overlay. Applied cross-validation reasoning (`total ÷ litres = price/litre`) to confirm dispensed fuel identity.
  - **Odometer OCR: Haiku sufficient.** Both models read odometer instrument cluster digits correctly at high confidence. Haiku is the right choice for this simpler task.
  - **Cross-validation is a hard pipeline requirement:** `total_cost ÷ litres = dispensed_price_per_litre` must be enforced in the pipeline to catch digit misreads before they reach the database.
  - **Production recommendation (Story 5.2):** Claude Sonnet 4.6 for pump OCR; Claude Haiku 4.5 for odometer OCR. Cost impact: Sonnet is ~15× more expensive per call but pump OCR is one bounded call per fill-up — negligible at scale.
  - **Additional cases needed:** non-ORLEN chains (BP, Shell, Circle K), night/angled shots, pumps without promotional banners (to confirm diesel price reading without occlusion). To be run before Story 5.2 implementation begins.

## Project Classification

- **Project Type:** Mobile app + backend platform (driver-facing app, station-facing web portal in v2+)
- **Domain:** Transportation / Local Services / Consumer, with B2B data monetisation layer
- **Complexity:** Medium (MVP) → High (full vision)
- **Project Context:** Greenfield
- **Launch Market:** Poland (beachhead) → global expansion, market by market
- **Architecture:** Globally-capable from day one, operated in Poland until flywheel proven

## Mobile App + Backend Platform Specific Requirements

### Project-Type Overview

desert is a cross-platform mobile app (iOS + Android) built on **React Native + TypeScript + Expo**, backed by a cloud platform handling async photo processing, data aggregation, and future B2B data licensing. The Expo framework abstracts native build complexity, enabling lean development with full access to required device capabilities (camera, GPS, push notifications).

### Technical Architecture Considerations

**Cross-platform rationale:** React Native + TypeScript + Expo selected for development velocity, AI-assisted development quality (largest training corpus of any mobile stack), and mature library ecosystem for camera and location use cases. Cross-platform limitations (performance ceiling, deep camera control, day-one OS feature access) are not relevant to desert's core use cases at MVP or beyond.

### Platform Requirements

| Platform | Target | Scope | Users |
|---|---|---|---|
| iOS | Latest - 1 major version | MVP | Drivers |
| Android | API level 26+ (Android 8.0+) | MVP | Drivers |
| Admin web app | Modern browsers (Chrome, Firefox, Safari) | MVP | Internal ops team |
| Station manager portal | Modern browsers | v2 | Station owners |
| Public data portal | Modern browsers | Future | General public / SEO |

The admin web app is required from day one — it provides the interface for the ops team to manage the photo review queue, anomaly detection dashboard, submission audit trail, abuse reporting, and station verification. Without it, the data integrity layer has no operational interface.

Public-facing web surfaces (station manager portal, public data portal) are post-MVP.

### Device Permissions

| Permission | Required | Rationale |
|---|---|---|
| Camera | Yes — mandatory | Photo capture for price board, pump meter, odometer |
| Location (while in use) | Yes — mandatory | GPS-to-POI station matching at photo capture time |
| Location (background) | No — not requested at MVP | See Search Mode below |
| Photo library | Explicitly not requested | Camera-only capture enforced for data integrity; gallery access would allow recycled/fabricated images |
| Push notifications | Yes — opt-in | Price drop alerts, sharp-rise alerts, savings summaries |

### Offline Mode

**Offline-first with smart caching.** The app remains useful without connectivity:

- Map view and last-known prices load from local cache when offline
- Photo submissions captured offline are queued locally, confirmed to the user immediately ("Thank you" screen shown regardless of connectivity), and retried automatically with exponential backoff until upload succeeds
- No silent failures — submission queue state is visible to the user if they look

### Push Notification Strategy

**Value-first, contextually re-prompted.**

- Onboarding screen presents notification value proposition (price drop alerts, sharp-rise warnings, monthly savings summaries) before requesting permission — not a cold OS dialog
- Users who decline are not nagged on a timer
- Re-prompts triggered at high-value contextual moments: first photo submission ("Want to know when prices drop near you?"), first savings summary generated
- Notification types: price drop at saved/nearby stations, sharp price rise warning, monthly savings summary

### Future: Search Mode (Location-Sensitive)

A planned post-MVP capability allowing users to activate an explicit navigation session where the app monitors their location in real time and recommends optimal refuelling stops en route.

**Implementation requirements when built:**
- Dedicated location permission prompt scoped explicitly to Search Mode ("only while Search Mode is active")
- Visible in-app indicator while session tracking is active (UX best practice + App Store requirement)
- Session ends explicitly when user exits mode — no passive continuation
- Privacy policy update required to cover session-based location use
- Natural extension to EV route planning and charging stop optimisation

### App Store Compliance

**User-generated content policy:**
- In-app reporting mechanism on all price entries ("report this") routing to admin review queue
- Admin dashboard (already in scope) handles flagged content review
- Written content policy in T&Cs defining acceptable submissions and removal criteria
- No AI moderation required at MVP — volume and severity of fuel price imagery is low; human review queue is sufficient

**Data privacy labels:**
- App Store (Apple) privacy nutrition labels and Google Play data safety section to be completed as a pre-launch deliverable
- Requires mapping all data flows to platform-specific question formats
- GDPR-compliant architecture (data minimisation, anonymisation, no raw GPS stored linked to user identity) provides strong foundation — declaration should be clean
- Flagged as a launch checklist item; dedicated time required before submission

## Project Scoping & Phased Development

### MVP Strategy & Philosophy

**MVP Approach:** Problem-solving MVP — ship the minimum that delivers the core value proposition: drivers can see real-time, community-sourced fuel prices near them, and contribute price data with zero friction. Everything else is iteration.

**Core MVP mission:** Show prices. Collect data. Validate the community flywheel.

**Resource Requirements:** Small team (1–2 engineers + product). Lean by design — third-party APIs handle OCR, maps, auth, and push notifications. Engineering effort concentrated on the contribution pipeline and data layer.

### Phase 1 — MVP Feature Set

**Core User Journeys Supported:** Marek (casual driver discovering and using prices), partial Kasia (price board contribution without savings features), partial Piotr (station data visible on platform — self-update portal comes in Phase 2), Ops team (admin tooling from day one).

**Must-Have Capabilities:**

- Driver mobile app (iOS + Android via React Native + TypeScript + Expo)
  - Map view with nearby stations, colour-coded by price
  - Station detail screen with current prices by fuel type
  - Seeded voivodeship-level price estimates at launch, clearly marked as estimates
  - Price board photo capture → OCR → GPS-to-POI matching → database update
  - Immediate "Thank you" confirmation on photo submission (async processing behind the scenes)
  - Basic user accounts
  - Offline-first: cached map and prices available without connectivity; photo submissions queued and retried automatically
- Admin web app (internal ops)
  - Photo review queue for low-confidence matches
  - Anomaly detection dashboard
  - Submission audit trail (anonymised)
  - Abuse reporting and shadow banning tools
  - Station verification workflow
- Globally-capable backend architecture from day one (multi-currency, fuel taxonomy per market, localisation-ready)
- Core price history database — capturing all submissions from day one for future analytics and licensing value

### Phase 2 — Growth Features

**Expanded contribution model:**
- Pump photo lazy contribution path — photo of pump display, user confirms fuel type (pre-suggested from history and price context), captures one price point without walking to price board
- Pump meter photo → personal savings summaries vs. area average
- Odometer photo → fuel consumption tracking and history (l/100km)

**Engagement and retention:**
- Price drop and sharp-rise push notifications (value-first opt-in strategy)
- Social leaderboard with geographic segmentation (savings ranking among nearby drivers)
- Monthly savings summary with social sharing

**Station and monetisation:**
- Station owner self-update flow
- Station manager portal (web) — price updates, station verification, promoted placement purchase, deal advertisement creation
- Station promoted placement — enhanced map visibility (larger pin, badge) for a flat daily/weekly fee; Phase 2 first monetisation from stations
- Station deal advertising — structured text offers (headline + conditions + dates) displayed in station sheet; ops-moderated; billed by active days; chain-level buyers primary target
- In-app advertising (early revenue, no sales cycle required)
- Public data portal — fuel price trends, consumption benchmarks, ad-monetised, SEO acquisition channel

### Phase 3 — Fleet Tier *(deprioritised from Phase 2)*

**Decision (2026-03-20):** Fleet tier moved from Phase 2 to Phase 3. Core price-discovery value works without it. Fleet drivers' primary needs (cost savings, reporting) are already solved by fuel cards for most fleets. Will revisit when in-app feedback (Story 1.12) produces concrete fleet demand signals.

**Fleet subscription product (B2B, recurring revenue):**
- Fleet dashboard (web) — multi-vehicle fuel cost overview, per-vehicle consumption history, spend vs. area average benchmarks
- Fuel expense reports — exportable, invoice-ready, per-vehicle and per-period breakdowns for accounting
- Price alerts — configurable thresholds per vehicle or fleet; push + email notification
- Route-optimised refuelling suggestions — cheapest station on a planned route within acceptable detour
- Fleet manager admin — add/remove vehicles, assign drivers, manage subscription and billing
- API access — price data and fleet analytics exportable to fleet management or accounting systems

**Pricing model:** Monthly or annual subscription per vehicle or fleet size tier. Target: SME fleets (5–50 vehicles) as primary segment; enterprise (50+) as longer-term upsell with custom contracts.

### Phase 3 — Vision & Expansion

- **Station Picker ("Pick for me")** — driver requests a recommendation; app surfaces top 2 stations ranked by a disclosed algorithm (price, distance, data freshness, active deals); active deal promotions that influenced the result are transparently labelled ("Has active offer"); driver can navigate to either result. Promotions act as a declared commercial tie-breaker — trust preserved through full transparency.
- B2B data licensing API (navigation platforms, logistics, insurers, automotive, financial analysts, regulators)
- Predictive pricing — fuel price forecasting fed by crude oil markets, seasonal patterns, geopolitical signals
- Search Mode — user-triggered active navigation session recommending optimal refuelling stops en route
- EV + ICE route planning mode — proactive stop optimisation along a planned route; EV as primary use case (range-constrained), ICE as secondary (cost optimisation)
- Enterprise fleet contracts and integrations (ERP, telematics, fleet management platforms)
- Global market-by-market expansion playbook

### Risk Mitigation Strategy

**Technical risks:**
- GPS-to-POI matching and OCR accuracy are the critical assumptions — PoC validation required before architecture commitment (see Innovation section). Fallback: human review queue for low-confidence matches ensures data integrity even if AI accuracy is initially imperfect.

**Market risks:**
- Cold start (no community data at launch) mitigated by seeded voivodeship-level estimates. Community self-corrects over time — any data is better than no data.
- No established Polish competitor de-risks market entry; first-mover community density compounds defensibility.

**Resource risks:**
- MVP scope is deliberately minimal — two engineers could build it. Third-party APIs (OCR, maps, auth, push) eliminate the need to build commodity infrastructure.
- Monetisation fallback stack (in-app ads → portal ads → station promos → B2B licensing) ensures revenue options at every scale, reducing runway pressure.

## Functional Requirements

### Price Discovery

- **FR1:** Driver can view a map of nearby fuel stations with current prices
- **FR2:** Driver can filter or identify stations by fuel type
- **FR3:** Driver can view detailed price information for a specific station
- **FR4:** Driver can visually compare prices across nearby stations (colour-coded by relative price)
- **FR5:** Driver can see data freshness indicators on station prices
- **FR6:** Driver can distinguish between estimated prices and community-verified prices
- **FR7:** System automatically determines price staleness per station by combining time-since-last-submission with macro market signals (ORLEN rack price and Brent crude movements, regional submission patterns); stations with likely-outdated prices are visually flagged on the map without sending user notifications

### Data Contribution

- **FR8:** Driver can submit a price board photo to update all fuel prices at a station
- **FR9:** System automatically extracts fuel prices from a submitted price board photo
- **FR10:** System matches a submitted photo to the correct station using GPS location
- **FR11:** System uses logo recognition as a secondary signal to confirm station identity
- **FR12:** Driver receives immediate submission confirmation regardless of backend processing status
- **FR13:** Driver can submit a pump display photo to contribute a single fuel type price
- **FR14:** Driver can confirm or correct the system-suggested fuel type on a pump photo submission
- **FR15:** Driver can queue photo submissions locally for automatic retry when offline or connectivity is poor

### User Management

- **FR16:** Driver can create an account at first launch via social sign-in (Google, Apple) or email/password — account creation is required to use the app, framed as joining the community
- **FR17:** Driver can view their personal submission history
- **FR18:** Driver can delete their account and all associated personal data
- **FR19:** Driver can export their personal data
- **FR20:** Driver can manage their notification preferences
- **FR21:** Driver can withdraw consent for specific data uses independently of account deletion

### Notifications & Alerts *(Phase 2)*

- **FR22:** Driver can opt in to price drop alerts for nearby or saved stations
- **FR23:** Driver can opt in to sharp price rise alerts
- **FR24:** Driver receives a monthly savings summary notification
- **FR25:** System re-prompts drivers to enable notifications at high-value contextual moments (first photo submission, first savings summary generated)

### Personal Analytics *(Phase 2)*

- **FR26:** Driver can submit a pump meter photo to record a fill-up with volume and cost
- **FR27:** System calculates and displays driver savings vs. area average from pump meter data
- **FR28:** Driver can submit an odometer photo to enable fuel consumption tracking
- **FR29:** Driver can view their personal fuel consumption history (l/100km over time)
- **FR30:** Driver can view their personal fuel cost history and trends
- **FR31:** Driver can share their savings summary externally

### Community & Engagement *(Phase 2)*

- **FR32:** Driver can view a leaderboard of savings rankings segmented by geographic area
- **FR33:** Driver can see their personal rank relative to other drivers in their region

### Station Management *(Phase 2)*

- **FR34:** Station owner can claim and verify their station on the platform
- **FR35:** Station owner can self-update fuel prices for their station
- **FR36:** Station owner can view station performance metrics (views, interactions)

### Station Promoted Placement *(Phase 2)*

- **FR37:** Station owner can purchase a promoted placement for their station, giving it enhanced map visibility (larger pin, promoted badge) for a flat daily/weekly fee
- **FR38:** Promoted stations display with enhanced visual treatment (larger pin, badge) and priority ordering when nearby
- **FR39:** Driver can clearly identify promoted stations from organic results

### Station Deal Advertising *(Phase 2)*

- **FR68:** Station or chain manager can create a deal advertisement — structured text: headline + conditions max 120 chars + active dates
- **FR69:** Deal advertisements are reviewed and approved by ops before going live
- **FR70:** Active deal advertisements are displayed in the station detail sheet, additive to community-reported prices — never replacing them
- **FR71:** Deal advertisements are billed by active days, invoiced end-of-month

### Station Picker *(Phase 3)*

- **FR72:** Driver can request a station recommendation ("Pick for me") from the map
- **FR73:** App surfaces top 2 station recommendations ranked by a disclosed algorithm — price, distance, data freshness, and active deals as declared factors
- **FR74:** Active deal promotions that influenced a recommendation are transparently labelled on the recommendation card ("Has active offer")
- **FR75:** Driver can navigate to either recommended station directly from the picker result

### Data Integrity & Moderation

- **FR40:** Ops team can review flagged and low-confidence photo submissions in a review queue
- **FR41:** Ops team can view anomaly detection alerts for suspicious submission patterns
- **FR42:** Ops team can access anonymised submission audit trails by station
- **FR43:** System automatically shadow-bans users whose submissions match high-confidence abuse patterns without manual intervention (e.g. duplicate submissions from same GPS coordinates, prices outside market range, coordinated multi-account patterns from same device)
- **FR44:** System flags medium-confidence suspicious submissions for ops review; ops team can confirm or dismiss a shadow ban
- **FR45:** Ops team can manually apply or lift a shadow ban on any account
- **FR46:** Ops team can manually override or flag station prices as unverified
- **FR47:** Driver can report a price submission as incorrect
### Platform & Data

- **FR49:** System captures and retains full price history from all submissions from day one
- **FR50:** System provides regional fuel price aggregations by fuel type and geography
- **FR51:** Public users can view regional fuel price trends and consumption benchmarks via a web portal *(Phase 2)*
- **FR52:** External data buyers can access licensed anonymous datasets via API *(Phase 2)*

### Fleet Tier *(Phase 3)*

- **FR53:** Fleet manager can create a fleet account and add vehicles (by registration plate or vehicle name)
- **FR54:** Fleet manager can invite and assign drivers to vehicles
- **FR55:** Fleet dashboard displays per-vehicle fuel cost history, consumption (l/100km), and spend vs. regional average
- **FR56:** Fleet manager can generate and export fuel expense reports by vehicle, driver, or time period (CSV, PDF)
- **FR57:** Fleet manager can configure price alerts per vehicle or fleet-wide; alerts delivered via push and email
- **FR58:** System provides route-optimised refuelling suggestions — cheapest station within acceptable detour on a planned route *(Phase 3)*
- **FR59:** Fleet tier provides API access to price data and fleet analytics for integration with external systems *(Phase 3)*
- **FR60:** Fleet subscription managed via self-serve billing portal (upgrade, downgrade, cancel, invoice history)

### Analytics & Operational Monitoring *(Phase 1 — internal ops; Phase 2 — extended)*

- **FR61:** Internal admin dashboard displays real-time operational health: OCR pipeline success/failure rates, average processing time, queue depth, and error breakdown by failure type
- **FR62:** Admin dashboard shows API cost tracking: daily/monthly spend on OCR (Claude Haiku), Maps (Google Places, Mapbox/HERE), and push notifications — with trend and budget alerts
- **FR63:** Admin dashboard displays data freshness indicators per station — time since last verified price update, stations with stale data flagged
- **FR64:** Admin dashboard shows contribution funnel metrics: photos submitted → OCR attempted → OCR succeeded → station matched → price published, with drop-off rates at each stage
- **FR65:** Product analytics integration (e.g. PostHog or Mixpanel) captures key user events: app open, map view, station detail view, photo capture initiated, photo submitted, price alert triggered, contribution streak — for retention and funnel analysis *(Phase 2)*
- **FR66:** Admin dashboard shows user growth and engagement metrics: DAU/MAU, contribution rate, retention cohorts, top contributing users/regions *(Phase 2)*
- **FR67:** Alerting: ops team receives automated alerts when OCR failure rate exceeds threshold, processing queue exceeds latency SLA, or third-party API error rate spikes *(Phase 1)*

## Non-Functional Requirements

### Performance

- Map view and station prices load within **3 seconds** on a standard mobile connection — core user-facing interaction, speed is a competitive differentiator
- Photo submission confirmation displayed to the user within **2 seconds** of capture — async processing happens after; user never waits for it
- Backend processing pipeline (OCR, station matching, price update) completes within **5 minutes** under normal load — async, not user-facing, but fast enough that contributions are visible promptly
- App remains usable with cached data when backend is unavailable or user is offline — degraded mode, not hard failure

### Reliability

- Target uptime: **99.5%** at MVP, aspirational **99.9%** as infrastructure matures
- Graceful degradation: cached map and price data served when backend is unavailable — app does not hard-fail for users who are not actively submitting
- Photo submission queue persists locally and retries on reconnection — no data loss from transient outages
- Async processing failures are logged and retried automatically — no silent drops

### Security

- All data in transit encrypted via TLS 1.2+
- All personal data encrypted at rest
- Raw GPS coordinates used for station matching then discarded — not stored linked to user identity
- Social sign-in tokens handled via platform-standard OAuth flows (Google, Apple) — no credential storage on device
- Device fingerprinting used only for abuse detection — not for tracking or advertising purposes
- Shadow-banned users' data retained in audit trail but excluded from publication — no data deletion without explicit user request

### Scalability

- Architecture supports **100–200k MAU** at launch target; horizontally scalable to support order-of-magnitude growth beyond that without re-architecture. No hard ceiling built in.
- Backend designed to scale horizontally — photo processing pipeline, database, and API layer independently scalable
- Globally-capable from day one: multi-currency, per-market fuel taxonomies, localisation-ready — Polish market operated first, international expansion without re-architecture
- Traffic pattern: expect daily peaks during morning and evening commute hours; photo submissions burst during rush hour — autoscaling should handle 3–5x baseline during peak

### Compliance

- GDPR compliance from day one — Polish/EU jurisdiction, non-negotiable
- Layered consent model: core service consent at signup; feature-specific consent at first use; data licensing requires no individual consent if properly anonymised
- Right to erasure, data export, and consent withdrawal implemented in data model from launch — not retrofitted
- T&Cs and privacy policy legally reviewed before launch
- App Store and Google Play data safety declarations completed as pre-launch checklist items

### Integration Reliability

- Maps API (Google Places + Mapbox/HERE hybrid): cached tile and POI data reduces dependency on real-time API availability; graceful fallback if API unavailable
- OCR API (Google Cloud Vision / AWS Textract): submissions queued and retried if API unavailable — no data loss
- Push notifications (FCM): fire-and-forget; notification delivery failure is acceptable — no retry loop required
- All third-party integrations have defined fallback behaviour — no single integration failure causes full app failure
