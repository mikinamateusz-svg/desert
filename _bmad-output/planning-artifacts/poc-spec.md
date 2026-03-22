---
type: poc-spec
status: ready-to-execute
created: 2026-03-18
---

# PoC Specification — Core Technical Assumptions Validation

**Project:** desert
**Purpose:** Validate the two load-bearing technical assumptions before architecture is finalised. Both layers must be validated independently. Architecture commitment should follow, not precede, PoC results.

---

## Context

The entire desert platform is built on a photo → AI pipeline:
1. Driver photographs a price board or pump display
2. AI extracts the price(s) via OCR
3. System matches the photo to the correct station via GPS + logo recognition

If either GPS matching or OCR extraction is materially unreliable, the architecture needs to account for it. The PoC is designed to surface these failure modes cheaply — before weeks of architecture and development work are committed.

---

## Layer 1: OCR Price Extraction Accuracy

### Objective

Measure how accurately Google Cloud Vision (primary) and/or AWS Textract (secondary) can extract fuel prices from real-world Polish station price board photos under varied conditions.

### What "accurate" means

- Correct fuel type identified (LPG, Diesel, 95, 98, 99)
- Correct price extracted per fuel type (PLN per litre, e.g. 6.89)
- Price correctly associated with the right fuel type (not swapped)

### Test dataset

- **Target:** 50+ photos minimum, 100 preferred
- **Sources:**
  - Google Street View (search Polish station addresses — Orlen, BP, Shell, Lotos, Circle K, independent)
  - Google Images / public photo datasets
  - Personally photographed price boards (highest value — real-world conditions)
- **Required variation:**
  - Lighting: daylight, dusk, artificial light, rain
  - Angle: straight-on, slight angle, from car window
  - Distance: close-up, medium, from forecourt entrance
  - Station types: major chains (standardised boards) and independents (hand-written, varied formats)
  - Fuel type count: stations with 2 fuel types and stations with 4–5

### Tooling

```
Primary:   Google Cloud Vision API (TEXT_DETECTION or DOCUMENT_TEXT_DETECTION)
Secondary: AWS Textract (optional — run same dataset if time allows)
Language:  Python script (recommended) or Node.js
```

### Test script outline

```python
# For each image in dataset:
# 1. Send to Cloud Vision API
# 2. Capture raw text output
# 3. Apply basic parsing logic (regex for price patterns: X.XX PLN)
# 4. Attempt to match extracted prices to known fuel type labels
# 5. Record: extracted prices, fuel types identified, confidence, errors
# 6. Compare against ground truth (manually annotated expected output)
```

### Ground truth preparation

Before running the script, manually annotate each test image:
- Expected fuel types present
- Expected prices (read directly from the photo)
- Any known ambiguities (e.g. partially obscured price)

### What to measure

| Metric | Definition |
|---|---|
| Price extraction rate | % of images where at least one price was correctly extracted |
| Full extraction rate | % of images where ALL prices were correctly extracted |
| Fuel type association accuracy | % of prices correctly paired with their fuel type |
| Failure mode breakdown | Categorise failures: lighting, angle, format, OCR error, parsing error |

### Success criteria

| Metric | Pass threshold | Notes |
|---|---|---|
| Price extraction rate | ≥ 80% | At least one correct price per image |
| Full extraction rate | ≥ 60% | All prices correct — lower bar acceptable at MVP given community self-correction |
| Fuel type association | ≥ 85% | Mispairing is worse than missing |
| Failure mode pattern | No single failure mode > 30% of failures | Concentrated failure = fixable; distributed = structural problem |

**If full extraction rate is below 40%:** Architectural review required — may need pre-processing pipeline (image enhancement, perspective correction) before OCR.

---

## Layer 2: GPS-to-POI Station Matching Accuracy

### Objective

Measure how reliably a device's GPS coordinates, captured while at a fuel station forecourt, resolve to the correct station POI via Google Places API and/or HERE Maps API.

### What "correct match" means

- The top-ranked POI result for the given coordinates is the correct station
- The correct station appears in the top 3 results (acceptable fallback)
- Station name, brand, and address match the expected station

### Test dataset

- **Target:** 30–50 station locations minimum
- **Sources:**
  - Manually selected Polish fuel stations across different environments (see below)
  - GPS coordinates sourced from Google Maps (drop pin at forecourt centre) — this simulates where a driver would be when taking a photo
