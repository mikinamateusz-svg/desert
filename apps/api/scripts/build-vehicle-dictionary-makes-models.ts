/**
 * build-vehicle-dictionary-makes-models — Story 5.1 chunk B.
 *
 * Queries the public Wikidata SPARQL endpoint for car models manufactured by
 * the ~30 brands that dominate Polish-market new + used registrations, and
 * writes the resulting catalog to:
 *   packages/types/src/vehicle-catalog-makes-models.json
 *
 * Chunk C (engine generation) consumes the JSON to fan out per (make, model,
 * year_range) tuple. This script is intentionally standalone: no DB access,
 * no extra npm dependencies, just native fetch (Node 22+).
 *
 * Usage:
 *   pnpm --filter @desert/api build-vehicle-dict
 *
 * Wikidata licensing:
 *   - Data fields: CC0
 *   - Label text:  CC BY-SA 4.0 (attribution required if surfaced in product)
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// ---------- Config ----------------------------------------------------------

// Top ~30 brands by Polish new + used registrations (covers ~95% of the fleet).
// QIDs verified manually against wikidata.org/wiki/<QID>.
const BRANDS: ReadonlyArray<{ name: string; qid: string }> = [
  { name: 'Volkswagen',    qid: 'Q246' },
  { name: 'Toyota',        qid: 'Q53268' },
  { name: 'Skoda',         qid: 'Q29637' },
  { name: 'Ford',          qid: 'Q44294' },
  { name: 'Opel',          qid: 'Q40966' },
  { name: 'Audi',          qid: 'Q23317' },
  { name: 'BMW',           qid: 'Q26678' },
  { name: 'Mercedes-Benz', qid: 'Q36008' },
  { name: 'Hyundai',       qid: 'Q55931' },
  { name: 'Kia',           qid: 'Q35349' },
  { name: 'Renault',       qid: 'Q6686' },
  { name: 'Peugeot',       qid: 'Q6742' },
  { name: 'Citroen',       qid: 'Q6746' },     // Citroën
  { name: 'Fiat',          qid: 'Q27597' },
  { name: 'Dacia',         qid: 'Q27460' },
  { name: 'Mazda',         qid: 'Q35996' },
  { name: 'Honda',         qid: 'Q9584' },
  { name: 'Nissan',        qid: 'Q20165' },
  { name: 'Volvo',         qid: 'Q215293' },   // Volvo Cars (passenger)
  { name: 'Seat',          qid: 'Q188217' },
  { name: 'Suzuki',        qid: 'Q181642' },
  { name: 'Subaru',        qid: 'Q172741' },
  { name: 'Mitsubishi',    qid: 'Q36033' },    // Mitsubishi Motors
  { name: 'Lexus',         qid: 'Q35919' },
  { name: 'Tesla',         qid: 'Q478214' },   // Tesla, Inc.
  { name: 'Mini',          qid: 'Q116232' },
  { name: 'Alfa Romeo',    qid: 'Q26921' },
  { name: 'Land Rover',    qid: 'Q35907' },
  { name: 'Jeep',          qid: 'Q30113' },
  { name: 'Porsche',       qid: 'Q40993' },
];

const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';
// Polite identification per Wikidata's User-Agent policy.
const USER_AGENT =
  'desert-app/0.1 (https://desert.app; mikinamateusz@gmail.com) build-vehicle-dictionary-makes-models';
// Wikidata advises ~5 req/s; 250ms gap keeps us comfortably below that.
const QUERY_GAP_MS = 250;

// Output: packages/types/src/vehicle-catalog-makes-models.json relative to repo root.
// __dirname here = apps/api/scripts at runtime, so go up four levels.
const OUTPUT_PATH = resolve(
  __dirname,
  '..',
  '..',
  '..',
  'packages',
  'types',
  'src',
  'vehicle-catalog-makes-models.json',
);

// Sanity-check thresholds.
const MIN_EXPECTED_MODELS = 5;
const MAX_EXPECTED_MODELS = 200;

// ---------- Types -----------------------------------------------------------

interface SparqlBinding {
  model: { value: string };
  modelLabel?: { value: string; 'xml:lang'?: string };
  yearFrom?: { value: string };
  yearTo?: { value: string };
  gens?: { value: string };
}

interface SparqlResponse {
  results: { bindings: SparqlBinding[] };
}

interface ModelEntry {
  name: string;
  wikidata_id: string;
  year_from: number | null;
  year_to: number | null;
  generations?: string[];
}

interface MakeEntry {
  models: ModelEntry[];
}

interface Catalog {
  $schema_version: number;
  generated_at: string;
  source: string;
  license: string;
  makes: Record<string, MakeEntry>;
  stats: {
    make_count: number;
    model_count: number;
    year_min: number | null;
    year_max: number | null;
  };
}

// ---------- Helpers ---------------------------------------------------------

function buildQuery(brandQid: string): string {
  // Wikidata distinguishes two car-related entity classes:
  //   * Q3231690  — automobile model (typically a single generation, e.g. "Golf Mk7")
  //   * Q59773381 — automobile model series (the umbrella, e.g. "Volkswagen Golf")
  //
  // The two also use different "made by" properties:
  //   * Single models use P176 (manufacturer) — usually points at the brand itself.
  //   * Model series use P176 (manufacturer = parent group, e.g. "Volkswagen Group")
  //     and P1716 (brand = the brand we actually want to filter on, e.g. "Volkswagen").
  //
  // We UNION the two so the catalog includes both umbrella series ("VW Golf")
  // and stand-alone models that have no series parent (concepts, JV-only models).
  // Generations are gathered via P527 (has parts), and we restrict ?gen to
  // instances of automobile model so that miscellaneous parts (e.g. "frunk")
  // don't leak in.
  return `SELECT DISTINCT ?model ?modelLabel ?yearFrom ?yearTo
       (GROUP_CONCAT(DISTINCT ?genLabel; separator="|") AS ?gens) WHERE {
  {
    ?model wdt:P31/wdt:P279* wd:Q59773381 .
    ?model wdt:P1716 wd:${brandQid} .
  } UNION {
    ?model wdt:P31/wdt:P279* wd:Q3231690 .
    ?model wdt:P176 wd:${brandQid} .
  }
  OPTIONAL { ?model wdt:P571 ?yearFrom . }
  OPTIONAL { ?model wdt:P576 ?yearTo . }
  OPTIONAL {
    ?model wdt:P527 ?gen .
    ?gen wdt:P31/wdt:P279* wd:Q3231690 .
    ?gen rdfs:label ?genLabel .
    FILTER(LANG(?genLabel) = "en")
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
}
GROUP BY ?model ?modelLabel ?yearFrom ?yearTo
ORDER BY ?modelLabel`;
}

function extractQid(uri: string): string {
  // http://www.wikidata.org/entity/Q12345 -> Q12345
  const idx = uri.lastIndexOf('/');
  return idx === -1 ? uri : uri.slice(idx + 1);
}

function extractYear(dateStr: string | undefined): number | null {
  if (!dateStr) return null;
  // Wikidata dates: "1974-01-01T00:00:00Z" or sometimes "-0044-03-15T..." (BCE).
  // We only care about model years, so positive 4-digit prefix is fine.
  const match = dateStr.match(/^(-?)(\d{4})/);
  if (!match) return null;
  const year = parseInt(match[2]!, 10);
  if (Number.isNaN(year)) return null;
  // Sanity: cars are ~1885+. Filter implausible values.
  if (year < 1885 || year > 2100) return null;
  return year;
}

function isUsableLabel(label: string | undefined): boolean {
  if (!label) return false;
  // When Wikidata has no English label it falls back to the QID literal.
  return !/^Q\d+$/.test(label.trim());
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function fetchSparql(query: string, brandLabel: string): Promise<SparqlResponse> {
  const url = `${SPARQL_ENDPOINT}?format=json&query=${encodeURIComponent(query)}`;
  const maxAttempts = 3;
  let lastErr: string = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/sparql-results+json',
      },
    });
    if (resp.ok) {
      return (await resp.json()) as SparqlResponse;
    }
    const text = await resp.text();
    lastErr = `${resp.status} ${resp.statusText}: ${text.slice(0, 200)}`;
    // Retry on 502/503/504/429 — common transient Wikidata blips.
    if (![429, 502, 503, 504].includes(resp.status) || attempt === maxAttempts) {
      throw new Error(`[${brandLabel}] Wikidata returned ${lastErr}`);
    }
    const backoff = 1000 * attempt; // 1s, 2s
    process.stdout.write(`(retry ${attempt} after ${resp.status}) `);
    await sleep(backoff);
  }
  throw new Error(`[${brandLabel}] Wikidata exhausted retries: ${lastErr}`);
}

async function fetchBrandModels(
  brand: { name: string; qid: string },
): Promise<{ entries: ModelEntry[]; warnings: string[] }> {
  const query = buildQuery(brand.qid);
  const data = await fetchSparql(query, brand.name);
  const warnings: string[] = [];

  // Dedupe on QID. If a model appears multiple times (multiple yearFrom/yearTo
  // claims, or matched both branches of the UNION), keep the earliest yearFrom
  // and the latest yearTo (or null if any record indicates "still in production").
  const byQid = new Map<string, ModelEntry & { _stillInProd: boolean; _gens: Set<string> }>();

  for (const binding of data.results.bindings) {
    const qid = extractQid(binding.model.value);
    if (!isUsableLabel(binding.modelLabel?.value)) continue;
    const name = binding.modelLabel!.value.trim();

    const yearFrom = extractYear(binding.yearFrom?.value);
    const yearTo = extractYear(binding.yearTo?.value);
    const gens = (binding.gens?.value ?? '')
      .split('|')
      .map((g) => g.trim())
      .filter((g) => g.length > 0 && !/^Q\d+$/.test(g));

    const existing = byQid.get(qid);
    if (!existing) {
      byQid.set(qid, {
        name,
        wikidata_id: qid,
        year_from: yearFrom,
        year_to: yearTo,
        _stillInProd: binding.yearTo === undefined,
        _gens: new Set(gens),
      });
      continue;
    }

    // Merge: earliest start, latest end (null wins — "still in production").
    if (yearFrom !== null && (existing.year_from === null || yearFrom < existing.year_from)) {
      existing.year_from = yearFrom;
    }
    if (binding.yearTo === undefined) {
      existing._stillInProd = true;
      existing.year_to = null;
    } else if (
      !existing._stillInProd &&
      yearTo !== null &&
      (existing.year_to === null || yearTo > existing.year_to)
    ) {
      existing.year_to = yearTo;
    }
    for (const g of gens) existing._gens.add(g);
  }

  const entries: ModelEntry[] = [...byQid.values()]
    .map(({ _stillInProd: _ignored, _gens, ...rest }) => {
      const generations = [..._gens].sort();
      const out: ModelEntry = { ...rest };
      if (generations.length > 0) out.generations = generations;
      return out;
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  if (entries.length === 0) {
    warnings.push(`[${brand.name}] returned 0 models — verify QID ${brand.qid}`);
  } else if (entries.length < MIN_EXPECTED_MODELS) {
    warnings.push(
      `[${brand.name}] returned only ${entries.length} models — possibly under-supplemented`,
    );
  } else if (entries.length > MAX_EXPECTED_MODELS) {
    warnings.push(
      `[${brand.name}] returned ${entries.length} models (>${MAX_EXPECTED_MODELS}) — review for noise`,
    );
  }

  return { entries, warnings };
}

// ---------- Main ------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`Fetching ${BRANDS.length} brands from Wikidata SPARQL...\n`);
  const makes: Record<string, MakeEntry> = {};
  const allWarnings: string[] = [];
  const counts: Array<{ brand: string; count: number }> = [];

  let yearMin: number | null = null;
  let yearMax: number | null = null;

  for (const brand of BRANDS) {
    process.stdout.write(`  ${brand.name.padEnd(16)} (${brand.qid.padEnd(8)})  ... `);
    try {
      const { entries, warnings } = await fetchBrandModels(brand);
      makes[brand.name] = { models: entries };
      counts.push({ brand: brand.name, count: entries.length });
      allWarnings.push(...warnings);
      process.stdout.write(`${entries.length} models\n`);

      for (const m of entries) {
        if (m.year_from !== null) {
          if (yearMin === null || m.year_from < yearMin) yearMin = m.year_from;
        }
        const candidateMax = m.year_to ?? m.year_from;
        if (candidateMax !== null) {
          if (yearMax === null || candidateMax > yearMax) yearMax = candidateMax;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stdout.write(`FAILED — ${msg}\n`);
      allWarnings.push(msg);
      makes[brand.name] = { models: [] };
      counts.push({ brand: brand.name, count: 0 });
    }
    await sleep(QUERY_GAP_MS);
  }

  const totalModels = counts.reduce((acc, c) => acc + c.count, 0);

  const catalog: Catalog = {
    $schema_version: 1,
    generated_at: new Date().toISOString(),
    source: 'Wikidata SPARQL (https://query.wikidata.org/sparql)',
    license:
      'CC0 (data fields) + CC BY-SA 4.0 (label text — attribution required if displayed)',
    makes,
    stats: {
      make_count: BRANDS.length,
      model_count: totalModels,
      year_min: yearMin,
      year_max: yearMax,
    },
  };

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(catalog, null, 2) + '\n', 'utf8');

  console.log('\n--- Summary ---');
  for (const c of counts) {
    console.log(`  ${c.brand.padEnd(16)} ${String(c.count).padStart(4)} models`);
  }
  console.log(`\n  TOTAL: ${totalModels} models across ${BRANDS.length} brands`);
  console.log(`  Years: ${yearMin ?? 'n/a'} — ${yearMax ?? 'n/a'}`);
  console.log(`  Output: ${OUTPUT_PATH}`);

  if (allWarnings.length > 0) {
    console.log('\n--- Warnings ---');
    for (const w of allWarnings) console.log(`  ! ${w}`);
  } else {
    console.log('\n  No warnings.');
  }
}

main().catch((e) => {
  console.error(`Unexpected error: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
