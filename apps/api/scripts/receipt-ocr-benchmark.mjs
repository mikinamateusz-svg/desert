#!/usr/bin/env node
/**
 * Story 5.10 — Phase A receipt-OCR benchmark harness.
 *
 * Runs a folder of fuel-receipt photos through Gemini 2.5 Flash with the
 * receipt extraction prompt. Writes a timestamped CSV + Markdown report
 * with per-field extractions + cost ledger. Optional ground-truth JSON
 * compares against expected values and computes per-field accuracy.
 *
 * Pure standalone — does not import the Nest app. Useful as a PoC tool
 * BEFORE the full receipt pipeline is wired into the production codebase.
 *
 * Usage:
 *   GEMINI_API_KEY=<key> node apps/api/scripts/receipt-ocr-benchmark.mjs \
 *     --input <images-folder> \
 *     [--ground-truth <gt.json>] \
 *     [--out <output-prefix>]
 *
 * The input folder may contain .jpg / .jpeg / .png files. Non-image files
 * are silently skipped.
 *
 * Ground-truth JSON shape (one entry per filename, all fields optional —
 * missing fields just skip that field's accuracy contribution):
 *   {
 *     "IMG_001.jpg": {
 *       "pre_discount_unit_price_per_litre": 6.29,
 *       "post_discount_total": 235.74,
 *       "dispensed_volume_litres": 37.48,
 *       "fuel_type": "PB_95",
 *       "station_name": "Orlen"
 *     },
 *     ...
 *   }
 *
 * Field-match rules (per-field accuracy):
 *   - Numeric fields (price, total, volume): match if |extracted - expected|
 *     <= 0.5% of expected (covers rounding + grosz-level noise)
 *   - fuel_type: exact string match (case-insensitive)
 *   - station_name: substring match (extracted contains expected OR vice
 *     versa, case-insensitive) — chain names vary in printing
 *   - null in extraction + null/missing in ground truth = match (abstention)
 *   - null in extraction + non-null in ground truth = miss (false negative)
 *   - non-null in extraction + null in ground truth = false positive
 *   - non-null + non-null + off by more than tolerance = miss
 *
 * Decision gate (per 5.10 AC2): >=85% per-field accuracy across all five
 * fields → proceed with full implementation. Below → reposition.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../..');
const DEFAULT_OUTPUT_DIR = path.join(REPO_ROOT, '_bmad-output/analysis/results');

// ─── Constants ─────────────────────────────────────────────────────────────

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_TIMEOUT_MS = 15_000; // a bit more headroom than the prod 10s — we're not user-facing

// Gemini 2.5 Flash list pricing (USD per million tokens) as of 2026-05.
// These DIFFER from the prod-pipeline OcrSpendService constants, which are
// keyed to Gemini 2.5 Pro — pump/odometer OCR over-reports cost via the
// shared cap helper, which is conservative but inaccurate for Flash. The
// benchmark harness reports true Flash cost.
const FLASH_INPUT_USD_PER_MTOKEN = 0.30;
const FLASH_OUTPUT_USD_PER_MTOKEN = 2.50;

const VALID_FUEL_TYPES = new Set(['PB_95', 'PB_98', 'ON', 'ON_PREMIUM', 'LPG']);

// Numeric tolerance for per-field accuracy: extracted must be within 0.5%
// of expected. Tight enough to catch real OCR errors (digit transposition,
// decimal misplacement) without false-flagging rounding noise.
const NUMERIC_TOLERANCE_PCT = 0.005;

const RECEIPT_OCR_PROMPT = `You are reading a Polish fuel receipt (paragon paliwowy) and extracting structured data.

Extract exactly five fields. Look at the printed text, not interpreted layout.

- "pre_discount_unit_price_per_litre" (number | null): the per-litre price BEFORE any loyalty discount or voucher. Usually labelled "Cena za litr", "Cena/L", "PLN/L", or appears as a unit-price column. If the receipt only shows a unit price after discount, return null.
- "post_discount_total" (number | null): the final amount paid in PLN, after all discounts. Usually labelled "Razem", "Do zapłaty", "Suma", or "Łącznie".
- "dispensed_volume_litres" (number | null): volume in litres. Usually labelled "Ilość", "Litry", "L", or appears in a "quantity" column. Round to 2 decimals.
- "fuel_type" (one of "PB_95" | "PB_98" | "ON" | "ON_PREMIUM" | "LPG" | null): the fuel grade printed on the receipt. Common Polish names: "Pb95" / "Pb98" / "ON" / "ON+" / "ON Premium" / "LPG" / "Diesel" / "Etylina". Map to the canonical token. Return null if unreadable.
- "station_name" (string | null): the chain / station name (e.g. "Orlen", "Lotos", "BP", "Shell", "Circle K", "MOYA", "Avia", "AMIC", "Auchan", "Pieprzyk", "Huzar"). Trim "Stacja paliw" / "Stacja" prefixes — return just the chain.

Per-field confidence object: same shape as the extraction but each value is 0.0–1.0.
Overall confidence: 0.0–1.0, the model's certainty in the extraction.

Discard EVERYTHING else from the receipt — do not include loyalty card numbers, payment card digits, names, addresses, NIP/REGON, transaction ids, dates/times, or any other PII or non-essential field.

Return only valid JSON — no markdown, no code fences:
{
  "fields": {
    "pre_discount_unit_price_per_litre": number|null,
    "post_discount_total": number|null,
    "dispensed_volume_litres": number|null,
    "fuel_type": string|null,
    "station_name": string|null
  },
  "field_confidence": {
    "pre_discount_unit_price_per_litre": number,
    "post_discount_total": number,
    "dispensed_volume_litres": number,
    "fuel_type": number,
    "station_name": number
  },
  "overall_confidence": number
}`;

// ─── CLI argument parsing ──────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { input: null, groundTruth: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input' || a === '-i') args.input = argv[++i];
    else if (a === '--ground-truth' || a === '--gt') args.groundTruth = argv[++i];
    else if (a === '--out' || a === '-o') args.out = argv[++i];
    else if (a === '--help' || a === '-h') {
      printHelpAndExit();
    }
  }
  return args;
}

function printHelpAndExit() {
  // eslint-disable-next-line no-console
  console.log(`
Receipt OCR Benchmark Harness (Story 5.10 Phase A)

Usage:
  GEMINI_API_KEY=<key> node apps/api/scripts/receipt-ocr-benchmark.mjs \\
    --input <folder>                   # folder containing receipt photos (.jpg, .jpeg, .png)
    [--ground-truth <file.json>]       # optional: per-image expected values for accuracy report
    [--out <prefix>]                   # optional: output filename prefix (default: 'receipt-ocr-<timestamp>')

Outputs:
  _bmad-output/analysis/results/<prefix>.csv   — per-image extraction + cost ledger
  _bmad-output/analysis/results/<prefix>.md    — markdown summary with accuracy + cost totals
`);
  process.exit(0);
}

// ─── Image discovery + loading ─────────────────────────────────────────────

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);

async function findImages(folder) {
  const entries = await fs.readdir(folder, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && IMAGE_EXTENSIONS.has(path.extname(e.name).toLowerCase()))
    .map((e) => path.join(folder, e.name))
    .sort();
}

function mediaTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  return 'image/jpeg';
}

// ─── Gemini call ───────────────────────────────────────────────────────────

async function callGemini(apiKey, imageBuffer, mediaType) {
  const url = `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const base64Image = imageBuffer.toString('base64');

  const t0 = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            { inline_data: { mime_type: mediaType, data: base64Image } },
            { text: RECEIPT_OCR_PROMPT },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.0, // deterministic for benchmarking
      },
    }),
    signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
  });
  const elapsedMs = Date.now() - t0;

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return {
      ok: false,
      error: `HTTP ${res.status}: ${body.slice(0, 200)}`,
      elapsedMs,
    };
  }

  const responseBody = await res.json();
  const inputTokens = responseBody?.usageMetadata?.promptTokenCount ?? 0;
  const outputTokens = responseBody?.usageMetadata?.candidatesTokenCount ?? 0;
  const rawText = responseBody?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

  return {
    ok: true,
    rawText,
    inputTokens,
    outputTokens,
    elapsedMs,
  };
}

function parseExtraction(rawText) {
  try {
    const cleaned = rawText
      .replace(/^```json\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    const parsed = JSON.parse(cleaned);
    return { ok: true, data: parsed };
  } catch (e) {
    return { ok: false, error: `JSON parse failed: ${e.message}`, rawText };
  }
}

function computeCostUsd(inputTokens, outputTokens) {
  return (
    (inputTokens / 1_000_000) * FLASH_INPUT_USD_PER_MTOKEN +
    (outputTokens / 1_000_000) * FLASH_OUTPUT_USD_PER_MTOKEN
  );
}

// ─── Ground-truth comparison ───────────────────────────────────────────────

function normaliseString(s) {
  return typeof s === 'string' ? s.trim().toLowerCase() : null;
}

function normaliseFuelType(s) {
  if (typeof s !== 'string') return null;
  const u = s.trim().toUpperCase().replace(/\s+/g, '_').replace('-', '_');
  if (VALID_FUEL_TYPES.has(u)) return u;
  // Common Polish aliases the prompt asks to canonicalise, but model may
  // miss — defensive mapping.
  if (u === 'DIESEL' || u === 'ETYLINA_ON') return 'ON';
  if (u === 'BENZYNA_95' || u === 'PB95') return 'PB_95';
  if (u === 'BENZYNA_98' || u === 'PB98') return 'PB_98';
  if (u === 'ON+' || u === 'ON_PLUS' || u === 'PREMIUM_DIESEL') return 'ON_PREMIUM';
  return null;
}

function compareNumeric(extracted, expected) {
  if (extracted == null && expected == null) return 'abstain-match';
  if (extracted == null && expected != null) return 'miss-false-negative';
  if (extracted != null && expected == null) return 'miss-false-positive';
  const tol = Math.max(Math.abs(expected) * NUMERIC_TOLERANCE_PCT, 0.005);
  return Math.abs(extracted - expected) <= tol ? 'match' : 'miss-value';
}

function compareFuelType(extracted, expected) {
  const e = normaliseFuelType(extracted);
  const x = normaliseFuelType(expected);
  if (e == null && x == null) return 'abstain-match';
  if (e == null && x != null) return 'miss-false-negative';
  if (e != null && x == null) return 'miss-false-positive';
  return e === x ? 'match' : 'miss-value';
}

function compareStationName(extracted, expected) {
  const e = normaliseString(extracted);
  const x = normaliseString(expected);
  if (e == null && x == null) return 'abstain-match';
  if (e == null && x != null) return 'miss-false-negative';
  if (e != null && x == null) return 'miss-false-positive';
  if (e === x) return 'match';
  // Substring fuzzy match — receipts print "Orlen S.A." / "PKN ORLEN" /
  // "Stacja Orlen" etc. for the same chain.
  if (e.includes(x) || x.includes(e)) return 'match';
  return 'miss-value';
}

const FIELD_COMPARATORS = {
  pre_discount_unit_price_per_litre: compareNumeric,
  post_discount_total: compareNumeric,
  dispensed_volume_litres: compareNumeric,
  fuel_type: compareFuelType,
  station_name: compareStationName,
};

function compareAgainstGroundTruth(extracted, expected) {
  // Returns one verdict per field. Caller aggregates.
  const verdicts = {};
  for (const field of Object.keys(FIELD_COMPARATORS)) {
    const ex = extracted?.[field] ?? null;
    const gt = expected?.[field] ?? null;
    verdicts[field] = FIELD_COMPARATORS[field](ex, gt);
  }
  return verdicts;
}

// ─── CSV + Markdown writers ────────────────────────────────────────────────

const CSV_HEADER = [
  'filename',
  'pre_unit_price_extracted',
  'pre_unit_price_expected',
  'pre_unit_price_verdict',
  'post_total_extracted',
  'post_total_expected',
  'post_total_verdict',
  'volume_extracted',
  'volume_expected',
  'volume_verdict',
  'fuel_type_extracted',
  'fuel_type_expected',
  'fuel_type_verdict',
  'station_extracted',
  'station_expected',
  'station_verdict',
  'overall_confidence',
  'input_tokens',
  'output_tokens',
  'cost_usd',
  'elapsed_ms',
  'parse_ok',
  'http_ok',
  'notes',
];

function csvEscape(v) {
  if (v == null) return '';
  const s = typeof v === 'string' ? v : String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function rowToCsv(row) {
  return CSV_HEADER.map((h) => csvEscape(row[h])).join(',');
}

function summariseAccuracy(rows) {
  // Per-field counts across all rows
  const fields = [
    'pre_unit_price',
    'post_total',
    'volume',
    'fuel_type',
    'station',
  ];
  const summary = {};
  for (const f of fields) {
    const verdicts = rows
      .map((r) => r[`${f}_verdict`])
      .filter((v) => v !== undefined && v !== '');
    const total = verdicts.length;
    const matches = verdicts.filter((v) => v === 'match' || v === 'abstain-match').length;
    const fpRate = verdicts.filter((v) => v === 'miss-false-positive').length;
    const fnRate = verdicts.filter((v) => v === 'miss-false-negative').length;
    const valueMisses = verdicts.filter((v) => v === 'miss-value').length;
    summary[f] = {
      total,
      matches,
      accuracy: total > 0 ? matches / total : null,
      falsePositives: fpRate,
      falseNegatives: fnRate,
      valueMisses,
    };
  }
  return summary;
}

function summariseCost(rows) {
  let totalInput = 0;
  let totalOutput = 0;
  let totalUsd = 0;
  let totalElapsed = 0;
  let ok = 0;
  let parseFail = 0;
  let httpFail = 0;
  for (const r of rows) {
    totalInput += Number(r.input_tokens) || 0;
    totalOutput += Number(r.output_tokens) || 0;
    totalUsd += Number(r.cost_usd) || 0;
    totalElapsed += Number(r.elapsed_ms) || 0;
    if (r.http_ok === 'true' && r.parse_ok === 'true') ok++;
    if (r.parse_ok === 'false') parseFail++;
    if (r.http_ok === 'false') httpFail++;
  }
  return {
    total: rows.length,
    ok,
    parseFail,
    httpFail,
    totalInput,
    totalOutput,
    totalUsd,
    avgElapsedMs: rows.length > 0 ? Math.round(totalElapsed / rows.length) : 0,
  };
}

function fmtPct(x) {
  return x == null ? 'n/a' : `${(x * 100).toFixed(1)}%`;
}

function markdownReport(rows, hasGroundTruth, runMeta) {
  const cost = summariseCost(rows);
  const lines = [];
  lines.push(`# Receipt OCR Benchmark — ${runMeta.timestamp}`);
  lines.push('');
  lines.push(`**Story 5.10 Phase A.** Model: \`${GEMINI_MODEL}\`. Input folder: \`${runMeta.inputFolder}\`. Ground truth: ${hasGroundTruth ? '`' + runMeta.groundTruthPath + '`' : 'none (extraction only)'}.`);
  lines.push('');
  lines.push('## Run summary');
  lines.push('');
  lines.push(`- Images processed: **${cost.total}**`);
  lines.push(`- Successful extractions: **${cost.ok}**`);
  lines.push(`- HTTP failures: ${cost.httpFail}`);
  lines.push(`- Parse failures: ${cost.parseFail}`);
  lines.push(`- Total cost: **$${cost.totalUsd.toFixed(4)}** (${cost.totalInput.toLocaleString()} input + ${cost.totalOutput.toLocaleString()} output tokens)`);
  lines.push(`- Avg per-image cost: **$${cost.total > 0 ? (cost.totalUsd / cost.total).toFixed(4) : '0.0000'}**`);
  lines.push(`- Avg per-image latency: **${cost.avgElapsedMs} ms**`);
  lines.push('');

  if (hasGroundTruth) {
    const acc = summariseAccuracy(rows);
    lines.push('## Per-field accuracy');
    lines.push('');
    lines.push('| Field | N | Matches | Accuracy | False+ | False− | Value misses |');
    lines.push('|---|---:|---:|---:|---:|---:|---:|');
    for (const f of ['pre_unit_price', 'post_total', 'volume', 'fuel_type', 'station']) {
      const a = acc[f];
      lines.push(`| ${f} | ${a.total} | ${a.matches} | **${fmtPct(a.accuracy)}** | ${a.falsePositives} | ${a.falseNegatives} | ${a.valueMisses} |`);
    }
    lines.push('');

    const fieldKeys = ['pre_unit_price', 'post_total', 'volume', 'fuel_type', 'station'];
    const allAccuracies = fieldKeys.map((f) => acc[f].accuracy).filter((x) => x != null);
    const overallAccuracy = allAccuracies.length > 0
      ? allAccuracies.reduce((a, b) => a + b, 0) / allAccuracies.length
      : null;
    const minAccuracy = allAccuracies.length > 0 ? Math.min(...allAccuracies) : null;

    lines.push('## Decision gate (AC2 — ≥85% per-field accuracy)');
    lines.push('');
    lines.push(`- Mean per-field accuracy: **${fmtPct(overallAccuracy)}**`);
    lines.push(`- Worst per-field accuracy: **${fmtPct(minAccuracy)}**`);
    lines.push('');
    if (minAccuracy != null && minAccuracy >= 0.85) {
      lines.push('**Verdict: PASS** — every field is at or above the 85% gate. Proceed to Phase C (full receipt OCR build per spec 5.10).');
    } else if (minAccuracy != null) {
      lines.push(`**Verdict: FAIL** — at least one field is below the 85% gate. Reposition: drop public-feed integration for receipts (spend-log only) OR fall back to Sonnet 4.6 and re-benchmark.`);
    } else {
      lines.push('**Verdict: INDETERMINATE** — no accuracy signal (no usable comparisons).');
    }
    lines.push('');
  } else {
    lines.push('## Per-field accuracy');
    lines.push('');
    lines.push('No ground-truth file provided — accuracy not computed.');
    lines.push('');
    lines.push('**Next step:** open the CSV alongside the photos, manually verify each extracted field, and re-run with `--ground-truth <file.json>` for an automated accuracy report. See script header for the expected ground-truth JSON shape.');
    lines.push('');
  }

  lines.push('## Per-image details');
  lines.push('');
  lines.push('See companion CSV: `' + runMeta.csvFilename + '`');
  lines.push('');
  return lines.join('\n');
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    console.error('Error: --input <folder> is required. Use --help for usage.');
    process.exit(1);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('Error: GEMINI_API_KEY env var is required.');
    process.exit(1);
  }

  const inputFolder = path.resolve(args.input);
  const images = await findImages(inputFolder);
  if (images.length === 0) {
    console.error(`Error: no .jpg/.jpeg/.png files found in ${inputFolder}`);
    process.exit(1);
  }

  let groundTruth = null;
  if (args.groundTruth) {
    const gtRaw = await fs.readFile(path.resolve(args.groundTruth), 'utf8');
    groundTruth = JSON.parse(gtRaw);
  }

  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '')
    .replace('T', '-')
    .slice(0, 15);
  const prefix = args.out ?? `receipt-ocr-${timestamp}`;
  const outDir = DEFAULT_OUTPUT_DIR;
  await fs.mkdir(outDir, { recursive: true });
  const csvPath = path.join(outDir, `${prefix}.csv`);
  const mdPath = path.join(outDir, `${prefix}.md`);

  console.log(`Running receipt OCR benchmark on ${images.length} images...`);
  console.log(`  Model: ${GEMINI_MODEL}`);
  console.log(`  Ground truth: ${groundTruth ? args.groundTruth : 'none'}`);
  console.log(`  Output: ${csvPath}`);
  console.log('');

  const rows = [];
  for (let i = 0; i < images.length; i++) {
    const imagePath = images[i];
    const filename = path.basename(imagePath);
    process.stdout.write(`  [${i + 1}/${images.length}] ${filename}... `);

    const buf = await fs.readFile(imagePath);
    const media = mediaTypeFor(imagePath);
    const apiResult = await callGemini(apiKey, buf, media);

    if (!apiResult.ok) {
      console.log(`FAIL (${apiResult.error})`);
      rows.push({
        filename,
        http_ok: 'false',
        parse_ok: 'false',
        elapsed_ms: apiResult.elapsedMs,
        notes: apiResult.error,
      });
      continue;
    }

    const parsed = parseExtraction(apiResult.rawText);
    if (!parsed.ok) {
      console.log(`PARSE FAIL`);
      rows.push({
        filename,
        http_ok: 'true',
        parse_ok: 'false',
        elapsed_ms: apiResult.elapsedMs,
        input_tokens: apiResult.inputTokens,
        output_tokens: apiResult.outputTokens,
        cost_usd: computeCostUsd(apiResult.inputTokens, apiResult.outputTokens).toFixed(6),
        notes: parsed.error,
      });
      continue;
    }

    const fields = parsed.data?.fields ?? {};
    const overallConfidence = parsed.data?.overall_confidence ?? null;
    const cost = computeCostUsd(apiResult.inputTokens, apiResult.outputTokens);

    const row = {
      filename,
      pre_unit_price_extracted: fields.pre_discount_unit_price_per_litre ?? '',
      post_total_extracted: fields.post_discount_total ?? '',
      volume_extracted: fields.dispensed_volume_litres ?? '',
      fuel_type_extracted: fields.fuel_type ?? '',
      station_extracted: fields.station_name ?? '',
      overall_confidence: overallConfidence ?? '',
      input_tokens: apiResult.inputTokens,
      output_tokens: apiResult.outputTokens,
      cost_usd: cost.toFixed(6),
      elapsed_ms: apiResult.elapsedMs,
      parse_ok: 'true',
      http_ok: 'true',
      notes: '',
    };

    if (groundTruth) {
      const gt = groundTruth[filename] ?? null;
      if (gt) {
        const verdicts = compareAgainstGroundTruth(fields, gt);
        row.pre_unit_price_expected = gt.pre_discount_unit_price_per_litre ?? '';
        row.pre_unit_price_verdict = verdicts.pre_discount_unit_price_per_litre;
        row.post_total_expected = gt.post_discount_total ?? '';
        row.post_total_verdict = verdicts.post_discount_total;
        row.volume_expected = gt.dispensed_volume_litres ?? '';
        row.volume_verdict = verdicts.dispensed_volume_litres;
        row.fuel_type_expected = gt.fuel_type ?? '';
        row.fuel_type_verdict = verdicts.fuel_type;
        row.station_expected = gt.station_name ?? '';
        row.station_verdict = verdicts.station_name;
      } else {
        row.notes = 'no ground-truth entry';
      }
    }

    rows.push(row);
    console.log(`ok (${apiResult.elapsedMs}ms, $${cost.toFixed(4)})`);
  }

  // Write CSV
  const csvLines = [CSV_HEADER.join(','), ...rows.map(rowToCsv)];
  await fs.writeFile(csvPath, csvLines.join('\n') + '\n', 'utf8');

  // Write Markdown report
  const md = markdownReport(rows, groundTruth != null, {
    timestamp,
    inputFolder,
    groundTruthPath: args.groundTruth ?? null,
    csvFilename: path.basename(csvPath),
  });
  await fs.writeFile(mdPath, md, 'utf8');

  const cost = summariseCost(rows);
  console.log('');
  console.log('─────────────────────────────────────────────');
  console.log(`Done. ${cost.ok}/${cost.total} successful extractions. Total cost: $${cost.totalUsd.toFixed(4)}.`);
  console.log(`  CSV:      ${csvPath}`);
  console.log(`  Markdown: ${mdPath}`);
  console.log('─────────────────────────────────────────────');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
