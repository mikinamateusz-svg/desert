# Top 50 Cars Driven in Poland — 2010–2026 window

**Compiled:** 2026-04-28
**Window:** 2010–2026 (covers cars sold new + used-imported throughout the period)
**Methodology:** Combined PZPM new-registrations + SAMAR used-import rankings + Polish auto press cross-year tracking. 28 distinct brands across 50 nameplates.

**Purpose:** Drives the hand-verification phase of Story 5.1's vehicle catalog. For each model + generation listed, we cross-check the auto-generated entry in `packages/types/src/vehicle-catalog-engines.batch1.json` against Wikipedia (DE preferred for VAG/German/Czech brands, EN otherwise) and correct engines, year ranges, transmission options, and add `_meta.notes` documenting the source.

**Status legend:**
- ⬜ — not yet verified
- 🟡 — Wikipedia fetched, awaiting corrections
- ✅ — verified and corrected in catalog
- ⏭️ — generation skipped (out of window or non-PL market)

## The list

| # | Make | Model | Generations within 2010-2026 | Why included | Status |
|---|------|-------|------------------------------|--------------|--------|
| 1 | Skoda | Octavia | II facelift (2008-2013), **III (2013-2020), IV (2020-)** | #1 new-car best-seller in Poland 2009-2018 (10 consecutive years); still #2 in 2024 | II ✅ · III ✅ · IV ✅ |
| 2 | Toyota | Corolla | E150 (2007-2013), E170 (2013-2019), E210 (2019-) | #1 new-car best-seller 2021-2024 (4 consecutive years); 29,488 units in 2024 | E150 🟡 · E170 ✅ · E210 ✅ |
| 3 | Volkswagen | Golf | VI (2008-2012), VII (2012-2020), VIII (2020-) | #2 used-import 2024 (23,553 units); top-5 new sales 2015-2018; backbone of German used inflow | VI ✅ · VII ✅ · VIII ✅ |
| 4 | Opel | Astra | H (2004-2014), J (2009-2015), K (2015-2021), L (2021-) | #1 used-import 2024 (24,293 units); top-5 new sales 2010-2018 | H ✅ · J ✅ · K ✅ · L ✅ |
| 5 | Skoda | Fabia | II (2007-2014), III (2014-2021), IV (2021-) | #2 in PL 2010-2017, #1 in 2013, top-15 since | II ⬜ · III ⬜ · IV ⬜ |
| 6 | Audi | A4 | B8 (2007-2015), B9 (2015-) | #3 used-import 2024 (21,292 units); flagship used-import for years | B8 ⬜ · B9 ⬜ |
| 7 | Toyota | Yaris | XP130 (2011-2020), XP210 (2020-) | Top-5 new sales 2015-2024; 14,185 units in 2024 | XP130 ⬜ · XP210 ⬜ |
| 8 | Ford | Focus | Mk2 facelift (2008-2011), Mk3 (2011-2018), Mk4 (2018-) | #5 used-import 2024 (16,501 units); strong new sales 2010-2019 | Mk2fl ⬜ · Mk3 ⬜ · Mk4 ⬜ |
| 9 | BMW | 3 Series | E90/E91/E92 (2005-2013), F30/F31 (2012-2019), G20/G21 (2019-) | #4 used-import 2024 (17,956 units); flagship German used import | E90 ⬜ · F30 ⬜ · G20 ⬜ |
| 10 | Toyota | Yaris Cross | XP210 (2020-) | #3 new sales 2024 (15,608 units); rapid Polish bestseller | XP210 ⬜ |
| 11 | Hyundai | Tucson | TL (2015-2020), NX4 (2020-) | #7 new sales 2024 (13,179); top-10 since 2018 | TL ⬜ · NX4 ⬜ |
| 12 | Kia | Sportage | III SL (2010-2015), IV QL (2015-2021), V NQ5 (2021-) | #6 new 2024 (14,133); top-10 sustained 2017-2024 | SL ⬜ · QL ⬜ · NQ5 ⬜ |
| 13 | Volkswagen | Passat | B6 (2005-2010), B7 (2010-2014), B8 (2014-2023), B9 (2023-) | #7 used-import 2024 (13,840); massive used stock from Germany | B6 ⬜ · B7 ⬜ · B8 ⬜ · B9 ⬜ |
| 14 | Toyota | C-HR | Mk1 (2016-2023), Mk2 (2023-) | #4 new sales 2024 (14,516, +34% YoY) | Mk1 ⬜ · Mk2 ⬜ |
| 15 | Renault | Clio | III facelift (2009-2012), IV (2012-2019), V (2019-) | #10 new 2024 (10,885); sustained presence | IIIfl ⬜ · IV ⬜ · V ⬜ |
| 16 | Dacia | Duster | I (2010-2018), II (2018-2024), III (2024-) | #4 new sales 2019-2022; #1 in private buyers 2019; top SUV in PL | I ⬜ · II ⬜ · III ⬜ |
| 17 | Audi | A3 | 8P facelift (2008-2013), 8V (2012-2020), 8Y (2020-) | #6 used-import 2024 (14,588); huge Polish premium-used stock | 8Pfl ⬜ · 8V ⬜ · 8Y ⬜ |
| 18 | Toyota | RAV4 | XA40 (2012-2018), XA50 (2018-) | #9 new sales 2024 (11,262); +23% YoY 2024 | XA40 ⬜ · XA50 ⬜ |
| 19 | Renault | Megane | III (2008-2016), IV (2016-2022), E-Tech (2022-) | #18 used-import 2024; top-15 new sales 2010-2017 | III ⬜ · IV ⬜ · ET ⬜ |
| 20 | Ford | Fiesta | Mk6 (2008-2017), Mk7 (2017-2023) | #9 used-import 2024 (12,767); high stock pre-discontinuation | Mk6 ⬜ · Mk7 ⬜ |
| 21 | Hyundai | i30 | FD facelift (2010-2012), GD (2012-2017), PD (2017-2024), CN7 (2024-) | #3 new 2022 (9,142); top-15 sustained | FDfl ⬜ · GD ⬜ · PD ⬜ · CN7 ⬜ |
| 22 | Mercedes-Benz | C-Class | W204 (2007-2014), W205 (2014-2021), W206 (2021-) | Mercedes is top used-import brand (42,607); C-Class is volume model | W204 ⬜ · W205 ⬜ · W206 ⬜ |
| 23 | Volkswagen | Tiguan | I (2007-2016), II (2016-2024), III (2024-) | #18 new sales 2022; consistent top-25 new + used | I ⬜ · II ⬜ · III ⬜ |
| 24 | Volkswagen | T-Roc | Mk1 (2017-) | #10 new sales 2024 (7,048); #11 in 2022 | Mk1 ⬜ |
| 25 | Nissan | Qashqai | J10 facelift (2010-2013), J11 (2013-2021), J12 (2021-) | #8 used-import 2024 (13,314); top-15 new since 2010 | J10fl ⬜ · J11 ⬜ · J12 ⬜ |
| 26 | Kia | Ceed | JD (2012-2018), CD (2018-) | #13 new 2022 (7,177); sustained top-20 | JD ⬜ · CD ⬜ |
| 27 | Audi | A6 | C7 (2011-2018), C8 (2018-) | #12 used-import 2024 (11,493); flagship D-segment used | C7 ⬜ · C8 ⬜ |
| 28 | Opel | Corsa | D (2006-2014), E (2014-2019), F (2019-) | #10 used-import 2024 (12,594); strong new in 2010-2014 | D ⬜ · E ⬜ · F ⬜ |
| 29 | Ford | Kuga | Mk2 (2012-2019), Mk3 (2019-) | #11 used-import 2024 (11,852) | Mk2 ⬜ · Mk3 ⬜ |
| 30 | BMW | 5 Series | F10/F11 (2010-2017), G30/G31 (2017-2023), G60 (2023-) | #13 used-import 2024 (11,342) | F10 ⬜ · G30 ⬜ · G60 ⬜ |
| 31 | Skoda | Superb | II facelift (2013-2015), III (2015-) | #16 new 2022 (5,403); volume D-segment | IIfl ⬜ · III ⬜ |
| 32 | Skoda | Kamiq | Mk1 (2019-) | #15 new 2022 (5,675); fast-growing B-SUV | Mk1 ⬜ |
| 33 | Skoda | Kodiaq | Mk1 (2016-2024), Mk2 (2024-) | #20 new 2022 (4,365); volume large-SUV | Mk1 ⬜ · Mk2 ⬜ |
| 34 | Volvo | XC60 | Mk1 facelift (2008-2017), Mk2 (2017-) | #17 new 2022; #1 premium model 2024 | Mk1fl ⬜ · Mk2 ⬜ |
| 35 | Dacia | Sandero | II (2012-2020), III (2020-) | #14 new 2022 (6,049); private-buyer favourite | II ⬜ · III ⬜ |
| 36 | Toyota | Auris | E150 facelift (2010-2012), E180 (2012-2018) | Top-10 new 2015-2018; pre-Corolla volume | E150fl ⬜ · E180 ⬜ |
| 37 | Volkswagen | Polo | V facelift (2014-2017), VI (2017-) | Top-20 new sales 2010-2018; high used-import stock | Vfl ⬜ · VI ⬜ |
| 38 | Renault | Captur | I (2013-2019), II (2019-) | #8 new sales 2024 (12,520); strong B-SUV | I ⬜ · II ⬜ |
| 39 | Peugeot | 308 | T7 (2007-2013), T9 (2013-2021), P51 (2021-) | Peugeot is #7 used-import brand (40,569); 308 is volume | T7 ⬜ · T9 ⬜ · P51 ⬜ |
| 40 | Opel | Insignia | A (2008-2017), B (2017-2022) | #19 used-import 2024; top D-segment used | A ⬜ · B ⬜ |
| 41 | Ford | Mondeo | Mk4 facelift (2010-2014), Mk5 (2014-2022) | Sustained D-segment used-import volume | Mk4fl ⬜ · Mk5 ⬜ |
| 42 | Seat | Ibiza | IV (2008-2017), V (2017-) | #20 used-import 2024 (3,349) | IV ⬜ · V ⬜ |
| 43 | Renault | Scenic | III (2009-2016), IV (2016-2022), E-Tech (2024-) | #17 used-import 2024; historical MPV staple | III ⬜ · IV ⬜ · ET ⬜ |
| 44 | Mercedes-Benz | E-Class | W212 (2009-2016), W213 (2016-2023), W214 (2023-) | Mercedes top-6 used-import brand; E-Class is core executive used | W212 ⬜ · W213 ⬜ · W214 ⬜ |
| 45 | BMW | X3 | F25 (2010-2017), G01 (2017-2024), G45 (2024-) | Premium SUV staple; high used + new | F25 ⬜ · G01 ⬜ · G45 ⬜ |
| 46 | Audi | Q5 | 8R (2008-2017), FY (2017-) | #4 premium new 2024 (3,821); top used premium SUV | 8R ⬜ · FY ⬜ |
| 47 | Audi | Q3 | 8U (2011-2018), F3 (2018-) | #5 premium new 2024 (3,704) | 8U ⬜ · F3 ⬜ |
| 48 | Fiat | 500 | (2007-2024 incl. facelifts) | Sustained Polish small-car presence; produced in PL (Tychy) | (2007-24) ⬜ |
| 49 | Tesla | Model 3 | Mk1 (2017-) | Best-selling EV in PL 2021-2024; meaningful market share | Mk1 ⬜ |
| 50 | Cupra | Formentor | Mk1 (2020-) | Notable 2023 ranking riser per BSCB; volume Cupra model | Mk1 ⬜ |

