#!/usr/bin/env node
/**
 * Repair orphaned ResearchPhoto R2 objects. The requeue rollback bug
 * deleted the research-bucket copy while leaving the DB row intact;
 * this script re-copies from each submission's photo_r2_key. Source
 * photo must still exist in R2 (the original submission's bucket).
 *
 * Usage (from repo root):
 *   node _bmad-output/scripts/repair-research-photos.mjs
 *
 * Reads from .env.local:
 *   API_URL          — defaults to prod
 *   ADMIN_EMAIL/PASS — prompts otherwise
 */

import { readFileSync, existsSync } from 'node:fs';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
loadEnvFile(path.join(REPO_ROOT, '.env.local'));

const API = process.env.API_URL ?? 'https://desert-production-ac37.up.railway.app';
const PAGE_SIZE = 100;
const REPAIR_DELAY_MS = 6_000;
const RETRY_BACKOFF_MS = 30_000;
const MAX_RETRIES = 3;

// Submissions whose ResearchPhoto rows are known orphaned (rollback bug victims).
const ORPHANED_SUBMISSION_IDS = new Set([
  // Today's recovered batch
  '98592d5e-6e69-43ff-ba23-b88ad12af668',
  '5cd36093-2f47-4221-af65-2b8f4d99f9c4',
  '987b7516-d175-489f-af21-599e6f2ca110',
  '83226b7d-de9a-45fb-998f-0144e59c0f85',
  'c288bcfc-872c-4b33-ae4b-b8e352224901',
  '52b785de-163b-4e33-bd4b-ccb084b438a9',
  '51d2fdd6-52b5-417e-8d09-4f0129cff5de',
  '637b81b8-5a6c-4cce-a39b-3bbc51e666ac',
  // Yesterday's batch we requeued
  'e8c12c3c-26f6-4c02-9785-02abebefd0b8',
  'ac3f3dcd-2899-4554-b4fa-802a6ec6217b',
  '6ff93496-fecf-4be5-9102-73ab45e2600e',
  'dbb123ad-7bf2-4dec-aef7-9dd523c83af2',
  'ebb5e48e-326a-4b8c-a337-72fd0b6dff5b',
  '1d1767ac-93d3-4a86-8cba-00c82c9b65e5',
  'b5f4a2b9-0793-4452-ba25-36e2d0a62926',
  'fb473b80-5057-4d72-8ddf-4e5003e4a63b',
]);

const rl = readline.createInterface({ input, output });

main().catch((e) => {
  console.error(`✗ ${e.message}`);
  rl.close();
  process.exit(1);
});

async function main() {
  console.log(`API: ${API}`);
  const token = await login();
  console.log('✓ Logged in\n');

  console.log('Fetching ResearchPhoto rows...');
  const photos = await listAllPhotos(token);
  const candidates = photos.filter((p) => ORPHANED_SUBMISSION_IDS.has(p.submission_id));
  console.log(`Matched ${candidates.length}/${ORPHANED_SUBMISSION_IDS.size} orphaned rows.\n`);

  for (let i = 0; i < candidates.length; i++) {
    const photo = candidates[i];
    const label = `[${i + 1}/${candidates.length}] ${photo.id.slice(0, 8)} (sub ${photo.submission_id.slice(0, 8)}) — ${photo.station_name ?? '(no station)'}`;
    try {
      await repair(token, photo.id);
      console.log(`  ✓ ${label}`);
    } catch (err) {
      console.log(`  ✗ ${label} — ${err.message}`);
    }
    if (i < candidates.length - 1) await sleep(REPAIR_DELAY_MS);
  }

  console.log('\nDone. Photos should now be downloadable for labeling/benchmarking.');
  rl.close();
}

async function login() {
  let email = process.env.ADMIN_EMAIL;
  if (!email) email = (await rl.question('Admin email: ')).trim();
  let password = process.env.ADMIN_PASSWORD;
  if (!password) password = (await rl.question('Admin password: ')).trim();

  const res = await fetch(`${API}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Login failed (${res.status})`);
  const { accessToken } = await res.json();
  return accessToken;
}

async function listAllPhotos(token) {
  const all = [];
  let offset = 0;
  while (true) {
    const res = await fetch(
      `${API}/v1/admin/research/photos?limit=${PAGE_SIZE}&offset=${offset}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new Error(`list (${res.status}): ${await res.text()}`);
    const body = await res.json();
    const data = body.data ?? [];
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

async function repair(token, photoId, attempt = 1) {
  const res = await fetch(`${API}/v1/admin/research/photos/${photoId}/repair-r2`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.ok) return;

  if (res.status === 429 && attempt <= MAX_RETRIES) {
    console.log(`    429 throttled — backing off ${RETRY_BACKOFF_MS / 1000}s before retry ${attempt + 1}/${MAX_RETRIES + 1}...`);
    await sleep(RETRY_BACKOFF_MS);
    return repair(token, photoId, attempt + 1);
  }
  throw new Error(`repair (${res.status}): ${await res.text()}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