- **Required variation:**
  - Urban dense (Warsaw city centre — stations within 200m of each other)
  - Urban standard (mid-city, normal spacing)
  - Suburban (retail parks, main roads)
  - Rural (standalone stations, motorway services)
  - Motorway (Orlen/BP motorway stations — high traffic, critical use case)
  - Independent stations (smaller footprint, less prominent POI data)

### Tooling

```
Primary:   Google Places API (Nearby Search — type: gas_station, radius: 50m)
Secondary: HERE Maps Geocoding & Search API (optional — run same dataset)
Language:  Python script or Node.js
```

### Test script outline

```python
# For each test station:
# 1. Define ground truth: station name, brand, address
# 2. Define test coordinate: GPS point at forecourt centre (from Google Maps)
# 3. Query Places API: nearbySearch(lat, lng, radius=50, type='gas_station')
# 4. Record: top result, top 3 results, distance from test coordinate
# 5. Evaluate: does top result match ground truth? Does top 3?
# 6. Record match confidence, any ambiguities
```

### What to measure

| Metric | Definition |
|---|---|
| Top-1 match rate | % of stations where top result = correct station |
| Top-3 match rate | % of stations where correct station is in top 3 results |
| Failure mode breakdown | Categorise: wrong station, no results, multiple equidistant candidates |
| Environment breakdown | Match rates by urban dense / urban / suburban / rural / motorway |

### Success criteria

| Metric | Pass threshold | Notes |
|---|---|---|
| Top-1 match rate | ≥ 90% overall | Target from PRD |
| Top-1 match rate (urban dense) | ≥ 80% | Hardest case — acceptable lower bar |
| Top-3 match rate | ≥ 97% | If correct station is in top 3, disambiguation is possible |
| Failure mode pattern | No single failure mode > 20% of failures | |

**If top-1 match rate is below 75%:** Consider expanding radius dynamically, adding brand/logo signal earlier in the pipeline, or implementing a "confirm your station" prompt for low-confidence matches.

---

## Layer 3 (Optional): Logo Recognition Confidence Signal

This is explicitly a **nice-to-have** validation — logo recognition is a secondary signal in the architecture, not primary. Only run if time permits after Layers 1 and 2.

### Objective

Assess whether a pre-trained vision model (Google Cloud Vision label/logo detection, or a lightweight custom model) can correctly identify fuel station brand logos from forecourt photos with sufficient confidence to act as a confirmation signal.

### What to measure

- Brand identification accuracy from forecourt photos (not close-ups)
- Confidence score distribution — is there a usable threshold that separates correct from incorrect?
- Failure modes: lighting, angle, partial signage, unfamiliar brands

### Success criteria

This is pass/fail at the architecture level — if logo recognition confidence is consistently below 70%, exclude it from the MVP pipeline and rely on GPS-only matching.

---

## Recording Results

Create a simple results spreadsheet with:

**OCR Layer:**
- Image ID | Source | Conditions | Expected prices | Extracted prices | Fuel type match | Pass/Fail | Failure category

**GPS Layer:**
- Station ID | Name | Environment type | Test coordinates | Top-1 result | Top-1 match | Top-3 match | Failure category

---

## Go / No-Go Decision Framework

After both layers are complete, assess:

| Scenario | Decision |
|---|---|
| Both layers pass | Proceed to architecture — core assumptions validated |
| GPS passes, OCR partial (40–60% full extraction) | Proceed with enhanced pre-processing pipeline in architecture scope |
| GPS fails in urban dense only | Proceed — add disambiguation UI for low-confidence urban matches |
| GPS fails overall (<75% top-1) | Pause architecture — investigate alternative matching approach (e.g. geofence + user confirmation) |
| OCR fails overall (<40% full extraction) | Pause architecture — evaluate alternative OCR providers or manual fallback model |

---

## Estimated Effort

| Task | Effort |
|---|---|
| Collect and annotate 50 price board photos | 3–4 hours |
| Write OCR test script | 2–3 hours |
| Run OCR tests and analyse results | 2 hours |
| Collect 30–50 station GPS coordinates | 2 hours |
| Write GPS matching test script | 1–2 hours |
| Run GPS tests and analyse results | 1–2 hours |
| Document findings and go/no-go decision | 1 hour |
| **Total** | **~12–14 hours (1.5–2 days)** |

---

## Output

On completion, produce a short findings document covering:
1. OCR accuracy results with failure mode breakdown
2. GPS matching accuracy results with failure mode breakdown
3. Go/No-go recommendation per layer
4. Any architectural implications flagged for the architecture phase
