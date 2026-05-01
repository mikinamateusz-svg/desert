#!/usr/bin/env node
/**
 * Logo recognition model benchmark — runs each labeled ResearchPhoto through
 * a list of candidate vision models with the production LOGO_PROMPT and dumps
 * results to CSV. Used to compare Claude Haiku (current production) vs Gemini
 * Flash (the candidate switch) for Story 3.6 logo recognition.
 *
 * The production prompt is used verbatim so we measure model differences,
 * not prompt differences.
 *
 * Reuses the existing ResearchPhoto corpus from the OCR benchmark — every
 * price-board photo also captures the canopy / signage / attendants in frame
 * most of the time. Brand ground truth is derived from `station_name` via a
 * regex/keyword normaliser; rows that don't map cleanly to a known brand are
 * skipped (independent stations have no ground truth).
 *
 * Usage (from repo root):
 *   node _bmad-output/analysis/run-logo-benchmark.mjs
 *
 * Output:
 *   _bmad-output/analysis/data/logo-runs-<timestamp>.csv
 *
 * Reads from .env.local:
 *   ANTHROPIC_API_KEY   — required for Claude Haiku/Sonnet
 *   GEMINI_API_KEY      — required for Gemini Flash + Pro
 *   API_URL             — optional, defaults to production
 *   ADMIN_EMAIL/PASS    — optional, prompts otherwise
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Setup ──────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DATA_DIR = path.join(__dirname, 'data');
mkdirSync(DATA_DIR, { recursive: true });

loadEnvFile(path.join(REPO_ROOT, '.env.local'));

const API = process.env.API_URL ?? 'https://desert-production-ac37.up.railway.app';

// ── Production logo prompt — copy of apps/api/src/logo/logo.service.ts ─────
// Keep this in sync if the production prompt changes. We test models against
// the same prompt the production pipeline uses, so differences in output
// reflect model capability, not prompt differences.

const LOGO_PROMPT = `You are analyzing a photo taken at a fuel station in Poland.
Your task: identify which fuel station brand/chain this is, based on visible logos, signage, colours, and branding.

Polish fuel station brands to recognise:
- Orlen (red and white, PKN Orlen logo, "ORLEN" text) → "orlen"
- BP (green and yellow shield logo, "bp" text) → "bp"
- Shell (yellow shell logo, "Shell" text) → "shell"
- Lotos (formerly "LOTOS", now often rebranded as Orlen — if the sign still says Lotos) → "lotos"
- Circle K (red and white, circle K logo — formerly Statoil) → "circle_k"
- Amic (orange and white, "AMIC" text) → "amic"
- Moya (blue and white, "MOYA" text) → "moya"
- Huzar ("HUZAR" text) → "huzar"
- Auchan (hypermarket fuel station) → "auchan"
- Carrefour (hypermarket fuel station) → "carrefour"

Provide a confidence score from 0.0 to 1.0:
- 1.0: logo is clearly visible and unmistakable
- 0.7–0.9: logo partially visible or slightly obscured but identifiable
- 0.4–0.69: uncertain — logo not clearly visible but branding cues (colour scheme, signage style) suggest a brand
- 0.0–0.39: cannot identify — no logo visible, price board only, interior shot, or unrecognised independent station

Respond ONLY with valid JSON:
{
  "brand": "orlen",
  "confidence": 0.95
}

If the brand cannot be identified, respond with:
{
  "brand": null,
  "confidence": 0.0
}`;

// Brand keys the prompt is allowed to return — must match production
// LogoService.KNOWN_BRANDS exactly.
const KNOWN_BRANDS = [
  'orlen', 'bp', 'shell', 'lotos', 'circle_k',
  'amic', 'moya', 'huzar', 'auchan', 'carrefour',
];

// ── Brand normalisation (station_name → ground-truth brand key) ──────────

/**
 * Maps a station_name string to one of the KNOWN_BRANDS keys, or null when
 * the name doesn't unambiguously identify a known brand. Returning null
 * causes the photo to be excluded from the benchmark — penalising models
 * for correctly guessing "this is an unbranded independent" would be unfair
 * since the prompt explicitly tells them to return null in that case.
 *
 * Order matters: more specific patterns must come before more general ones
 * (e.g. "Orlen Bliska" before bare "Orlen") to avoid premature matches.
 */
