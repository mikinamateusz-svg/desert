/**
 * Generates icon.png and adaptive-icon.png for the Litro mobile app.
 *
 * The gauge is reconstructed from the LitroWordmark SVG component:
 *  - Green→amber→red arc (150° → 30° clockwise, 240° span)
 *  - Needle pointing into the green zone (at 210°)
 *  - Dark colour scheme (white on #1a1a1a)
 *
 * Outputs:
 *  - apps/mobile/assets/icon.png          1024×1024  (dark bg + gauge, for iOS)
 *  - apps/mobile/assets/adaptive-icon.png 1024×1024  (transparent + gauge, for Android)
 */

import sharp from 'sharp';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.resolve(__dirname, '../assets');

// ── Geometry helpers ──────────────────────────────────────────────────────────

const toRad = (deg) => (deg * Math.PI) / 180;

function arcPoint(cx, cy, r, deg) {
  return {
    x: cx + r * Math.cos(toRad(deg)),
    y: cy + r * Math.sin(toRad(deg)),
  };
}

/** SVG path for the gauge arc from startDeg to endDeg (clockwise, large arc). */
function arcPath(cx, cy, r, startDeg, endDeg) {
  const s = arcPoint(cx, cy, r, startDeg);
  const e = arcPoint(cx, cy, r, endDeg);
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 1 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
}

// ── Build SVG ─────────────────────────────────────────────────────────────────

function buildGaugeSvg({ size, withBackground, gaugeRadius }) {
  const cx = size / 2;
  const cy = size / 2;
  const r  = gaugeRadius;

  const trackW    = r * 0.28;
  const needleLen = r * 0.72;
  const pivotR    = trackW * 0.75;
  const needleW   = trackW * 0.55;

  const arc  = arcPath(cx, cy, r, 150, 30);
  const tip  = arcPoint(cx, cy, needleLen, 210);

  const bg = withBackground
    ? `<rect width="${size}" height="${size}" fill="#1a1a1a"/>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="#22c55e"/>
      <stop offset="48%"  stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#ef4444"/>
    </linearGradient>
  </defs>

  ${bg}

  <!-- Gauge face -->
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="#222222" stroke="#2a2a2a" stroke-width="1"/>

  <!-- Track arc (background) -->
  <path d="${arc}" fill="none" stroke="#2a2a2a"   stroke-width="${trackW.toFixed(2)}" stroke-linecap="round"/>

  <!-- Coloured arc -->
  <path d="${arc}" fill="none" stroke="url(#g)" stroke-width="${trackW.toFixed(2)}" stroke-linecap="round"/>

  <!-- Needle -->
  <line x1="${cx}" y1="${cy}" x2="${tip.x.toFixed(2)}" y2="${tip.y.toFixed(2)}"
        stroke="#ffffff" stroke-width="${needleW.toFixed(2)}" stroke-linecap="round"/>

  <!-- Pivot -->
  <circle cx="${cx}" cy="${cy}" r="${pivotR.toFixed(2)}" fill="#ffffff"/>
</svg>`;
}

// ── Render ────────────────────────────────────────────────────────────────────

async function render(svgString, outputPath) {
  await sharp(Buffer.from(svgString))
    .png()
    .toFile(outputPath);
  console.log(`✓  ${outputPath}`);
}

async function main() {
  // icon.png — 1024×1024 with dark background (iOS + fallback)
  await render(
    buildGaugeSvg({ size: 1024, withBackground: true,  gaugeRadius: 380 }),
    path.join(assetsDir, 'icon.png'),
  );

  // adaptive-icon.png — 1024×1024 transparent foreground (Android composites #1a1a1a bg)
  // Gauge radius 300 keeps the graphic inside the Android safe zone (66% = 678px / 2 = 339px)
  await render(
    buildGaugeSvg({ size: 1024, withBackground: false, gaugeRadius: 300 }),
    path.join(assetsDir, 'adaptive-icon.png'),
  );
}

main().catch((err) => { console.error(err); process.exit(1); });
