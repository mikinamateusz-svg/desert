#!/usr/bin/env node
/**
 * Reads a benchmark CSV produced by run-benchmark.mjs and writes a Markdown
 * summary scoring each model against the ground-truth labels.
 *
 * Usage:
 *   node _bmad-output/analysis/analyse-benchmark.mjs                   # newest CSV
 *   node _bmad-output/analysis/analyse-benchmark.mjs runs-XXX.csv      # specific
 *
 * Output:
 *   _bmad-output/analysis/results/<csv-basename>.md
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const RESULTS_DIR = path.join(__dirname, 'results');
mkdirSync(RESULTS_DIR, { recursive: true });

// Tolerance for treating a price as "matched" — 0.005 PLN = half a grosz.
// OCR sometimes emits 6.19 vs labeled 6.190; we shouldn't penalise float drift.
const PRICE_TOLERANCE = 0.005;

const FUELS = ['PB_95', 'PB_98', 'ON', 'ON_PREMIUM', 'LPG'];

main();

function main() {
  const csvPath = pickCsvPath(process.argv[2]);
  console.log(`Reading ${csvPath}`);
  const rows = parseCsv(readFileSync(csvPath, 'utf8'));
  console.log(`${rows.length} rows`);

  const summary = analyse(rows);
  const md = renderMarkdown(summary, csvPath);

  const outPath = path.join(RESULTS_DIR, path.basename(csvPath).replace(/\.csv$/, '.md'));
  writeFileSync(outPath, md, 'utf8');
  console.log(`✓ Wrote ${outPath}`);
}

// ── CSV parsing ────────────────────────────────────────────────────────────

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const fields = parseCsvLine(line);
    const row = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = fields[i] ?? '';
    return row;
  });
}

function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === ',') { fields.push(current); current = ''; }
      else if (ch === '"') { inQuotes = true; }
      else { current += ch; }
    }
  }
  fields.push(current);
  return fields;
}

// ── Analysis ───────────────────────────────────────────────────────────────

function analyse(rows) {
  // Group rows by photo_id, then within that by model_id.
  // Each photo has one actual_prices, and N model outputs.
  const photos = new Map();
  for (const r of rows) {
    if (!photos.has(r.photo_id)) {
      photos.set(r.photo_id, {
        photo_id: r.photo_id,
        station_name: r.station_name,
        final_status: r.final_status,
        flag_reason: r.flag_reason,
        actual_prices: safeParseJson(r.actual_prices) ?? {},
        models: {},
      });
    }
    const photo = photos.get(r.photo_id);
    photo.models[r.model_id] = {
      model_label: r.model_label,
      ocr_prices: safeParseJson(r.ocr_prices) ?? [],
      confidence: r.confidence === '' ? null : parseFloat(r.confidence),
      latency_ms: r.latency_ms === '' ? null : parseInt(r.latency_ms, 10),
      input_tokens: r.input_tokens === '' ? null : parseInt(r.input_tokens, 10),
      output_tokens: r.output_tokens === '' ? null : parseInt(r.output_tokens, 10),
      cost_usd: r.cost_usd === '' ? null : parseFloat(r.cost_usd),
      error: r.error || null,
    };
  }

  // Discover the set of models from the data
  const modelIds = Array.from(new Set(rows.map((r) => r.model_id))).filter(Boolean);
  const modelLabels = {};
  for (const id of modelIds) {
    modelLabels[id] = rows.find((r) => r.model_id === id)?.model_label ?? id;
  }

  // Per-model aggregate stats
  const perModel = {};
  for (const modelId of modelIds) {
    perModel[modelId] = {
      label: modelLabels[modelId],
      photos_evaluated: 0,
      photos_errored: 0,
      // Per-fuel scoring buckets
      fuel_stats: Object.fromEntries(FUELS.map((f) => [f, {
        labeled_count: 0,        // photos where this fuel was in actual_prices
        ocr_present: 0,          // model returned this fuel
        exact_match: 0,          // value within ±tolerance of labeled
        wrong_value: 0,          // model returned this fuel but wrong value
        missing: 0,              // labeled but model didn't return
        false_positive: 0,       // model returned but not in actual_prices
        abs_errors: [],          // |labeled - returned| for present fuels
      }])),
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_cost_usd: 0,
      latencies_ms: [],
      avg_confidence: [],
    };
  }

  for (const photo of photos.values()) {
    const labeled = photo.actual_prices;
    const labeledFuels = Object.keys(labeled);
    if (labeledFuels.length === 0) continue;

    for (const modelId of modelIds) {
      const m = photo.models[modelId];
      if (!m) continue;
      const stats = perModel[modelId];
      if (m.error) {
        stats.photos_errored += 1;
        continue;
      }
      stats.photos_evaluated += 1;
      stats.total_input_tokens += m.input_tokens ?? 0;
      stats.total_output_tokens += m.output_tokens ?? 0;
      stats.total_cost_usd += m.cost_usd ?? 0;
      if (m.latency_ms != null) stats.latencies_ms.push(m.latency_ms);
      if (m.confidence != null) stats.avg_confidence.push(m.confidence);

      // Build a map of model output by fuel
      const ocrByFuel = {};
      for (const p of m.ocr_prices) {
        if (typeof p?.fuel_type === 'string' && typeof p?.price_per_litre === 'number') {
          ocrByFuel[p.fuel_type] = p.price_per_litre;
        }
      }

      // Score each labeled fuel
      for (const fuel of FUELS) {
        const fs = stats.fuel_stats[fuel];
        const labeledVal = labeled[fuel];
        const ocrVal = ocrByFuel[fuel];

        if (labeledVal == null && ocrVal == null) {
          // Neither labeled nor returned — neutral, ignore
          continue;
        }
        if (labeledVal == null && ocrVal != null) {
          fs.false_positive += 1;
          continue;
        }
        // labeledVal is present
        fs.labeled_count += 1;
        if (ocrVal == null) {
          fs.missing += 1;
          continue;
        }
        fs.ocr_present += 1;
        const diff = Math.abs(labeledVal - ocrVal);
        fs.abs_errors.push(diff);
        if (diff <= PRICE_TOLERANCE) {
          fs.exact_match += 1;
        } else {
          fs.wrong_value += 1;
        }
      }
    }
  }

  return {
    csvPath: null,
    photoCount: photos.size,
    photos: Array.from(photos.values()),
    perModel,
    modelIds,
    modelLabels,
  };
}

// ── Markdown rendering ────────────────────────────────────────────────────

function renderMarkdown(summary, csvPath) {
  const { photoCount, perModel, modelIds, photos } = summary;
  const lines = [];
  lines.push(`# OCR model benchmark — ${path.basename(csvPath)}`);
  lines.push('');
  lines.push(`**Corpus**: ${photoCount} photos with ground-truth labels.`);
  lines.push(`**Tolerance**: prices within ±${PRICE_TOLERANCE.toFixed(3)} PLN/l counted as exact match.`);
  lines.push('');

  // ── Headline table: per-model accuracy + cost
  lines.push('## Headline');
  lines.push('');
  lines.push('| Model | Accuracy | Mean abs error | Avg latency | Total cost | Cost / correct fuel |');
  lines.push('|---|---|---|---|---|---|');
  for (const modelId of modelIds) {
    const s = perModel[modelId];
    const totals = sumFuelStats(s.fuel_stats);
    const accuracy = totals.labeled_count > 0
      ? `${((totals.exact_match / totals.labeled_count) * 100).toFixed(1)}% (${totals.exact_match}/${totals.labeled_count})`
      : 'n/a';
    const allErrors = Object.values(s.fuel_stats).flatMap((f) => f.abs_errors);
    const mae = allErrors.length > 0
      ? `${(allErrors.reduce((a, b) => a + b, 0) / allErrors.length).toFixed(3)} PLN/l`
      : 'n/a';
    const avgLatency = s.latencies_ms.length > 0
      ? `${Math.round(s.latencies_ms.reduce((a, b) => a + b, 0) / s.latencies_ms.length)}ms`
      : 'n/a';
    const cost = `$${s.total_cost_usd.toFixed(4)}`;
    const costPer = totals.exact_match > 0
      ? `$${(s.total_cost_usd / totals.exact_match).toFixed(5)}`
      : 'n/a';
    lines.push(`| **${s.label}** | ${accuracy} | ${mae} | ${avgLatency} | ${cost} | ${costPer} |`);
  }
  lines.push('');

  // ── Per-fuel table: helps spot which fuels each model struggles with
  lines.push('## Per-fuel breakdown');
  lines.push('');
  for (const modelId of modelIds) {
    const s = perModel[modelId];
    lines.push(`### ${s.label}`);
    lines.push('');
    lines.push('| Fuel | Labeled | Exact | Wrong | Missing | False positives | MAE |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const fuel of FUELS) {
      const f = s.fuel_stats[fuel];
      if (f.labeled_count === 0 && f.false_positive === 0) continue;
      const mae = f.abs_errors.length > 0
        ? `${(f.abs_errors.reduce((a, b) => a + b, 0) / f.abs_errors.length).toFixed(3)} PLN/l`
        : '—';
      lines.push(`| ${fuel} | ${f.labeled_count} | ${f.exact_match} | ${f.wrong_value} | ${f.missing} | ${f.false_positive} | ${mae} |`);
    }
    lines.push('');
  }

  // ── Per-photo detail: drill in on hard cases
  lines.push('## Per-photo detail');
  lines.push('');
  lines.push('Each row: how each model performed on a single photo. Bold = exact, ✗ = wrong/missing, + = false positive.');
  lines.push('');
  for (const photo of photos) {
    const labeled = photo.actual_prices;
    if (Object.keys(labeled).length === 0) continue;
    lines.push(`### ${photo.station_name || '(no station)'} — ${photo.photo_id.slice(0, 8)}`);
    if (photo.flag_reason) lines.push(`*flag: ${photo.flag_reason}*`);
    lines.push('');
    lines.push(`Ground truth: \`${formatPrices(labeled)}\``);
    lines.push('');
    for (const modelId of modelIds) {
      const m = photo.models[modelId];
      if (!m) { lines.push(`- **${perModel[modelId].label}**: (no result)`); continue; }
      if (m.error) { lines.push(`- **${perModel[modelId].label}**: ✗ error — \`${m.error}\``); continue; }
      const ocrByFuel = Object.fromEntries(m.ocr_prices.map((p) => [p.fuel_type, p.price_per_litre]));
      const verdicts = [];
      for (const fuel of FUELS) {
        const lv = labeled[fuel];
        const ov = ocrByFuel[fuel];
        if (lv == null && ov == null) continue;
        if (lv == null) { verdicts.push(`+${fuel}=${ov}`); continue; }
        if (ov == null) { verdicts.push(`✗${fuel}=missing`); continue; }
        if (Math.abs(lv - ov) <= PRICE_TOLERANCE) verdicts.push(`**${fuel}=${ov}**`);
        else verdicts.push(`✗${fuel}=${ov} (was ${lv})`);
      }
      lines.push(`- **${perModel[modelId].label}** (conf ${m.confidence ?? '?'}, ${m.latency_ms}ms): ${verdicts.join(' · ')}`);
    }
    lines.push('');
  }

  // ── Token + cost detail
  lines.push('## Cost detail');
  lines.push('');
  lines.push('| Model | Photos | Input tokens | Output tokens | Total cost | $/photo |');
  lines.push('|---|---|---|---|---|---|');
  for (const modelId of modelIds) {
    const s = perModel[modelId];
    const perPhoto = s.photos_evaluated > 0 ? s.total_cost_usd / s.photos_evaluated : 0;
    lines.push(`| ${s.label} | ${s.photos_evaluated} | ${s.total_input_tokens.toLocaleString()} | ${s.total_output_tokens.toLocaleString()} | $${s.total_cost_usd.toFixed(4)} | $${perPhoto.toFixed(5)} |`);
  }
  lines.push('');

  return lines.join('\n');
}

// ── Tiny utils ────────────────────────────────────────────────────────────

function safeParseJson(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

function formatPrices(obj) {
  return Object.entries(obj)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
}

function sumFuelStats(fuelStats) {
  const sum = { labeled_count: 0, exact_match: 0, wrong_value: 0, missing: 0, false_positive: 0 };
  for (const fuel of FUELS) {
    const f = fuelStats[fuel];
    sum.labeled_count += f.labeled_count;
    sum.exact_match += f.exact_match;
    sum.wrong_value += f.wrong_value;
    sum.missing += f.missing;
    sum.false_positive += f.false_positive;
  }
  return sum;
}

function pickCsvPath(arg) {
  if (arg) {
    return path.isAbsolute(arg) ? arg : path.join(DATA_DIR, arg);
  }
  // Newest CSV in data/
  const csvs = readdirSync(DATA_DIR).filter((f) => f.startsWith('runs-') && f.endsWith('.csv')).sort();
  if (csvs.length === 0) {
    console.error('No runs-*.csv in _bmad-output/analysis/data/. Run run-benchmark.mjs first.');
    process.exit(1);
  }
  return path.join(DATA_DIR, csvs[csvs.length - 1]);
}