## Sources

- [Best Selling Cars Blog – Poland](https://bestsellingcarsblog.com/market/poland/)
- [focus2move – Poland 2024](https://www.focus2move.com/poland-best-selling-car-2024/)
- [auto-swiat.pl – sprzedaż 2024](https://www.auto-swiat.pl/wiadomosci/aktualnosci/sprzedaz-samochodow-w-polsce-w-2024-r-marki-i-modele-jeden-producent-wzial-wszystko/b315r9z)
- [Auto Katalog – Top 20 modeli 2022](https://autokatalog.pl/blog/2023/ranking-najpopularniejszych-modeli-top-20-polska-rok-2022)
- [auto-swiat.pl – import używanych 2024](https://www.auto-swiat.pl/wiadomosci/import-uzywanych-aut-w-2024-r-osiagnal-w-polsce-oslupiajacy-poziom/5xl940n)
- [Magazyn Auto – import Q3 2024](https://magazynauto.pl/uzywane/import-aut-uzywanych-do-polski-po-trzech-kwartalach-2024-r-najpopularniejsze-modele-marki-i-kraje-pochodzenia,aid,4662)
- [PZPM Rejestracje 2024](https://www.pzpm.org.pl/pl/Rynek-motoryzacyjny/Rejestracje-Pojazdow/OSOBOWE-i-DOSTAWCZE/Rok-2024/Grudzien-2024r)
- [SAMAR via ISBiznes](https://isbiznes.pl/2025/01/08/samar-import-aut-uzywanych-wzrosl-o-201-r-r-do-9676-tys-sztuk-w-2024-r/)
- [Wybor Kierowcow – 50 najpopularniejszych 2024](https://www.wyborkierowcow.pl/najpopularniejsze-auta-w-polsce-2024/)

## Notes / known caveats

- Inferred placements (rank approximate, presence in top-50 confident): Mercedes C-Class (22), Mercedes E-Class (44), BMW X3 (45), Audi A6 (27), Audi Q5 (46), Audi Q3 (47), Peugeot 308 (39).
- Cupra Formentor (50) included over Mazda CX-5 / Suzuki Vitara — Formentor's 2023 ranking riser status + present volume tipped it.
- Fiat 500 (48) included on production-continuity + Polish road presence rather than recent ranking.
- Tesla Model 3 (49) included as the only EV that meets sustained PL volume.
- Excluded: commercial/fleet-skewed (Master, Daily, Ducato, Transit), taxi-skewed (Lodgy), bench (CX-5, Vitara, Kona, Picanto, Civic, ASX).

## Verification workflow

For each row in the table:

1. **Identify catalog entries.** Find the umbrella + per-generation entries in `vehicle-catalog-engines.batch1.json` that cover this model. Some generations may not have separate entries — that's fine, they live inside the umbrella's engine list.
2. **Fetch Wikipedia.** Prefer DE for VW Group / Mercedes / BMW / Audi / Fiat / Skoda / Seat. EN for Toyota / Honda / Hyundai / Kia / Tesla / Cupra. Use the specific generation page where possible (e.g. `Volkswagen_Golf_VII`).
3. **Extract engine table.** Pull every variant: name, displacement_cc, power_kw, power_hp, fuel_type, transmissions, year ranges, notes (RS-only, PHEV, etc.).
4. **Compare against catalog.** Identify: power errors, year errors, missing variants, extra variants that shouldn't be there.
5. **Apply corrections.** Edit `vehicle-catalog-engines.batch1.json`. Add `_meta.notes` with the source URL + key dates.
6. **Tick the status.** Update this file with ✅ for the verified generation.
7. **Commit.** Story-tagged commit per model (or per batch of 3-5 small ones).

## Reference: completed verifications

- ✅ **Škoda Octavia IV** — verified 2026-04-28 against [de.wikipedia.org/wiki/Škoda_Octavia_IV](https://de.wikipedia.org/wiki/%C5%A0koda_Octavia_IV). Commit `fbcb2b6`. 11 → 13 engines, 5 power/year corrections, 2 missing engines added (2.0 TSI 190 KM 4x4, 2.0 TSI RS 265 KM post-facelift).
- ✅ **VW Golf Mk6/Mk7/Mk8** — verified 2026-04-28 against DE Wikipedia (Golf 6/7/8 articles). 112 → 122 engines. Mk6: added 1.6 TDI BlueMotion 110 KM + LPG variant; flagged 2.0 TDI 110 KM (Mk6) medium (81 kW not confirmed at 2.0 TDI for Mk6). Mk7: added 1.2 TSI 110 KM FL, 1.4 TGI CNG, 1.5 TGI 110 CNG pre-FL; flagged 1.4 TSI 125 KM medium. Mk8: added 1.0 TSI 90 KM, 1.2 TSI 115 KM, 1.4 TSI 150 KM, 2.0 TSI 190 KM, GTI 265 KM FL (2024+); GTI 245 KM year_to set to 2024.
- ✅ **Toyota Corolla E170** — verified 2026-04-28 against DE + EN Wikipedia. 5 engines: 1.33 VVT-i (2013–16), 1.6 Valvematic (2013–19), 1.6 Dual VVT-i 124 KM (2013–19, medium), 1.8 Dual VVT-i 140 KM (2013–19, medium), 1.4 D-4D (2013–16). 1.6/1.8 non-Valvematic added from EN Wikipedia.
- ✅ **Toyota Corolla E210** — verified 2026-04-28 against DE + EN Wikipedia. 4 engines. Facelift corrected to 2023 (not 2022). 2.0 HEV year_from set to 2023 (post-facelift confirmed). 1.2T to 2020.
- 🟡 **Toyota Corolla E150** — cross-checked DE + EN + JA Wikipedia, 2026-04-28. DE has no table; EN/JA confirm engine codes but no power figures. Removed 1.8 VVT-i and 2.2 D-4D (Avensis/US engines, not EU Corolla). 5 engines remain, all medium confidence. Needs Toyota EU brochure to promote to ✅.
- ✅ **Škoda Octavia II** — verified 2026-04-28 against [de.wikipedia.org/wiki/Škoda_Octavia_II](https://de.wikipedia.org/wiki/%C5%A0koda_Octavia_II). Full gen 2004–2013 incl. FL from 2008. 13 → 18 engines. Corrections: 1.4 75 KM year_to fixed; LPG power 102→98 KM. Added: 1.4 80 KM, 1.8 TSI 152 KM, 2.0 TDI 136 KM, 2.0 TDI 110 KM CR, 1.6 CNG.
- ✅ **Škoda Octavia III** — verified 2026-04-28 against [de.wikipedia.org/wiki/Škoda_Octavia_III](https://de.wikipedia.org/wiki/%C5%A0koda_Octavia_III). Pre-facelift 2012–2016, FL 2016–2020. 18 → 22 engines. Corrections: 1.4 TSI G-TEC 110→105 KM (manual only, year_to 2015); 1.8 TSI year_to 2017→2018. Added: 1.4 TSI 110 KM (2015–16), 1.8 TSI 4×4, 2.0 TSI 190 KM, 2.0 TSI 4×4 220 KM, 2.0 TDI 184 KM std. Note: 1.2 TSI 105/110 KM and 1.4 TSI 140/150 ACT unconfirmed by Wikipedia — retained pending second source.