function normaliseBrand(stationName) {
  if (!stationName || typeof stationName !== 'string') return null;
  const n = stationName.toLowerCase();

  // Lotos signage often persists post-rebrand. Match before Orlen because
  // "Stacja Orlen (dawniej Lotos)" should resolve to whichever sign is up
  // — for now treat any "lotos" mention as Lotos.
  if (n.includes('lotos')) return 'lotos';
  if (n.includes('orlen') || n.includes('pkn')) return 'orlen';
  if (/\bbp\b/.test(n)) return 'bp';
  if (n.includes('shell')) return 'shell';
  if (n.includes('circle k') || n.includes('circle-k') || n.includes('circlek') || n.includes('statoil')) {
    return 'circle_k';
  }
  if (n.includes('amic')) return 'amic';
  if (n.includes('moya')) return 'moya';
  if (n.includes('huzar')) return 'huzar';
  if (n.includes('auchan')) return 'auchan';
  if (n.includes('carrefour')) return 'carrefour';

  // Independents / unbranded — skip from benchmark.
  // "NIEZRZESZONA" = "unaffiliated" in Polish, common Google Places fallback
  // for stations without a chain.
  return null;
}

// ── Models under test ──────────────────────────────────────────────────────

const MODELS = [
  {
    id: 'claude-haiku-4-5',
    label: 'Haiku 4.5',
    provider: 'anthropic',
    inputCostPerM: 1.0,
    outputCostPerM: 5.0,
  },
  {
    id: 'claude-sonnet-4-6',
    label: 'Sonnet 4.6',
    provider: 'anthropic',
    inputCostPerM: 3.0,
    outputCostPerM: 15.0,
  },
  {
    id: 'gemini-2.5-flash-lite',
    label: 'Gemini Flash-Lite',
    provider: 'google',
    inputCostPerM: 0.10,
    outputCostPerM: 0.40,
  },
  {
    id: 'gemini-2.5-flash',
    label: 'Gemini Flash',
    provider: 'google',
    inputCostPerM: 0.3,
    outputCostPerM: 2.5,
  },
  // Gemini Pro requires paid billing on the GCP project — leave enabled and
  // let it 429 if billing isn't on. The retry loop handles it.
  {
    id: 'gemini-2.5-pro',
    label: 'Gemini Pro',
    provider: 'google',
    inputCostPerM: 1.25,
    outputCostPerM: 10.0,
  },
];

const rl = readline.createInterface({ input, output });
const ask = (q) => rl.question(q);

// ── Main ───────────────────────────────────────────────────────────────────

main().catch((e) => {
  console.error(`\n✗ ${e.message}`);
  rl.close();
  process.exit(1);
});

