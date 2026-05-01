#!/usr/bin/env node
/**
 * OCR model benchmark — runs each labeled ResearchPhoto through a list of
 * candidate models and dumps the results to CSV. The production prompt is
 * used verbatim so we measure model differences, not prompt differences.
 *
 * Usage (from repo root):
 *   node _bmad-output/analysis/run-benchmark.mjs
 *
 * Output:
 *   _bmad-output/analysis/data/runs-<timestamp>.csv
 *
 * Reads from .env.local:
 *   ANTHROPIC_API_KEY   — required for Claude Haiku
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

// ── Production OCR prompt — copy of apps/api/src/ocr/ocr.service.ts ──────
// Keep this in sync if the production prompt changes. We test models against
// the same prompt the production pipeline uses, so differences in output
// reflect model capability, not prompt differences.

const OCR_PROMPT = `You are analyzing a photo of a fuel station price board in Poland.
Extract all visible fuel prices. For each price you find, return:
- fuel_type: one of PB_95, PB_98, ON, ON_PREMIUM, LPG
- price_per_litre: the price as a decimal number in PLN

Polish fuel labels to recognize:
- "Pb 95", "95", "Benzyna 95" → PB_95
- "Pb 98", "98", "Benzyna 98" → PB_98
- "ON", "Diesel", "Olej napędowy" → ON
- "ON Premium", "Diesel Premium", "V-Power Diesel", "Ultimate Diesel" → ON_PREMIUM
- "LPG", "Autogas" → LPG

Price formats you may encounter: "6,19", "6.19", "6,189", "PLN 6.19", "6.19 PLN/l"
Always return price as a plain decimal (e.g., 6.19).

Also provide a confidence_score from 0.0 to 1.0:
- 1.0: price board is clearly visible, all text sharp, prices unambiguous
- 0.7–0.9: minor blur/angle but prices readable
- 0.4–0.69: some uncertainty (partial occlusion, motion blur, low light)
- 0.0–0.39: cannot reliably read prices (too blurry, no price board visible, wrong subject)

Respond ONLY with valid JSON in this exact format:
{
  "prices": [
    { "fuel_type": "PB_95", "price_per_litre": 6.19 },
    { "fuel_type": "ON", "price_per_litre": 6.49 }
  ],
  "confidence_score": 0.92
}

If no prices are visible, return: { "prices": [], "confidence_score": 0.0 }`;

// ── Models under test ──────────────────────────────────────────────────────

/**
 * Pricing per 1M tokens (USD), as of 2026-04. Used for the cost-per-photo
 * calculation in the analysis script. Update if pricing shifts.
 */
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
  // Gemini 2.5 Pro requires paid billing on the GCP project that owns
  // GEMINI_API_KEY — free tier returns 429 with `limit: 0`. Leave enabled;
  // if it 429s, that's the signal billing isn't on yet.
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

  console.log('Fetching labeled photos...');
  const labeled = await fetchLabeled(token);
  if (labeled.length === 0) {
    console.log('No labeled photos in the corpus. Run label.mjs first.');
    rl.close();
    return;
  }
  console.log(`Corpus size: ${labeled.length} labeled photos\n`);

  const csvPath = path.join(DATA_DIR, `runs-${timestamp()}.csv`);
  const HEADER = [
    'photo_id', 'submission_id', 'station_name', 'final_status', 'flag_reason',
    'captured_at', 'actual_prices', 'model_id', 'model_label',
    'ocr_prices', 'confidence', 'latency_ms', 'input_tokens', 'output_tokens',
    'cost_usd', 'error', 'raw_response_excerpt',
  ];
  const rows = [HEADER];
  // Write the header now so partial output is recoverable if the run dies.
  writeFileSync(csvPath, toCsvLine(HEADER) + '\n', 'utf8');

  // Pace between photos to stay under Gemini Flash free-tier rate limit.
  // Actual free-tier limits are 5 RPM and 20 RPD (NOT 10/250 as some docs
  // imply). 5 RPM = 1 call per 12s; we use 15s for safety. With only 11
  // photos and 12 daily-quota units left at run time, we cannot afford a
  // single 429 retry — each retry consumes RPD.
  const PHOTO_PACE_MS = 15_000;

  let photoIdx = 0;
  for (const photo of labeled) {
    photoIdx++;
    console.log(`[${photoIdx}/${labeled.length}] ${photo.id.slice(0, 8)} — ${photo.station_name ?? photo.flag_reason ?? 'unknown'}`);

    let imageB64;
    try {
      imageB64 = await downloadPhotoB64(token, photo.id);
    } catch (err) {
      console.log(`  ✗ download failed: ${err.message} — skipping all models`);
      for (const model of MODELS) {
        const row = rowFor(photo, model, { error: `download: ${err.message}` });
        rows.push(row);
        appendCsvRow(csvPath, row);
      }
      continue;
    }

    // Run all models for this photo in parallel — independent API calls
    const results = await Promise.all(MODELS.map((m) => runModel(m, imageB64).catch((err) => ({ error: err.message }))));
    for (let i = 0; i < MODELS.length; i++) {
      const m = MODELS[i];
      const r = results[i];
      console.log(`    ${m.label.padEnd(15)} ${r.error ? `✗ ${r.error}` : `✓ ${r.latency_ms}ms · ${r.prices?.length ?? 0} prices · conf ${r.confidence ?? '?'}`}`);
      const row = rowFor(photo, m, r);
      rows.push(row);
      // Append to disk after every model output so a Ctrl-C / crash mid-run
      // still leaves a usable partial CSV for the analyser.
      appendCsvRow(csvPath, row);
    }

    // Pace before next photo (skip on the last one)
    if (photoIdx < labeled.length) {
      await sleep(PHOTO_PACE_MS);
    }
  }

  console.log(`\n✓ Wrote ${rows.length - 1} rows to ${csvPath}`);
  console.log(`Next: node _bmad-output/analysis/analyse-benchmark.mjs ${path.basename(csvPath)}`);
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

