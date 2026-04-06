/**
 * Generate mobile icon and splash PNG assets from Concept B (gauge) SVG.
 * Run from the repo root: node apps/mobile/scripts/generate-assets.mjs
 *
 * Requires: sharp (globally or via npx)
 *   node -e "require('sharp')"   ← should print nothing if available
 */

import sharp from 'sharp';
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(__dir, '..', 'assets');

// ─── helpers ────────────────────────────────────────────────────────────────

function deg(d) { return d * Math.PI / 180; }

/**
 * Build the gauge-arc SVG path string.
 * Arc runs from 150° → 30° clockwise over the top (like a speedometer).
 */
function gaugeSvg({ size, bg = '#1a1a1a', pad = 0 }) {
  const cx = size / 2;
  const cy = size / 2;
  const r  = size * 0.34;           // radius (leaves room for stroke + padding)
  const tw = r * 0.28;              // track / stroke width

  const ax1 = cx + r * Math.cos(deg(150));
  const ay1 = cy + r * Math.sin(deg(150));
  const ax2 = cx + r * Math.cos(deg(30));
  const ay2 = cy + r * Math.sin(deg(30));
  const arc = `M ${ax1.toFixed(1)} ${ay1.toFixed(1)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 1 1 ${ax2.toFixed(1)} ${ay2.toFixed(1)}`;

  const nl  = r * 0.72;             // needle length
  const nx  = (cx + nl * Math.cos(deg(210))).toFixed(1);
  const ny  = (cy + nl * Math.sin(deg(210))).toFixed(1);

  const pivotR = (tw * 0.75).toFixed(1);
  const gradId = 'gg';

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <defs>
    <linearGradient id="${gradId}" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="#22c55e"/>
      <stop offset="48%"  stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#ef4444"/>
    </linearGradient>
  </defs>

  <!-- background -->
  <rect width="${size}" height="${size}" fill="${bg}"/>

  <!-- gauge ring (thin outline circle) -->
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#333333" stroke-width="${(tw * 0.3).toFixed(1)}"/>

  <!-- coloured arc -->
  <path d="${arc}" fill="none" stroke="url(#${gradId})" stroke-width="${tw.toFixed(1)}" stroke-linecap="round"/>

  <!-- needle -->
  <line x1="${cx}" y1="${cy}" x2="${nx}" y2="${ny}"
        stroke="white" stroke-width="${(tw * 0.55).toFixed(1)}" stroke-linecap="round"/>

  <!-- pivot -->
  <circle cx="${cx}" cy="${cy}" r="${pivotR}" fill="white"/>
</svg>`.trim();
}

function splashSvg({ w, h }) {
  // Centred gauge wordmark on dark background.
  // SVG text for "litr" + gauge dial side by side.
  const fontSize = Math.round(h * 0.065);   // ≈ 6.5% of splash height
  const baseline = Math.round(h / 2 + fontSize * 0.25);
  const xH       = fontSize * 0.60;
  const r        = xH / 2;
  const tw       = r * 0.28;

  // Approximate "litr" text width in Arial Black at fontSize
  const approxTextW = Math.round((91 / 52) * fontSize);
  const totalW      = approxTextW + r * 2 + tw * 2 + 4;
  const startX      = (w - totalW) / 2;

  const cx = startX + approxTextW + r + 1;
  const cy = baseline - xH / 2;

  const toRad = (d) => d * Math.PI / 180;
  const ax1 = cx + r * Math.cos(toRad(150));
  const ay1 = cy + r * Math.sin(toRad(150));
  const ax2 = cx + r * Math.cos(toRad(30));
  const ay2 = cy + r * Math.sin(toRad(30));
  const arc = `M ${ax1.toFixed(1)} ${ay1.toFixed(1)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 1 1 ${ax2.toFixed(1)} ${ay2.toFixed(1)}`;

  const nl = r * 0.72;
  const nx = (cx + nl * Math.cos(toRad(210))).toFixed(1);
  const ny = (cy + nl * Math.sin(toRad(210))).toFixed(1);
  const pivotR = (tw * 0.75).toFixed(1);

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
  <defs>
    <linearGradient id="sg" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="#22c55e"/>
      <stop offset="48%"  stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#ef4444"/>
    </linearGradient>
  </defs>

  <!-- background -->
  <rect width="${w}" height="${h}" fill="#1a1a1a"/>

  <!-- "litr" text -->
  <text x="${startX.toFixed(1)}" y="${baseline}"
        font-family="Arial Black, Arial, sans-serif"
        font-weight="900" font-size="${fontSize}" fill="white" letter-spacing="-1">litr</text>

  <!-- gauge ring (thin outline circle) -->
  <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}"
          fill="none" stroke="#333" stroke-width="1"/>

  <!-- coloured arc -->
  <path d="${arc}" fill="none" stroke="url(#sg)" stroke-width="${tw.toFixed(1)}" stroke-linecap="round"/>

  <!-- needle -->
  <line x1="${cx.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${nx}" y2="${ny}"
        stroke="white" stroke-width="${(tw * 0.55).toFixed(1)}" stroke-linecap="round"/>

  <!-- pivot -->
  <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${pivotR}" fill="white"/>
</svg>`.trim();
}

// ─── generate assets ────────────────────────────────────────────────────────

async function run() {
  // icon.png — 1024×1024, gauge on dark background
  await sharp(Buffer.from(gaugeSvg({ size: 1024 })))
    .png()
    .toFile(join(ASSETS, 'icon.png'));
  console.log('✓ icon.png');

  // adaptive-icon.png — 1024×1024 with slightly smaller gauge (Android adds its own padding)
  const adaptiveSvg = gaugeSvg({ size: 1024, pad: 80 }).replace(
    '<rect width="1024" height="1024" fill="#1a1a1a"/>',
    '<rect width="1024" height="1024" fill="#1a1a1a"/>',
  );
  await sharp(Buffer.from(adaptiveSvg))
    .png()
    .toFile(join(ASSETS, 'adaptive-icon.png'));
  console.log('✓ adaptive-icon.png');

  // splash.png — 1284×2778 (iPhone Pro Max), centred wordmark on dark bg
  await sharp(Buffer.from(splashSvg({ w: 1284, h: 2778 })))
    .png()
    .toFile(join(ASSETS, 'splash.png'));
  console.log('✓ splash.png');

  console.log('\nAll assets written to apps/mobile/assets/');
}

run().catch(err => { console.error(err); process.exit(1); });