async function main() {
  for (const m of MODELS) {
    if (m.provider === 'anthropic' && !process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY missing in .env.local — grab from Railway desert-api Variables');
    }
    if (m.provider === 'google' && !process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY missing in .env.local — grab from aistudio.google.com');
    }
  }

  console.log(`API: ${API}`);
  console.log('Logging in...');
  const token = await login();
  console.log('✓ Logged in\n');

  console.log('Fetching research photos...');
  const all = await fetchPhotos(token);
  console.log(`Total photos in corpus: ${all.length}`);

  // Filter for benchmark eligibility:
  //   - final_status: 'verified' — poor-quality photos are uninteresting for
  //     logo benchmarking (we want to know how models perform on usable input)
  //   - station_name normalises to a known brand
  const eligible = all
    .map((p) => ({ ...p, actual_brand: normaliseBrand(p.station_name) }))
    .filter((p) => p.final_status === 'verified' && p.actual_brand !== null);

  console.log(`Eligible (verified + brand-mappable): ${eligible.length}`);
  if (eligible.length === 0) {
    console.log('No eligible photos. Try adding more brand patterns to normaliseBrand() or running label.mjs first.');
    rl.close();
    return;
  }

  // Print brand distribution so the user knows the corpus shape before
  // burning quota — a benchmark with 19 Orlens and 1 BP doesn't tell us
  // much about Gemini's BP recognition.
  const brandCounts = eligible.reduce((acc, p) => {
    acc[p.actual_brand] = (acc[p.actual_brand] ?? 0) + 1;
    return acc;
  }, {});
  console.log('\nBrand distribution:');
  for (const [brand, n] of Object.entries(brandCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${brand.padEnd(12)} ${n}`);
  }

  const proceed = (await ask(`\nProceed with ${eligible.length} photos × ${MODELS.length} models = ${eligible.length * MODELS.length} inferences? [y/N] `)).trim().toLowerCase();
  if (proceed !== 'y') {
    console.log('Aborted.');
    rl.close();
    return;
  }

  const csvPath = path.join(DATA_DIR, `logo-runs-${timestamp()}.csv`);
  const HEADER = [
    'photo_id', 'submission_id', 'station_name', 'actual_brand',
    'final_status', 'captured_at',
    'model_id', 'model_label',
    'predicted_brand', 'confidence', 'match',
    'latency_ms', 'input_tokens', 'output_tokens', 'cost_usd',
    'error', 'raw_response_excerpt',
  ];
  writeFileSync(csvPath, toCsvLine(HEADER) + '\n', 'utf8');

  // Free-tier Gemini = 5 RPM. With parallel-per-photo dispatch (5 models),
  // a single photo burns ~3 Gemini units of quota. 15s pacing keeps us
  // under the per-minute cap.
  const PHOTO_PACE_MS = 15_000;

  let photoIdx = 0;
  let rowsWritten = 0;
  for (const photo of eligible) {
    photoIdx++;
    console.log(`[${photoIdx}/${eligible.length}] ${photo.id.slice(0, 8)} — ${photo.station_name} → expect ${photo.actual_brand}`);

    let imageB64;
    try {
      imageB64 = await downloadPhotoB64(token, photo.id);
    } catch (err) {
      console.log(`  ✗ download failed: ${err.message} — skipping all models`);
      for (const model of MODELS) {
        const row = rowFor(photo, model, { error: `download: ${err.message}` });
        appendCsvRow(csvPath, row);
        rowsWritten++;
      }
      continue;
    }

    const results = await Promise.all(
      MODELS.map((m) => runModel(m, imageB64).catch((err) => ({ error: err.message }))),
    );
    for (let i = 0; i < MODELS.length; i++) {
      const m = MODELS[i];
      const r = results[i];
      const matchSymbol = r.error
        ? `✗ ${r.error.slice(0, 50)}`
        : r.predicted_brand === photo.actual_brand
          ? `✓ ${r.predicted_brand} (${r.confidence ?? '?'})`
          : `✗ predicted "${r.predicted_brand ?? 'null'}" (${r.confidence ?? '?'})`;
      console.log(`    ${m.label.padEnd(18)} ${matchSymbol}`);
      const row = rowFor(photo, m, r);
      appendCsvRow(csvPath, row);
      rowsWritten++;
    }

    if (photoIdx < eligible.length) {
      await sleep(PHOTO_PACE_MS);
    }
  }

  console.log(`\n✓ Wrote ${rowsWritten} rows to ${csvPath}`);
  console.log(`Next: node _bmad-output/analysis/analyse-logo-benchmark.mjs ${path.basename(csvPath)}`);
  rl.close();
}

// ── API helpers ────────────────────────────────────────────────────────────

async function login() {
  let email = process.env.ADMIN_EMAIL;
  if (!email) email = (await ask('Admin email: ')).trim();
  let password = process.env.ADMIN_PASSWORD;
  if (!password) password = (await ask('Admin password: ')).trim();

  const res = await fetch(`${API}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Login failed (${res.status}): ${await res.text()}`);
  const body = await res.json();
  if (!body.accessToken) throw new Error('Login response missing accessToken');
  return body.accessToken;
}

async function fetchPhotos(token) {
  const res = await fetch(`${API}/v1/admin/research/photos?limit=100`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`fetchPhotos (${res.status}): ${await res.text()}`);
  const body = await res.json();
  return body.data ?? [];
}

async function downloadPhotoB64(token, photoId) {
  const res = await fetch(`${API}/v1/admin/research/photos/${photoId}/photo`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`download (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.toString('base64');
}

// ── Model runners ─────────────────────────────────────────────────────────

async function runModel(model, imageB64, attempt = 1) {
  const start = Date.now();
  let raw, usage;

  try {
    if (model.provider === 'anthropic') {
      ({ raw, usage } = await callAnthropic(model.id, imageB64));
    } else if (model.provider === 'google') {
      ({ raw, usage } = await callGemini(model.id, imageB64));
    } else {
      throw new Error(`Unknown provider: ${model.provider}`);
    }
  } catch (err) {
    const m = err.message.match(/\b(429|502|503|504)\b/);
    if (m && attempt <= 3) {
      const code = m[1];
      const waitMs = 15_000 * attempt + Math.floor(Math.random() * 5000);
      console.log(`    ${model.label.padEnd(18)} ${code} ${code === '429' ? 'rate-limited' : 'transient server error'}, waiting ${(waitMs / 1000).toFixed(0)}s before retry ${attempt + 1}/4...`);
      await sleep(waitMs);
      return runModel(model, imageB64, attempt + 1);
    }
    throw err;
  }

  const latency_ms = Date.now() - start;
  const parsed = parseModelResponse(raw);
  const cost_usd = (usage.input_tokens / 1e6) * model.inputCostPerM
                 + (usage.output_tokens / 1e6) * model.outputCostPerM;

  return {
    predicted_brand: parsed.brand,
    confidence: parsed.confidence,
    latency_ms,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cost_usd,
    raw_excerpt: raw.slice(0, 300),
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function callAnthropic(modelId, imageB64) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: modelId,
      // 128 max-out matches production LogoService — brand + confidence is
      // ~30 tokens, this is a generous cap.
      max_tokens: 128,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageB64 } },
          { type: 'text', text: LOGO_PROMPT },
        ],
      }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
  const body = await res.json();
  const raw = body.content?.[0]?.type === 'text' ? body.content[0].text : '';
  const usage = {
    input_tokens: body.usage?.input_tokens ?? 0,
    output_tokens: body.usage?.output_tokens ?? 0,
  };
  return { raw, usage };
}