async function fetchLabeled(token) {
  const res = await fetch(`${API}/v1/admin/research/photos?limit=100`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`fetchLabeled (${res.status}): ${await res.text()}`);
  const body = await res.json();
  // Filter: actual_prices must exist and be a non-empty object.
  // Empty {} = "labeled but no prices on sign" (e.g. desk test photos)
  // — exclude from benchmark since there's nothing to score.
  return (body.data ?? []).filter((p) => {
    return p.actual_prices && typeof p.actual_prices === 'object' && Object.keys(p.actual_prices).length > 0;
  });
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
    // Retry on transient errors:
    //   429 — rate limit (Gemini Flash free tier: 5 RPM / 20 RPD)
    //   502/503/504 — server-side overload, temporary
    // Wait + retry up to 3 times. Each retry on 429 consumes another RPD
    // unit — costly when daily quota is tight.
    const m = err.message.match(/\b(429|502|503|504)\b/);
    if (m && attempt <= 3) {
      const code = m[1];
      const waitMs = 15_000 * attempt + Math.floor(Math.random() * 5000);
      console.log(`    ${model.label.padEnd(15)} ${code} ${code === '429' ? 'rate-limited' : 'transient server error'}, waiting ${(waitMs / 1000).toFixed(0)}s before retry ${attempt + 1}/4...`);
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
    prices: parsed.prices,
    confidence: parsed.confidence_score,
    latency_ms,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cost_usd,
    raw_excerpt: raw.slice(0, 500),
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
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageB64 } },
          { type: 'text', text: OCR_PROMPT },
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
          { text: OCR_PROMPT },
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
  if (!raw || typeof raw !== 'string') return { prices: [], confidence_score: 0 };
  // Strip ```json fences if present
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    const obj = JSON.parse(cleaned);
    return {
      prices: Array.isArray(obj.prices) ? obj.prices : [],
      confidence_score: typeof obj.confidence_score === 'number' ? obj.confidence_score : null,
    };
  } catch {
    return { prices: [], confidence_score: null, parse_error: true };
  }
}

function rowFor(photo, model, result) {
  return [
    photo.id,
    photo.submission_id,
    photo.station_name ?? '',
    photo.final_status ?? '',
    photo.flag_reason ?? '',
    photo.captured_at ?? '',
    JSON.stringify(photo.actual_prices ?? {}),
    model.id,
    model.label,
    result.error ? '' : JSON.stringify(result.prices ?? []),
    result.confidence ?? '',
    result.latency_ms ?? '',
    result.input_tokens ?? '',
    result.output_tokens ?? '',
    result.cost_usd != null ? result.cost_usd.toFixed(6) : '',
    // Strip newlines from both error and raw_excerpt — error payloads from
    // Gemini 429s arrive as multi-line JSON; an unstripped newline inside a
    // quoted CSV field gets split as a row break by the analyser's parser.
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
