#!/usr/bin/env node
/**
 * Bulk-approve all shadow_rejected submissions using their existing OCR'd
 * price_data. Use after fixing a validation rule that was wrongly blocking
 * good submissions — the requeue path can't bypass the photo-hash dedup,
 * but admin approve writes prices directly via PriceService.setVerifiedPrice.
 *
 * Usage (from repo root):
 *   node _bmad-output/scripts/approve-shadow-rejected.mjs
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
const APPROVE_DELAY_MS = 6_000;
const RETRY_BACKOFF_MS = 30_000;
const MAX_RETRIES = 3;

const rl = readline.createInterface({ input, output });
const ask = (q) => rl.question(q);

main().catch((e) => {
  console.error(`\n✗ ${e.message}`);
  rl.close();
  process.exit(1);
});

async function main() {
  console.log(`API: ${API}`);
  const token = await login();
  console.log('✓ Logged in\n');

  console.log('Listing shadow_rejected submissions...');
  const submissions = await listAllShadowRejected(token);
  if (submissions.length === 0) {
    console.log('No shadow_rejected submissions to approve.');
    rl.close();
    return;
  }
  console.log(`Found ${submissions.length} shadow_rejected submission(s).\n`);

  for (let i = 0; i < submissions.length; i++) {
    const s = submissions[i];
    const label = `[${i + 1}/${submissions.length}] ${s.id.slice(0, 8)} — ${s.station_name ?? '(no station)'}`;
    try {
      await approve(token, s.id);
      console.log(`  ✓ ${label}`);
    } catch (err) {
      console.log(`  ✗ ${label} — ${err.message}`);
    }
    if (i < submissions.length - 1) {
      await sleep(APPROVE_DELAY_MS);
    }
  }

  console.log('\nDone. Approved submissions are verified and prices written to cache.');
  rl.close();
}

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

async function listAllShadowRejected(token) {
  const all = [];
  let page = 1;
  while (true) {
    const res = await fetch(
      `${API}/v1/admin/submissions?page=${page}&limit=${PAGE_SIZE}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new Error(`list (${res.status}): ${await res.text()}`);
    const body = await res.json();
    const data = body.data ?? [];
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    page += 1;
  }
  return all;
}

async function approve(token, submissionId, attempt = 1) {
  const res = await fetch(`${API}/v1/admin/submissions/${submissionId}/approve`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    // Empty body — approve uses the submission's existing price_data
    body: JSON.stringify({}),
  });
  if (res.ok) return;

  if (res.status === 429 && attempt <= MAX_RETRIES) {
    console.log(`    429 throttled — backing off ${RETRY_BACKOFF_MS / 1000}s before retry ${attempt + 1}/${MAX_RETRIES + 1}...`);
    await sleep(RETRY_BACKOFF_MS);
    return approve(token, submissionId, attempt + 1);
  }
  throw new Error(`approve (${res.status}): ${await res.text()}`);
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
