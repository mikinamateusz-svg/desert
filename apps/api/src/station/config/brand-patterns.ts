// Brand pattern list — order matters (most specific first).
// Auchan/Carrefour before generic patterns; bp/orlen last to avoid false matches.
// Add new brands here without changing service logic.
export const BRAND_PATTERNS: { pattern: RegExp; brand: string }[] = [
  { pattern: /auchan/i, brand: 'auchan' },
  { pattern: /carrefour/i, brand: 'carrefour' },
  { pattern: /circle\s*k/i, brand: 'circle_k' },
  { pattern: /huzar/i, brand: 'huzar' },
  { pattern: /moya/i, brand: 'moya' },
  { pattern: /\bamic\b/i, brand: 'amic' },
  { pattern: /lotos/i, brand: 'lotos' },
  { pattern: /\bshell\b/i, brand: 'shell' },
  { pattern: /\bbp\b/i, brand: 'bp' },
  { pattern: /orlen/i, brand: 'orlen' },
];
