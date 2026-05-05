#!/usr/bin/env node
/**
 * One-shot helper: log in as admin and refresh price caches for one or more
 * stations. Use after a manual SQL fix (e.g. moving a submission between
 * stations) so the displayed prices reflect the new state.
 *
 * Usage:
 *   node _bmad-output/scripts/refresh-station-caches.mjs <stationId> [stationId...]
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

const stationIds = process.argv.slice(2);
if (stationIds.length === 0) {
  console.error('Usage: node refresh-station-caches.mjs <stationId> [stationId...]');
  process.exit(1);
}

const rl = readline.createInterface({ input, output });

main().catch((e) => {
  console.error(`✗ ${e.message}`);
  rl.close();
  process.exit(1);
});

async function main() {
  console.log(`API: ${API}`);
  let email = process.env.ADMIN_EMAIL;
  if (!email) email = (await rl.question('Admin email: ')).trim();
  let password = process.env.ADMIN_PASSWORD;
  if (!password) password = (await rl.question('Admin password: ')).trim();

  const loginRes = await fetch(`${API}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!loginRes.ok) throw new Error(`Login failed (${loginRes.status})`);
  const { accessToken } = await loginRes.json();
  console.log('✓ Logged in\n');

  for (const id of stationIds) {
    const res = await fetch(`${API}/v1/admin/stations/${id}/refresh-cache`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) {
      console.log(`  ✓ ${id} — cache refreshed`);
    } else {
      console.log(`  ✗ ${id} — ${res.status}: ${await res.text()}`);
    }
  }
  rl.close();
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
