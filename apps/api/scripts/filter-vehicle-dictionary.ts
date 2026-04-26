/**
 * filter-vehicle-dictionary — Story 5.1 chunk B.5 (extended).
 *
 * Cleans the raw Wikidata vehicle catalog produced by chunk B by:
 *   a) Dropping models whose name does not start with the make key
 *      (filters cross-pollution from corporate parents — e.g. Lexus rolled
 *      into Toyota, Lancia/Maserati rolled into Fiat).
 *   b) Dropping pre-1980 discontinued models (year_to !== null && year_to < 1980).
 *   c) Dropping racing/concept variants by name pattern (standalone tokens
 *      to avoid clipping legit road cars like "Audi RS5").
 *   d) De-duping noisy duplicates by normalized name, preferring entries
 *      with a non-null year_from.
 *   e) Dropping orphan umbrella entries — `year_from === null && year_to === null
 *      && (generations === undefined || generations.length === 0)`. These are
 *      Wikidata umbrella records with no year metadata AND no children to
 *      backfill from; they're typically obscure pre-WW2 variants where
 *      Wikidata didn't bother (e.g. "Fiat 1100", "Fiat 10 HP", "Skoda 1000 MB
 *      Combi"). Real umbrellas like "Volkswagen Golf" survive because they
 *      have generation children which then feed step (f).
 *      Applied AFTER the year-cutoff so we don't double-penalise pre-1980
 *      entries that already have year_to set; this rule targets the missing-
 *      metadata gap, not the historical cutoff.
 *
 * Then:
 *   f) Backfills umbrella years from their generation children via Wikidata
 *      SPARQL — for each umbrella where year_from/year_to are null but
 *      generations.length > 0, query Wikidata once for all generations of
 *      that umbrella's QID using `wd:<umbrellaQid> wdt:P527 ?gen` and
 *      aggregate: year_from = min(non-null), year_to = max(non-null) UNLESS
 *      any generation has year_to === null (in which case umbrella stays
 *      "still in production").
 *   g) Merges hand-curated supplement files (vehicle-catalog-*-supplement.json
 *      from the types dir). Each supplement REPLACES the corresponding brand
 *      entry wholesale (supplements are authoritative for their brand).
 *
 * Inputs:
 *   packages/types/src/vehicle-catalog-makes-models.json     (raw, from chunk B)
 *   packages/types/src/vehicle-catalog-*-supplement.json     (manual, all files matching)
 *
 * Output:
 *   packages/types/src/vehicle-catalog-makes-models.cleaned.json
 *
 * Usage:
 *   pnpm --filter @desert/api filter-vehicle-dict
 *
 * Network: hits Wikidata SPARQL (~500-800 umbrella queries, ~250ms gap each
 * = 2-4 min). Set SKIP_BACKFILL=1 in env to skip the network step (useful for
 * dry-run / test iteration on the rule pipeline only).
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, basename } from 'node:path';

// ---------- Paths -----------------------------------------------------------

const TYPES_DIR = resolve(__dirname, '..', '..', '..', 'packages', 'types', 'src');
const INPUT_PATH = resolve(TYPES_DIR, 'vehicle-catalog-makes-models.json');
const OUTPUT_PATH = resolve(TYPES_DIR, 'vehicle-catalog-makes-models.cleaned.json');
const SUPPLEMENT_GLOB = /^vehicle-catalog-.*-supplement\.json$/;

// ---------- Filter config ---------------------------------------------------

const YEAR_CUTOFF = 1980;

// Per-make name prefix overrides. Default for any unlisted make is [makeKey].
const ACCEPTED_PREFIXES: Record<string, string[]> = {
  'Mercedes-Benz': ['Mercedes-Benz', 'Mercedes'],
  Skoda: ['Škoda', 'Skoda'],
  Citroen: ['Citroën', 'Citroen'],
  // Alfa Romeo, Land Rover, etc. all use the default [makeKey] which already works.
};

// Racing / concept / coachbuilder / one-off heuristics. We match standalone
// tokens (with word boundaries) so legit road cars like "Audi RS5" survive.
const NOISE_PATTERNS: RegExp[] = [
  /\bRS\b(?!\d)/i,             // " RS " standalone — keep RS5, RS6, etc.
  /\bR5\b/i,                    // Renault 5 Turbo / WRC stuff named R5
  /\bRally\b/i,
  /\bGroup\s+[AB]\b/i,
  /\bConcept\b/i,
  /\bPrototype\b/i,
  /\bVision\b/i,
  /Coup[ée]\s+Vignale/i,
  /\bSP\b(?!\d)/i,              // " SP " standalone
  /\bCR\b(?!\d)/i,              // " CR " standalone
  /\bWRC\b/i,
  /\bGT2\b(?!\d)/i,             // standalone GT2 — keep "GT2 RS" though? It's a real Porsche road car.
  /\bGT3\b(?!\d)/i,
  /\bType\s+312\b/i,
  /\bTipo\s+312\b/i,
  /\bRace\b/i,
  /\bRacing\b/i,
];

// ---------- Wikidata SPARQL config ------------------------------------------

const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';
const USER_AGENT =
  'desert-app/0.1 (https://desert.app; mikinamateusz@gmail.com) filter-vehicle-dictionary';
const QUERY_GAP_MS = 250;
const SKIP_BACKFILL = process.env.SKIP_BACKFILL === '1';

// ---------- Types -----------------------------------------------------------

interface ModelEntry {
  name: string;
  wikidata_id?: string;
  year_from: number | null;
  year_to: number | null;
  generations?: string[];
}

interface MakeEntry {
  models: ModelEntry[];
}

interface Catalog {
  $schema_version: number;
  generated_at?: string;
  source: string;
  license: string;
  makes: Record<string, MakeEntry>;
  stats?: {
    make_count: number;
    model_count: number;
    year_min?: number | null;
    year_max?: number | null;
  };
}

interface Supplement {
  $schema_version: number;
  source: string;
  license: string;
  makes: Record<string, MakeEntry>;
}

interface SparqlBinding {
  gen?: { value: string };
  genLabel?: { value: string };
  inception?: { value: string };
  dissolved?: { value: string };
  startTime?: { value: string };
  endTime?: { value: string };
  // Some Wikidata car entries (esp. generation children) use these instead
  // of inception/dissolved or start/end times. Discovered while debugging
  // the loosened-query backfill — Renault Clio I has neither P571 nor P580
  // but does have P5204 (commercialization date) + P2669 (discontinuation).
  commercialized?: { value: string };
  discontinued?: { value: string };
}

interface SparqlResponse {
  results: { bindings: SparqlBinding[] };
}

// Generation-label blacklist: substrings (lowercase) that disqualify a row
// returned by the loosened P527 query. We dropped the strict P31/P279*
// wd:Q3231690 filter to capture more generations (model series, vehicle
// generation, plain "vehicle"), which lets through more legitimate cars but
// also part-of records like "front bumper of Volkswagen Golf".
const GEN_LABEL_NOISE: string[] = [
  'engine',
  'gearbox',
  'transmission',
  'frunk',
  'trunk',
  'bumper',
  'wheel',
  'tyre',
  'tire',
  'suspension',
  'chassis',
  'platform',
  'concept',
  'prototype',
  'racing',
  'rally',
  'race car',
  'wrc',
  'study',
  'showcar',
  'show car',
  'logo',
  'badge',
  'emblem',
  'dashboard',
  'interior',
  'headlamp',
  'headlight',
  'taillight',
  'taillamp',
];

function isNoiseGenerationLabel(label: string | undefined): boolean {
  if (!label) return false;
  const lower = label.toLowerCase();
  for (const word of GEN_LABEL_NOISE) {
    if (lower.includes(word)) return true;
  }
  return false;
}

// ---------- Helpers ---------------------------------------------------------

function normalizeForPrefix(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function normalizeForDedupe(s: string): string {
  return normalizeForPrefix(s).replace(/\s+/g, ' ');
}

function getAcceptedPrefixes(makeKey: string): string[] {
  return ACCEPTED_PREFIXES[makeKey] ?? [makeKey];
}

function startsWithAcceptedPrefix(name: string, makeKey: string): boolean {
  const nName = normalizeForPrefix(name);
  for (const prefix of getAcceptedPrefixes(makeKey)) {
    const nPrefix = normalizeForPrefix(prefix);
    if (nName === nPrefix) return true;
    if (nName.startsWith(nPrefix)) {
      const next = nName.charAt(nPrefix.length);
      if (next === ' ' || next === '-' || next === '' || /\d/.test(next)) return true;
    }
  }
  return false;
}

function isNoise(name: string): boolean {
  for (const re of NOISE_PATTERNS) {
    if (re.test(name)) return true;
  }
  return false;
}

function isPreCutoff(model: ModelEntry): boolean {
  return model.year_to !== null && model.year_to < YEAR_CUTOFF;
}

function isOrphanUmbrella(model: ModelEntry): boolean {
  // Null years AND no generation children to backfill from — drop.
  return (
    model.year_from === null &&
    model.year_to === null &&
    (model.generations === undefined || model.generations.length === 0)
  );
}

function dedupe(models: ModelEntry[]): ModelEntry[] {
  const byKey = new Map<string, ModelEntry>();
  for (const m of models) {
    const key = normalizeForDedupe(m.name);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, m);
      continue;
    }
    if (existing.year_from === null && m.year_from !== null) {
      byKey.set(key, m);
    }
  }
  return [...byKey.values()];
}

// ---------- Filter pipeline -------------------------------------------------

interface FilterStats {
  before: number;
  afterPrefix: number;
  afterYearCutoff: number;
  afterOrphan: number;
  afterNoise: number;
  afterDedupe: number;
}

function filterMake(makeKey: string, models: ModelEntry[]): { models: ModelEntry[]; stats: FilterStats } {
  const before = models.length;

  // a) Brand prefix match.
  const afterPrefix = models.filter((m) => startsWithAcceptedPrefix(m.name, makeKey));

  // b) Year cutoff (drops anything explicitly discontinued before YEAR_CUTOFF).
  const afterYears = afterPrefix.filter((m) => !isPreCutoff(m));

  // e) Orphan umbrella drop — DISABLED. The chunk B SPARQL didn't fetch
  //    generation children for many "real" Wikidata model entries (Toyota
  //    Corolla, BMW 3 Series, Hyundai i30 etc.), so this rule mistakenly
  //    treated them as orphans and gutted core brands (Toyota 261 → 14).
  //    Pre-WW2 noise (Fiat 1100 etc.) is left in the catalog; chunk C's
  //    Claude pass naturally returns [] for impossible engine variants on
  //    those, so they self-prune at the engine stage. Revisit if/when a
  //    wider chunk B query fetches generations comprehensively.
  // const afterOrphan = afterYears.filter((m) => !isOrphanUmbrella(m));
  const afterOrphan = afterYears;

  // c) Drop noise (racing / concept / one-offs).
  const afterNoise = afterOrphan.filter((m) => !isNoise(m.name));

  // d) De-dupe.
  const afterDedupe = dedupe(afterNoise);

  // Stable order: by name.
  afterDedupe.sort((a, b) => a.name.localeCompare(b.name));

  return {
    models: afterDedupe,
    stats: {
      before,
      afterPrefix: afterPrefix.length,
      afterYearCutoff: afterYears.length,
      afterOrphan: afterOrphan.length,
      afterNoise: afterNoise.length,
      afterDedupe: afterDedupe.length,
    },
  };
}

// ---------- Wikidata umbrella year backfill ---------------------------------

function buildGenerationsQuery(umbrellaQid: string): string {
  // Fetch start/end years for every generation child of the umbrella.
  // Wikidata stores these inconsistently across model vs. model-series records:
  //   - P571 (inception) / P576 (dissolved) — used on umbrella series
  //   - P580 (start time) / P582 (end time) — used on individual model entries
  //   - P5204 (commercialization date) / P2669 (discontinuation date) — used
  //     by some generation records (e.g. Renault Clio I = Q3425018)
  //
  // We deliberately DO NOT constrain ?gen to wd:Q3231690 (automobile model)
  // or its subclasses any more — too many real generations are typed as
  // "automobile model series", "vehicle generation", "motor vehicle model",
  // or just "vehicle", and a strict filter silently drops them. Instead we
  // pull every P527 child along with its English label, then filter out
  // obvious noise (parts, concepts, racing variants) by label substring in
  // JS. See GEN_LABEL_NOISE / isNoiseGenerationLabel.
  return `SELECT ?gen ?genLabel ?inception ?dissolved ?startTime ?endTime ?commercialized ?discontinued WHERE {
  wd:${umbrellaQid} wdt:P527 ?gen .
  OPTIONAL { ?gen rdfs:label ?genLabel . FILTER(LANG(?genLabel) = "en") }
  OPTIONAL { ?gen wdt:P571 ?inception . }
  OPTIONAL { ?gen wdt:P576 ?dissolved . }
  OPTIONAL { ?gen wdt:P580 ?startTime . }
  OPTIONAL { ?gen wdt:P582 ?endTime . }
  OPTIONAL { ?gen wdt:P5204 ?commercialized . }
  OPTIONAL { ?gen wdt:P2669 ?discontinued . }
}`;
}

// Query for the umbrella record's OWN year metadata (no P527 traversal).
// Used as a third resolution path for umbrellas where children have no
// year data — frequently the umbrella itself carries P571/P582 even when
// its individual generation records don't (e.g. Toyota Aygo Q825358 has
// P582 = 2022 directly on the umbrella).
function buildUmbrellaSelfQuery(umbrellaQid: string): string {
  return `SELECT ?inception ?dissolved ?startTime ?endTime ?commercialized ?discontinued WHERE {
  OPTIONAL { wd:${umbrellaQid} wdt:P571 ?inception . }
  OPTIONAL { wd:${umbrellaQid} wdt:P576 ?dissolved . }
  OPTIONAL { wd:${umbrellaQid} wdt:P580 ?startTime . }
  OPTIONAL { wd:${umbrellaQid} wdt:P582 ?endTime . }
  OPTIONAL { wd:${umbrellaQid} wdt:P5204 ?commercialized . }
  OPTIONAL { wd:${umbrellaQid} wdt:P2669 ?discontinued . }
}`;
}

// Label-search fallback. For an umbrella whose P527 query returned nothing,
// we walk the catalog's hand-curated `generations[]` label strings and try
// to resolve each label to a QID via rdfs:label. We KEEP the strict
// Q3231690 instance-of filter here because label collisions are common and
// the gain of capturing "vehicle generation"-typed entries does not
// outweigh the risk of matching unrelated records ("Volkswagen Golf"
// matches the human, the band, etc.).
function buildLabelSearchQuery(label: string): string {
  // Escape backslashes and double quotes — labels containing either will
  // otherwise produce malformed SPARQL.
  const escaped = label.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `SELECT ?gen ?inception ?dissolved ?startTime ?endTime ?commercialized ?discontinued WHERE {
  ?gen rdfs:label "${escaped}"@en .
  ?gen wdt:P31/wdt:P279* wd:Q3231690 .
  OPTIONAL { ?gen wdt:P571 ?inception . }
  OPTIONAL { ?gen wdt:P576 ?dissolved . }
  OPTIONAL { ?gen wdt:P580 ?startTime . }
  OPTIONAL { ?gen wdt:P582 ?endTime . }
  OPTIONAL { ?gen wdt:P5204 ?commercialized . }
  OPTIONAL { ?gen wdt:P2669 ?discontinued . }
}
LIMIT 10`;
}

function extractYear(dateStr: string | undefined): number | null {
  if (!dateStr) return null;
  const match = dateStr.match(/^(-?)(\d{4})/);
  if (!match) return null;
  const year = parseInt(match[2]!, 10);
  if (Number.isNaN(year)) return null;
  if (year < 1885 || year > 2100) return null;
  return year;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function fetchSparql(query: string, label: string): Promise<SparqlResponse> {
  const url = `${SPARQL_ENDPOINT}?format=json&query=${encodeURIComponent(query)}`;
  const maxAttempts = 3;
  let lastErr = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let resp: Response;
    try {
      resp = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/sparql-results+json',
        },
      });
    } catch (err) {
      // Transport-level error (DNS, socket reset, etc.) — retry with backoff.
      lastErr = `network: ${err instanceof Error ? err.message : String(err)}`;
      if (attempt === maxAttempts) {
        throw new Error(`[${label}] ${lastErr}`);
      }
      await sleep(1000 * attempt);
      continue;
    }
    if (resp.ok) {
      return (await resp.json()) as SparqlResponse;
    }
    const text = await resp.text();
    lastErr = `${resp.status} ${resp.statusText}: ${text.slice(0, 200)}`;
    if (![429, 502, 503, 504].includes(resp.status) || attempt === maxAttempts) {
      throw new Error(`[${label}] Wikidata returned ${lastErr}`);
    }
    await sleep(1000 * attempt);
  }
  throw new Error(`[${label}] exhausted retries: ${lastErr}`);
}

interface BackfillStats {
  candidates: number;
  filledViaPrimary: number;
  filledViaUmbrellaSelf: number;
  filledViaFallback: number;
  filledFrom: number;
  filledTo: number;
  stillNull: number;
  noResults: number;
  errors: number;
  // Sampled rows from the loosened primary query for spot-checking.
  // Stored once for a single umbrella label match (first one seen) to
  // make it easy to verify the loosened query isn't returning garbage.
  sampleUmbrella?: string;
  sampleGenLabels?: string[];
}

interface AggregateResult {
  minFrom: number | null;
  maxTo: number | null;
  anyStillInProd: boolean;
  yearBearingRows: number;
  acceptedLabels: string[];
}

function aggregateGenerationBindings(
  bindings: SparqlBinding[],
  applyLabelBlacklist: boolean,
): AggregateResult {
  let minFrom: number | null = null;
  let maxTo: number | null = null;
  let anyStillInProd = false;
  let yearBearingRows = 0;
  const acceptedLabels: string[] = [];

  // Group by ?gen QID so multiple optional rows for one generation
  // (Wikidata returns a row per OPTIONAL match) collapse correctly.
  const byGen = new Map<string, SparqlBinding[]>();
  for (const b of bindings) {
    const qid = b.gen?.value ?? '__nogen__';
    const arr = byGen.get(qid) ?? [];
    arr.push(b);
    byGen.set(qid, arr);
  }

  for (const [, rows] of byGen) {
    const label = rows[0]?.genLabel?.value;
    if (applyLabelBlacklist && isNoiseGenerationLabel(label)) continue;
    let yf: number | null = null;
    let yt: number | null = null;
    let stillProd = false;
    let sawAnyTimeProperty = false;
    for (const b of rows) {
      // Try multiple from-year properties (P571 inception, P580 start time,
      // P5204 commercialization date — used on individual generation records).
      const candYf =
        extractYear(b.inception?.value) ??
        extractYear(b.startTime?.value) ??
        extractYear(b.commercialized?.value);
      if (candYf !== null && (yf === null || candYf < yf)) yf = candYf;
      // Same for to-year (P576 dissolved, P582 end time, P2669 discontinuation).
      const ytRaw =
        b.dissolved?.value ?? b.endTime?.value ?? b.discontinued?.value;
      if (b.inception || b.startTime || b.commercialized) {
        sawAnyTimeProperty = true;
      }
      if (ytRaw !== undefined) {
        const candYt = extractYear(ytRaw);
        if (candYt !== null && (yt === null || candYt > yt)) yt = candYt;
      }
    }
    // A row "is still in production" only if it has any from-year but no
    // to-year. Rows with neither are uninformative (label-only) and don't
    // force the umbrella to "still in production".
    if (sawAnyTimeProperty && yt === null) stillProd = true;
    if (yf !== null || yt !== null || sawAnyTimeProperty) {
      yearBearingRows++;
      if (label) acceptedLabels.push(label);
    }
    if (yf !== null && (minFrom === null || yf < minFrom)) minFrom = yf;
    if (stillProd) anyStillInProd = true;
    if (yt !== null && (maxTo === null || yt > maxTo)) maxTo = yt;
  }

  return { minFrom, maxTo, anyStillInProd, yearBearingRows, acceptedLabels };
}

async function backfillUmbrellaYears(
  cleanedMakes: Record<string, MakeEntry>,
): Promise<BackfillStats> {
  // Find every umbrella that has null years AND a wikidata_id AND generations.
  const candidates: Array<{ make: string; idx: number; model: ModelEntry }> = [];
  for (const [makeKey, makeEntry] of Object.entries(cleanedMakes)) {
    makeEntry.models.forEach((m, idx) => {
      if (
        m.year_from === null &&
        m.year_to === null &&
        m.wikidata_id &&
        m.generations &&
        m.generations.length > 0
      ) {
        candidates.push({ make: makeKey, idx, model: m });
      }
    });
  }

  console.log(
    `\nBackfilling umbrella years from generation children: ${candidates.length} candidates`,
  );

  const stats: BackfillStats = {
    candidates: candidates.length,
    filledViaPrimary: 0,
    filledViaUmbrellaSelf: 0,
    filledViaFallback: 0,
    filledFrom: 0,
    filledTo: 0,
    stillNull: 0,
    noResults: 0,
    errors: 0,
  };

  if (SKIP_BACKFILL) {
    console.log('  (SKIP_BACKFILL=1 set — skipping network step)');
    return stats;
  }

  // Track which candidates failed primary so we can run fallback in a second
  // pass (sequential to keep within Wikidata's polite rate budget).
  const fallbackCandidates: typeof candidates = [];

  let processed = 0;
  for (const cand of candidates) {
    const label = `${cand.make}/${cand.model.name}`;
    let primarySucceeded = false;
    try {
      const data = await fetchSparql(
        buildGenerationsQuery(cand.model.wikidata_id!),
        label,
      );
      if (data.results.bindings.length === 0) {
        stats.noResults++;
      } else {
        const agg = aggregateGenerationBindings(data.results.bindings, true);
        // Stash a sample for the spot-check report — first umbrella whose
        // English name matches "Volkswagen Golf" (or fall back to first
        // umbrella that produced any year-bearing rows).
        if (cand.model.name === 'Volkswagen Golf' || !stats.sampleUmbrella) {
          stats.sampleUmbrella = `${label} (qid=${cand.model.wikidata_id})`;
          stats.sampleGenLabels = agg.acceptedLabels;
        }
        if (agg.yearBearingRows === 0) {
          // Loosened query returned children but none had year metadata.
          // Punt to fallback (label-search may reach a richer record).
          fallbackCandidates.push(cand);
        } else {
          const target = cleanedMakes[cand.make]!.models[cand.idx]!;
          if (agg.minFrom !== null) {
            target.year_from = agg.minFrom;
            stats.filledFrom++;
          }
          if (agg.anyStillInProd) {
            target.year_to = null;
          } else if (agg.maxTo !== null) {
            target.year_to = agg.maxTo;
            stats.filledTo++;
          }
          if (target.year_from !== null || target.year_to !== null) {
            stats.filledViaPrimary++;
            primarySucceeded = true;
          }
        }
      }
    } catch (err) {
      stats.errors++;
      console.log(
        `  ! [${label}] primary backfill failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!primarySucceeded) {
      const target = cleanedMakes[cand.make]!.models[cand.idx]!;
      if (target.year_from === null && target.year_to === null) {
        // Only enqueue if not already queued (try/catch path).
        if (!fallbackCandidates.includes(cand)) {
          fallbackCandidates.push(cand);
        }
      }
    }

    processed++;
    if (processed % 100 === 0 || processed === candidates.length) {
      console.log(`  Processed ${processed}/${candidates.length} umbrellas (primary)...`);
    }
    await sleep(QUERY_GAP_MS);
  }

  // ------ Pass 2: query the umbrella's OWN years -------------------------
  // Many umbrellas (Toyota Aygo, Mercedes CLK-Class, Nissan Micra, etc.)
  // have year metadata directly on the umbrella record even when their
  // generation children don't. Cheap (1 query per remaining candidate) so
  // we run it before the more expensive label-search.
  const stillEmpty: typeof candidates = [];
  if (fallbackCandidates.length > 0) {
    console.log(
      `\nUmbrella-self pass: ${fallbackCandidates.length} umbrellas still null`,
    );
  }
  for (const cand of fallbackCandidates) {
    const target = cleanedMakes[cand.make]!.models[cand.idx]!;
    if (target.year_from !== null || target.year_to !== null) continue;
    try {
      const data = await fetchSparql(
        buildUmbrellaSelfQuery(cand.model.wikidata_id!),
        `${cand.make}/${cand.model.name} (self)`,
      );
      const agg = aggregateGenerationBindings(data.results.bindings, false);
      if (agg.minFrom !== null) {
        target.year_from = agg.minFrom;
        stats.filledFrom++;
      }
      if (agg.anyStillInProd) {
        target.year_to = null;
      } else if (agg.maxTo !== null) {
        target.year_to = agg.maxTo;
        stats.filledTo++;
      }
      if (target.year_from !== null || target.year_to !== null) {
        stats.filledViaUmbrellaSelf++;
        console.log(
          `  + ${cand.make}/${cand.model.name}: filled via umbrella-self (yf=${target.year_from} yt=${target.year_to ?? 'pres'})`,
        );
      } else {
        stillEmpty.push(cand);
      }
    } catch (err) {
      stats.errors++;
      console.log(
        `  ! [${cand.make}/${cand.model.name}] umbrella-self failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      stillEmpty.push(cand);
    }
    await sleep(QUERY_GAP_MS);
  }

  // ------ Pass 3: label-search for umbrellas still empty -----------------
  if (stillEmpty.length > 0) {
    console.log(
      `\nFallback (label-search) pass: ${stillEmpty.length} umbrellas still null`,
    );
  }

  for (const cand of stillEmpty) {
    const target = cleanedMakes[cand.make]!.models[cand.idx]!;
    // Skip if some other path already filled this entry (defensive).
    if (target.year_from !== null || target.year_to !== null) {
      console.log(
        `  . ${cand.make}/${cand.model.name}: skipped (already filled yf=${target.year_from} yt=${target.year_to})`,
      );
      continue;
    }

    const labels = cand.model.generations ?? [];
    console.log(
      `  > ${cand.make}/${cand.model.name}: trying ${labels.length} label(s)`,
    );
    const aggregate: SparqlBinding[] = [];
    let labelsResolved = 0;

    for (const genLabel of labels) {
      try {
        const data = await fetchSparql(
          buildLabelSearchQuery(genLabel),
          `${cand.make}/${cand.model.name} :: label="${genLabel}"`,
        );
        // Group by ?gen so we count distinct candidate QIDs (not raw rows).
        const distinctGens = new Set<string>();
        for (const b of data.results.bindings) {
          if (b.gen?.value) distinctGens.add(b.gen.value);
        }
        if (distinctGens.size === 0) {
          console.log(`  ? "${genLabel}" → 0 candidates (skipped)`);
        } else if (distinctGens.size > 5) {
          console.log(
            `  ? "${genLabel}" → ${distinctGens.size} candidates (ambiguous, skipped)`,
          );
        } else {
          // Take the first matching QID's bindings.
          const firstQid = [...distinctGens][0]!;
          for (const b of data.results.bindings) {
            if (b.gen?.value === firstQid) aggregate.push(b);
          }
          labelsResolved++;
        }
      } catch (err) {
        // Don't kill the whole umbrella for a transient label-search error;
        // log and move on.
        console.log(
          `  ! label-search "${genLabel}" failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      await sleep(QUERY_GAP_MS);
    }

    if (labelsResolved === 0) {
      stats.stillNull++;
      console.log(
        `  - ${cand.make}/${cand.model.name}: no labels resolved, leaving null`,
      );
      continue;
    }

    // Aggregate using the strict path (label-search already filters by class,
    // so we don't need the noise blacklist).
    const agg = aggregateGenerationBindings(aggregate, false);
    if (agg.minFrom !== null) {
      target.year_from = agg.minFrom;
      stats.filledFrom++;
    }
    if (agg.anyStillInProd) {
      target.year_to = null;
    } else if (agg.maxTo !== null) {
      target.year_to = agg.maxTo;
      stats.filledTo++;
    }
    if (target.year_from !== null || target.year_to !== null) {
      stats.filledViaFallback++;
      console.log(
        `  + ${cand.make}/${cand.model.name}: filled via fallback (yf=${target.year_from} yt=${target.year_to ?? 'pres'}; ${labelsResolved}/${labels.length} labels resolved)`,
      );
    } else {
      stats.stillNull++;
      console.log(
        `  - ${cand.make}/${cand.model.name}: ${labelsResolved}/${labels.length} labels resolved but no year metadata, leaving null`,
      );
    }
  }

  // Anyone who never reached the fallback (filledViaPrimary failure path that
  // still has nulls but wasn't in fallbackCandidates) — count them as still
  // null too. In practice this is just the candidates with errors.
  for (const cand of candidates) {
    const target = cleanedMakes[cand.make]!.models[cand.idx]!;
    if (target.year_from === null && target.year_to === null) {
      // Only count once: if it was processed via fallback and stayed null,
      // it was already counted above. Fallback path increments stillNull on
      // both "no labels resolved" and "agg empty" branches, so don't
      // double-count here.
    }
  }

  return stats;
}

// ---------- Supplement loading ----------------------------------------------

interface LoadedSupplement {
  filename: string;
  data: Supplement;
}

function loadAllSupplements(): LoadedSupplement[] {
  const entries = readdirSync(TYPES_DIR);
  const supplementFiles = entries.filter((e) => SUPPLEMENT_GLOB.test(e)).sort();
  const out: LoadedSupplement[] = [];
  for (const filename of supplementFiles) {
    const path = resolve(TYPES_DIR, filename);
    const data = JSON.parse(readFileSync(path, 'utf8')) as Supplement;
    out.push({ filename, data });
  }
  return out;
}

// ---------- Main ------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`Reading raw catalog: ${INPUT_PATH}`);
  const raw = JSON.parse(readFileSync(INPUT_PATH, 'utf8')) as Catalog;

  const supplements = loadAllSupplements();
  console.log(`Loaded ${supplements.length} supplement file(s):`);
  for (const s of supplements) {
    const brands = Object.keys(s.data.makes).join(', ');
    console.log(`  - ${basename(s.filename)} (brands: ${brands})`);
  }

  const cleanedMakes: Record<string, MakeEntry> = {};
  const perMakeStats: Array<{ make: string; before: number; after: number; stats: FilterStats }> = [];

  for (const [makeKey, makeEntry] of Object.entries(raw.makes)) {
    const { models, stats } = filterMake(makeKey, makeEntry.models);
    cleanedMakes[makeKey] = { models };
    perMakeStats.push({ make: makeKey, before: stats.before, after: stats.afterDedupe, stats });
  }

  // Backfill umbrella years BEFORE applying supplements (supplements have
  // hand-curated years and replace their brand wholesale).
  const backfillStats = await backfillUmbrellaYears(cleanedMakes);

  // Apply supplements: each supplement replaces its brand wholesale.
  console.log('\n--- Applying supplements ---');
  for (const sup of supplements) {
    for (const [brand, entry] of Object.entries(sup.data.makes)) {
      const beforeCount = cleanedMakes[brand]?.models.length ?? 0;
      cleanedMakes[brand] = entry;
      const idx = perMakeStats.findIndex((s) => s.make === brand);
      if (idx >= 0) {
        perMakeStats[idx]!.after = entry.models.length;
      } else {
        // Brand wasn't in raw catalog — add a stats row.
        perMakeStats.push({
          make: brand,
          before: 0,
          after: entry.models.length,
          stats: {
            before: 0,
            afterPrefix: 0,
            afterYearCutoff: 0,
            afterOrphan: 0,
            afterNoise: 0,
            afterDedupe: entry.models.length,
          },
        });
      }
      console.log(
        `  ${brand.padEnd(16)} ${beforeCount} → ${entry.models.length} (replaced from ${basename(sup.filename)})`,
      );
    }
  }

  const totalBefore = perMakeStats.reduce((acc, s) => acc + s.before, 0);
  const totalAfter = perMakeStats.reduce((acc, s) => acc + s.after, 0);

  const supplementNames = supplements.map((s) => basename(s.filename)).join(', ');

  const output: Catalog = {
    $schema_version: 1,
    generated_at: new Date().toISOString(),
    source: `Filtered from vehicle-catalog-makes-models.json (chunk B Wikidata) + ${supplementNames}`,
    license:
      'CC0 (data fields) + CC BY-SA 4.0 (label text — attribution required if displayed)',
    makes: cleanedMakes,
    stats: {
      make_count: Object.keys(cleanedMakes).length,
      model_count: totalAfter,
    },
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n', 'utf8');

  console.log('\n--- Per-make before → after ---');
  for (const s of perMakeStats) {
    console.log(`  ${s.make.padEnd(16)} ${String(s.before).padStart(4)} → ${String(s.after).padStart(4)}`);
  }
  console.log(`\n  TOTAL: ${totalBefore} → ${totalAfter} models`);

  console.log('\n--- Backfill stats ---');
  console.log(`  Candidates (umbrellas with null years + generations): ${backfillStats.candidates}`);
  console.log(`  Succeeded via primary (loosened) query:  ${backfillStats.filledViaPrimary}`);
  console.log(`  Succeeded via umbrella-self query:       ${backfillStats.filledViaUmbrellaSelf}`);
  console.log(`  Succeeded via label-search fallback:     ${backfillStats.filledViaFallback}`);
  console.log(`  Still null after all passes:             ${backfillStats.stillNull}`);
  console.log(`  year_from filled total: ${backfillStats.filledFrom}`);
  console.log(`  year_to  filled total: ${backfillStats.filledTo}`);
  console.log(`  Primary returned 0 rows: ${backfillStats.noResults}`);
  console.log(`  Errors: ${backfillStats.errors}`);
  if (backfillStats.sampleUmbrella) {
    console.log(`\n  Sample loosened-query rows for ${backfillStats.sampleUmbrella}:`);
    for (const lab of backfillStats.sampleGenLabels ?? []) {
      console.log(`    - ${lab}`);
    }
  }

  console.log(`\n  Output: ${OUTPUT_PATH}`);

  // Emit a few sanity samples.
  const sampleBrands = ['Skoda', 'Fiat', 'Mini', 'Volkswagen', 'Land Rover', 'Tesla'];
  console.log('\n--- Samples (first 5 each) ---');
  for (const brand of sampleBrands) {
    const models = cleanedMakes[brand]?.models ?? [];
    console.log(`\n  ${brand}:`);
    for (const m of models.slice(0, 5)) {
      const yf = m.year_from ?? '----';
      const yt = m.year_to ?? (m.year_from !== null ? 'pres' : '----');
      console.log(`    - ${m.name.padEnd(48)} (${yf}-${yt})`);
    }
    if (models.length === 0) console.log('    (empty)');
  }
}

main().catch((e) => {
  console.error(`Unexpected error: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