async function callGemini(modelId, imageB64) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          { inline_data: { mime_type: 'image/jpeg', data: imageB64 } },
          { text: LOGO_PROMPT },
        ],
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.0,
      },
    }),
  });
  if (!res.ok) throw new Error(`gemini ${res.status}: ${await res.text()}`);
  const body = await res.json();
  const raw = body.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  const usage = {
    input_tokens: body.usageMetadata?.promptTokenCount ?? 0,
    output_tokens: body.usageMetadata?.candidatesTokenCount ?? 0,
  };
  return { raw, usage };
}

// ── Parsing & CSV ──────────────────────────────────────────────────────────

function parseModelResponse(raw) {
  if (!raw || typeof raw !== 'string') return { brand: null, confidence: null };
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    const obj = JSON.parse(cleaned);
    // Normalise the brand: must be one of KNOWN_BRANDS, otherwise treat as
    // null (matches production LogoService.parseResponse behaviour). Models
    // sometimes output brands not on the list ("statoil", "lukoil") — those
    // count as a miss against the known list.
    const brandRaw = obj.brand;
    const brand =
      typeof brandRaw === 'string' && KNOWN_BRANDS.includes(brandRaw)
        ? brandRaw
        : null;
    const confidence = typeof obj.confidence === 'number' ? obj.confidence : null;
    return { brand, confidence };
  } catch {
    return { brand: null, confidence: null, parse_error: true };
  }
}

function rowFor(photo, model, result) {
  const match = result.error || !result.predicted_brand
    ? ''
    : (result.predicted_brand === photo.actual_brand ? '1' : '0');
  return [
    photo.id,
    photo.submission_id,
    photo.station_name ?? '',
    photo.actual_brand ?? '',
    photo.final_status ?? '',
    photo.captured_at ?? '',
    model.id,
    model.label,
    result.predicted_brand ?? '',
    result.confidence ?? '',
    match,
    result.latency_ms ?? '',
    result.input_tokens ?? '',
    result.output_tokens ?? '',
    result.cost_usd != null ? result.cost_usd.toFixed(6) : '',
    // Strip newlines from both error and raw_excerpt — error payloads from
    // Gemini 429s arrive as multi-line JSON, and an unstripped newline inside
    // a quoted CSV field gets split as a row break by the analyser's parser.
    (result.error ?? '').replace(/[\r\n]+/g, ' '),
    (result.raw_excerpt ?? '').replace(/[\r\n]+/g, ' '),
  ];
}

function appendCsvRow(filePath, row) {
  appendFileSync(filePath, toCsvLine(row) + '\n', 'utf8');
}

function toCsvLine(row) {
  return row.map((v) => {
    const s = v == null ? '' : String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }).join(',');
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const txt = readFileSync(filePath, 'utf8');
  for (const rawLine of txt.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}
