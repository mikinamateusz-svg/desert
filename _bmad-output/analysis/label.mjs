#!/usr/bin/env node
/**
 * Interactive labeling helper for the OCR research corpus.
 *
 * Walks through every unlabeled ResearchPhoto in production:
 *  - opens the photo URL in your default browser
 *  - prompts you for the actual prices on the sign (one fuel at a time)
 *  - PATCHes the labels back so the benchmark harness has ground truth
 *
 * Usage (from repo root):
 *   node _bmad-output/analysis/label.mjs
 *
 * Reads from repo-root .env.local:
 *   API_URL          (optional, defaults to production Railway URL)
 *   ADMIN_EMAIL      (optional, prompts if missing)
 *   ADMIN_PASSWORD   (optional, prompts if missing)
 *
 * No npm dependencies — uses Node 20+ built-ins only (fetch, readline/promises).
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

// ── Setup ──────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// Load .env.local manually to avoid an npm dependency
loadEnvFile(path.join(REPO_ROOT, '.env.local'));

const API = process.env.API_URL ?? 'https://desert-production-ac37.up.railway.app';
const FUELS = ['PB_95', 'PB_98', 'ON', 'ON_PREMIUM', 'LPG'];

// Temp dir for downloaded photos. Cleaned up at the end of the session so
// we don't leave random pylon photos lying around between runs.
const TMP_DIR = path.join(os.tmpdir(), 'desert-research-photos');
mkdirSync(TMP_DIR, { recursive: true });

const rl = readline.createInterface({ input, output });
const ask = (q) => rl.question(q);

// ── Main ───────────────────────────────────────────────────────────────────

main().catch((e) => {
  console.error(`\n✗ ${e.message}`);
  rl.close();
  process.exit(1);
});

async function main() {
  console.log(`API: ${API}`);
  console.log('Logging in...');
  const token = await login();
  console.log('✓ Logged in\n');

  console.log('Fetching unlabeled photos...');
  const photos = await fetchUnlabeled(token);
  if (photos.length === 0) {
    console.log('All photos already labeled. Nothing to do.');
    rl.close();
    return;
  }
  console.log(`Found ${photos.length} unlabeled photo${photos.length === 1 ? '' : 's'}.\n`);

  let labeled = 0;
  let skipped = 0;
  for (let i = 0; i < photos.length; i++) {
    const result = await labelOne(token, photos[i], i + 1, photos.length);
    if (result === 'abandon') {
      console.log('\nAbandoned. Re-run anytime to continue from where you stopped.');
      break;
    }
    if (result === 'labeled') labeled++;
    else if (result === 'skipped') skipped++;
  }

  console.log(`\n──────────────────────────────────────────────────────`);
  console.log(`Done. Labeled ${labeled}, skipped ${skipped}.`);
  rl.close();

  // Clean up downloaded photos. Soft-fail — fine if Windows still has the
  // image open in the viewer; user can ignore the temp leak.
  try {
    rmSync(TMP_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

// ── Per-photo flow ─────────────────────────────────────────────────────────

async function labelOne(token, photo, idx, total) {
  console.log('\n──────────────────────────────────────────────────────');
  console.log(`Photo ${idx}/${total}  ·  id ${photo.id.slice(0, 8)}`);
  console.log(`Status:    ${photo.final_status}${photo.flag_reason ? ` — ${photo.flag_reason}` : ''}`);
  console.log(`Captured:  ${photo.captured_at}`);
  if (photo.station_name) console.log(`Station:   ${photo.station_name}`);
  if (photo.gps_lat != null) console.log(`GPS:       ${photo.gps_lat}, ${photo.gps_lng}`);
  console.log(`OCR saw:   ${formatPrices(photo.ocr_prices)}`);
  if (photo.final_prices) console.log(`Verified:  ${formatPrices(photo.final_prices)}`);

  // Download the photo via the authenticated proxy endpoint and open the
  // local file. R2 presigned URLs proved fragile against AWS SDK v3 quirks,
  // so direct API GET → temp file → default app is the reliable path.
  let localPath = null;
  try {
    localPath = await downloadPhoto(token, photo.id);
    console.log('Opening photo...');
    openInBrowser(localPath);
  } catch (err) {
    console.log(`(Couldn't fetch photo: ${err.message}. Labeling without preview.)`);
  }

  console.log('\nEnter the prices ACTUALLY shown on the sign. Press Enter to skip a fuel.');
  console.log('Type "abandon" at any prompt to stop the whole session.');

  const actual = {};
  for (const fuel of FUELS) {
    const v = (await ask(`  ${fuel}: `)).trim();
    if (v === '') continue;
    if (v.toLowerCase() === 'abandon') return 'abandon';
    const num = parseFloat(v.replace(',', '.'));
    if (Number.isFinite(num) && num > 0 && num < 20) {
      actual[fuel] = num;
    } else {
      console.log(`  → '${v}' isn't a plausible PLN/l price, skipping ${fuel}`);
    }
  }

  const notesIn = (await ask('  Notes (optional, e.g. "blurry"): ')).trim();
  if (notesIn.toLowerCase() === 'abandon') return 'abandon';
  const notes = notesIn || null;

  if (Object.keys(actual).length === 0 && !notes) {
    const ans = (await ask('  No prices entered. (s)kip / (a)bandon / (e)mpty-label? [s] ')).trim().toLowerCase();
    if (ans.startsWith('a')) return 'abandon';
    if (ans.startsWith('e')) {
      // Empty actual_prices = "I looked at the photo, no fuel prices were visible"
      // Useful for non-station photos (e.g. tested from home) so they don't
      // keep showing up as unlabeled.
      await patchLabel(token, photo.id, {}, notes);
      console.log('  → labeled as empty (no prices on sign)');
      return 'labeled';
    }
    console.log('  → skipped (will reappear next run)');
    return 'skipped';
  }

  await patchLabel(token, photo.id, actual, notes);
  console.log(`  ✓ labeled ${Object.keys(actual).length} fuel${Object.keys(actual).length === 1 ? '' : 's'}`);
  return 'labeled';
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
  if (!res.ok) {
    throw new Error(`Login failed (${res.status}): ${await res.text()}`);
  }
  const body = await res.json();
  if (!body.accessToken) throw new Error('Login response missing accessToken');
  if (body.user?.role !== 'ADMIN') {
    throw new Error(`Logged in as role=${body.user?.role}; ADMIN required`);
  }
  return body.accessToken;
}

async function fetchUnlabeled(token) {
  const res = await fetch(`${API}/v1/admin/research/photos?unlabeled=true&limit=100`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`fetchUnlabeled (${res.status}): ${await res.text()}`);
  const body = await res.json();
  return body.data ?? [];
}

async function downloadPhoto(token, photoId) {
  const res = await fetch(`${API}/v1/admin/research/photos/${photoId}/photo`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`download (${res.status}): ${await res.text().catch(() => '')}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const dest = path.join(TMP_DIR, `${photoId}.jpg`);
  writeFileSync(dest, buf);
  return dest;
}

async function patchLabel(token, id, actualPrices, notes) {
  const res = await fetch(`${API}/v1/admin/research/photos/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ actual_prices: actualPrices, label_notes: notes }),
  });
  if (!res.ok) throw new Error(`patchLabel ${id} (${res.status}): ${await res.text()}`);
}

// ── Tiny utils ─────────────────────────────────────────────────────────────

function formatPrices(prices) {
  if (!prices) return '∅';
  if (Array.isArray(prices)) {
    if (prices.length === 0) return '∅ (none extracted)';
    return prices
      .map((p) => `${p.fuel_type}=${typeof p.price_per_litre === 'number' ? p.price_per_litre.toFixed(2) : p.price_per_litre}`)
      .join(', ');
  }
  if (typeof prices === 'object') {
    const entries = Object.entries(prices);
    if (entries.length === 0) return '∅';
    return entries.map(([k, v]) => `${k}=${typeof v === 'number' ? v.toFixed(2) : v}`).join(', ');
  }
  return String(prices);
}

function openInBrowser(url) {
  // Cross-platform open. Detached so the spawn doesn't keep our process alive
  // when it eventually exits.
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore' }).unref();
  } else if (process.platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  }
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
