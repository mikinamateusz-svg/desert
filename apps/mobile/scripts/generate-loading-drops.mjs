/**
 * Generate 4 static PNG images of the fuel drop at different fill levels.
 * Uses sharp to render SVG → PNG at 3x resolution for crisp display.
 *
 * Usage: node scripts/generate-loading-drops.mjs
 */
import sharp from 'sharp';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'assets', 'loading');

mkdirSync(OUT_DIR, { recursive: true });

const WIDTH = 180;   // 60pt × 3x
const HEIGHT = 240;  // 80pt × 3x

const fills = [
  { name: 'drop-0', pct: 0 },
  { name: 'drop-40', pct: 0.4 },
  { name: 'drop-75', pct: 0.75 },
  { name: 'drop-100', pct: 1.0 },
];

// Teardrop path scaled to 180×240
// Original 60×80 path: M30 0 C30 0 60 30 60 50 C60 66.57 46.57 80 30 80 C13.43 80 0 66.57 0 50 C0 30 30 0 30 0Z
const dropPath = 'M90 0 C90 0 180 90 180 150 C180 199.71 139.71 240 90 240 C40.29 240 0 199.71 0 150 C0 90 90 0 90 0Z';

function makeSvg(fillPct) {
  const fillH = Math.round(HEIGHT * fillPct);
  const fillY = HEIGHT - fillH;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <clipPath id="drop">
      <path d="${dropPath}"/>
    </clipPath>
    <linearGradient id="fillGrad" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0%" stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#fbbf24"/>
    </linearGradient>
  </defs>
  <!-- Background -->
  <path d="${dropPath}" fill="#e5e5e5"/>
  <!-- Fill -->
  <g clip-path="url(#drop)">
    <rect x="0" y="${fillY}" width="${WIDTH}" height="${fillH}" fill="url(#fillGrad)"/>
  </g>
  <!-- Outline -->
  <path d="${dropPath}" fill="none" stroke="#9ca3af" stroke-width="4"/>
</svg>`;
}

for (const { name, pct } of fills) {
  const svg = makeSvg(pct);
  const outPath = join(OUT_DIR, `${name}.png`);
  await sharp(Buffer.from(svg)).png().toFile(outPath);
  console.log(`Generated ${outPath}`);
}

console.log('Done — 4 drop images generated.');
