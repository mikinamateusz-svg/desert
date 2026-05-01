#!/usr/bin/env node
/**
 * Reads a logo benchmark CSV produced by run-logo-benchmark.mjs and writes a
 * Markdown summary scoring each model against the ground-truth brand.
 *
 * Usage:
 *   node _bmad-output/analysis/analyse-logo-benchmark.mjs                       # newest logo CSV
 *   node _bmad-output/analysis/analyse-logo-benchmark.mjs logo-runs-XXX.csv     # specific
 *
 * Output:
 *   _bmad-output/analysis/results/<csv-basename>.md
 *
 * Key outputs to look at when deciding Haiku vs Gemini for production:
 *   1. Headline accuracy table — overall correct rate per model
 *   2. Confidence calibration — high-confidence misses are dangerous
 *      (a model that says "0.95 confidence" but is wrong = silent failure)
 *   3. Per-brand accuracy — uneven performance suggests brand-specific
 *      blind spots (e.g. always confuses BP with Shell)
 *   4. Confusion matrix — which actual brands get mistaken for which
 *      predicted brand. Helps diagnose colour/shape similarity failures.
 *   5. Cost + latency — secondary, but matters at scale
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const RESULTS_DIR = path.join(__dirname, 'results');
mkdirSync(RESULTS_DIR, { recursive: true });

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
  // Group by photo_id; each photo carries one actual_brand and N model rows.
  const photos = new Map();
  for (const r of rows) {
    if (!photos.has(r.photo_id)) {
      photos.set(r.photo_id, {
        photo_id: r.photo_id,
        station_name: r.station_name,
        actual_brand: r.actual_brand,
        models: {},
      });
    }
    const photo = photos.get(r.photo_id);
    photo.models[r.model_id] = {
      model_label: r.model_label,
      predicted_brand: r.predicted_brand || null,
      confidence: r.confidence === '' ? null : parseFloat(r.confidence),
      latency_ms: r.latency_ms === '' ? null : parseInt(r.latency_ms, 10),
      input_tokens: r.input_tokens === '' ? null : parseInt(r.input_tokens, 10),
      output_tokens: r.output_tokens === '' ? null : parseInt(r.output_tokens, 10),
      cost_usd: r.cost_usd === '' ? null : parseFloat(r.cost_usd),
      error: r.error || null,
    };
  }

  const modelIds = Array.from(new Set(rows.map((r) => r.model_id))).filter(Boolean);
  const modelLabels = {};
  for (const id of modelIds) {
    modelLabels[id] = rows.find((r) => r.model_id === id)?.model_label ?? id;
  }

  const allBrands = Array.from(new Set([...photos.values()].map((p) => p.actual_brand))).filter(Boolean).sort();

  // Per-model aggregate
  const perModel = {};
  for (const modelId of modelIds) {
    perModel[modelId] = {
      label: modelLabels[modelId],
      total_photos: 0,
      errored: 0,
      correct: 0,
      wrong_brand: 0,
      null_predicted: 0,         // model returned null
      not_in_known_list: 0,      // included in null_predicted, but tracked separately
      // Confidence-bucketed accuracy
      conf_buckets: {
        high:    { total: 0, correct: 0 }, // >= 0.7
        mid:     { total: 0, correct: 0 }, // 0.4 - 0.7
        low:     { total: 0, correct: 0 }, // < 0.4
      },
      // Per-brand accuracy
      per_brand: Object.fromEntries(allBrands.map((b) => [b, { total: 0, correct: 0 }])),
      // Confusion matrix: actual → predicted → count
      confusion: Object.fromEntries(allBrands.map((b) => [b, {}])),
      latencies_ms: [],
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_cost_usd: 0,
      // Calibration: confidence values bucketed by correctness
      // (helps spot models that are over/under-confident)
      conf_when_correct: [],
      conf_when_wrong: [],
    };
  }

  for (const photo of photos.values()) {
    if (!photo.actual_brand) continue;

    for (const modelId of modelIds) {
      const m = photo.models[modelId];
      if (!m) continue;
      const stats = perModel[modelId];
      stats.total_photos += 1;

      if (m.error) {
        stats.errored += 1;
        continue;
      }

      const correct = m.predicted_brand === photo.actual_brand;
      if (correct) {
        stats.correct += 1;
      } else if (m.predicted_brand === null || m.predicted_brand === '') {
        stats.null_predicted += 1;
      } else {
        stats.wrong_brand += 1;
      }

      // Per-brand counters (always increment total for this actual brand)
      stats.per_brand[photo.actual_brand].total += 1;
      if (correct) stats.per_brand[photo.actual_brand].correct += 1;

      // Confusion matrix: count what was predicted (or "null" / "<other>")
      const predictedKey = m.predicted_brand || 'null';
      const actualBucket = stats.confusion[photo.actual_brand];
      actualBucket[predictedKey] = (actualBucket[predictedKey] ?? 0) + 1;

      // Confidence buckets
      if (m.confidence != null) {
        const bucket = m.confidence >= 0.7 ? 'high' : m.confidence >= 0.4 ? 'mid' : 'low';
        stats.conf_buckets[bucket].total += 1;
        if (correct) stats.conf_buckets[bucket].correct += 1;

        if (correct) stats.conf_when_correct.push(m.confidence);
        else stats.conf_when_wrong.push(m.confidence);
      }

      if (m.latency_ms != null) stats.latencies_ms.push(m.latency_ms);
      stats.total_input_tokens += m.input_tokens ?? 0;
      stats.total_output_tokens += m.output_tokens ?? 0;
      stats.total_cost_usd += m.cost_usd ?? 0;
    }
  }

  return { photos, modelIds, modelLabels, allBrands, perModel };
}

// ── Markdown ───────────────────────────────────────────────────────────────

function renderMarkdown(summary, csvPath) {
  const { photos, modelIds, perModel, allBrands } = summary;
  const photoCount = photos.size;

  const lines = [];
  lines.push(`# Logo benchmark — ${path.basename(csvPath)}`);
  lines.push('');
  lines.push(`Photos evaluated: **${photoCount}** · brands present: **${allBrands.length}** (${allBrands.join(', ')})`);
  lines.push('');

  // ── Headline accuracy table
  lines.push('## Headline accuracy');
  lines.push('');
  lines.push('| Model | Correct | Wrong brand | Null | Errored | Accuracy |');
  lines.push('|-------|---------|-------------|------|---------|----------|');
  const ordered = [...modelIds].sort((a, b) => {
    const aAcc = perModel[a].correct / Math.max(1, perModel[a].total_photos - perModel[a].errored);
    const bAcc = perModel[b].correct / Math.max(1, perModel[b].total_photos - perModel[b].errored);
    return bAcc - aAcc;
  });
  for (const id of ordered) {
    const s = perModel[id];
    const denominator = Math.max(1, s.total_photos - s.errored);
    const acc = ((s.correct / denominator) * 100).toFixed(1);
    lines.push(`| ${s.label} | ${s.correct} | ${s.wrong_brand} | ${s.null_predicted} | ${s.errored} | **${acc}%** |`);
  }
  lines.push('');

  // ── Confidence calibration
  lines.push('## Confidence calibration');
  lines.push('');
  lines.push('Higher numbers in the "high-confidence wrong" lane = more dangerous (silent failure mode). Ideally a model that says ≥0.7 confidence is right almost all the time.');
  lines.push('');
  lines.push('| Model | High-conf (≥0.7) acc | Mid-conf (0.4–0.7) acc | Low-conf (<0.4) acc | Avg conf when correct | Avg conf when wrong |');
  lines.push('|-------|----------------------|------------------------|---------------------|-----------------------|---------------------|');
  for (const id of ordered) {
    const s = perModel[id];
    const cell = (b) =>
      b.total === 0 ? '—' : `${b.correct}/${b.total} (${((b.correct / b.total) * 100).toFixed(0)}%)`;
    const avg = (arr) =>
      arr.length === 0 ? '—' : (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2);
    lines.push(`| ${s.label} | ${cell(s.conf_buckets.high)} | ${cell(s.conf_buckets.mid)} | ${cell(s.conf_buckets.low)} | ${avg(s.conf_when_correct)} | ${avg(s.conf_when_wrong)} |`);
  }
  lines.push('');

  // ── Per-brand accuracy
  lines.push('## Per-brand accuracy');
  lines.push('');
  lines.push(`Columns are brands; cells are correct/total per (model, brand). Helps spot brand-specific blind spots — a model that's 95% on Orlen but 30% on BP probably needs prompt tweaks or isn't ready to ship.`);
  lines.push('');
  lines.push(`| Model | ${allBrands.join(' | ')} |`);
  lines.push(`|-------| ${allBrands.map(() => '------').join(' | ')} |`);
  for (const id of ordered) {
    const s = perModel[id];
    const cells = allBrands.map((b) => {
      const v = s.per_brand[b];
      if (v.total === 0) return '—';
      const pct = ((v.correct / v.total) * 100).toFixed(0);
      return `${v.correct}/${v.total} (${pct}%)`;
    });
    lines.push(`| ${s.label} | ${cells.join(' | ')} |`);
  }
  lines.push('');

  // ── Confusion matrix per model (only for models with errors worth investigating)
  lines.push('## Confusion matrices (per-model, actual → predicted)');
  lines.push('');
  lines.push('Rows = actual brand. Columns = predicted brand (incl. `null` for "not identified" and `<other>` for predictions outside the 10 known brands).');
  lines.push('');
  for (const id of ordered) {
    const s = perModel[id];
    if (s.correct === s.total_photos - s.errored) continue; // perfect model — skip matrix
    lines.push(`### ${s.label}`);
    lines.push('');
    // Find all distinct prediction columns across this model
    const predictionKeys = new Set();
    for (const actual of allBrands) {
      for (const pred of Object.keys(s.confusion[actual])) {
        predictionKeys.add(pred);
      }
    }
    const predCols = [...predictionKeys].sort((a, b) => {
      // Place 'null' last for readability
      if (a === 'null') return 1;
      if (b === 'null') return -1;
      return a.localeCompare(b);
    });
    if (predCols.length === 0) {
      lines.push('_No predictions recorded._');
      lines.push('');
      continue;
    }
    lines.push(`| actual ↓ / predicted → | ${predCols.join(' | ')} |`);
    lines.push(`|------------------------| ${predCols.map(() => '---').join(' | ')} |`);
    for (const actual of allBrands) {
      const row = predCols.map((pc) => s.confusion[actual][pc] ?? '');
      lines.push(`| ${actual} | ${row.join(' | ')} |`);
    }
    lines.push('');
  }

  // ── Cost + latency
  lines.push('## Cost & latency');
  lines.push('');
  lines.push('| Model | Photos | Latency p50 | Latency p95 | Avg cost / call | Total cost |');
  lines.push('|-------|--------|-------------|-------------|-----------------|------------|');
  for (const id of ordered) {
    const s = perModel[id];
    const denom = Math.max(1, s.total_photos - s.errored);
    const p50 = percentile(s.latencies_ms, 0.5);
    const p95 = percentile(s.latencies_ms, 0.95);
    const avgCost = s.total_cost_usd / denom;
    lines.push(`| ${s.label} | ${denom} | ${p50}ms | ${p95}ms | $${avgCost.toFixed(5)} | $${s.total_cost_usd.toFixed(4)} |`);
  }
  lines.push('');

  // ── Verdict prompt
  lines.push('## Reading this report');
  lines.push('');
  lines.push('1. **Top-of-table accuracy** is the headline — a 5+ point gap is meaningful, smaller gaps may be sample-size noise on a small corpus.');
  lines.push('2. **Confidence calibration matters more than headline accuracy** for shadow-ban decisions. A model that\'s 90% accurate but with 50% high-confidence wrongs is worse than one that\'s 85% accurate with 5% high-confidence wrongs — the wrong-confident bucket directly drives false-positive shadow bans in production.');
  lines.push('3. **Per-brand evenness** matters too — a model that\'s perfect on Orlen but bad on BP creates an uneven enforcement pattern across the customer base.');
  lines.push('4. **Cost + latency** are tie-breakers, not primary inputs. The whole logo recognition pipeline is gated by `confidence < 0.4` thresholds, so a 30% cheaper model with the same accuracy + calibration is a clean win.');

  return lines.join('\n') + '\n';
}

function percentile(values, p) {
  if (values.length === 0) return '—';
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

// ── CSV picker ─────────────────────────────────────────────────────────────

function pickCsvPath(arg) {
  if (arg) {
    return path.isAbsolute(arg) ? arg : path.join(DATA_DIR, arg);
  }
  // Newest logo-runs-* CSV
  const files = readdirSync(DATA_DIR)
    .filter((f) => f.startsWith('logo-runs-') && f.endsWith('.csv'))
    .sort()
    .reverse();
  if (files.length === 0) {
    throw new Error(`No logo-runs-*.csv in ${DATA_DIR} — run run-logo-benchmark.mjs first`);
  }
  return path.join(DATA_DIR, files[0]);
}

function safeParseJson(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}
