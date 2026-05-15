// Brand pattern list — order matters (most specific first).
// Auchan/Carrefour before generic patterns; bp/orlen last to avoid false matches.
// Add new brands here without changing service logic.
//
// Story 2.19 (2026-05-15) — added pieprzyk and avia to close AC11 coverage
// for the chain filter UI. Both use word-boundary matches to avoid false
// positives (`avia` is short enough to embed in other strings like
// "Saviano" or "Aviapark"; pieprzyk is uniquely Polish but pinning it
// with \b matches future stylings like "Stacja Pieprzyk").
export const BRAND_PATTERNS: { pattern: RegExp; brand: string }[] = [
  { pattern: /auchan/i, brand: 'auchan' },
  { pattern: /carrefour/i, brand: 'carrefour' },
  { pattern: /circle\s*k/i, brand: 'circle_k' },
  { pattern: /huzar/i, brand: 'huzar' },
  { pattern: /moya/i, brand: 'moya' },
  { pattern: /\bamic\b/i, brand: 'amic' },
  { pattern: /lotos/i, brand: 'lotos' },
  { pattern: /\bpieprzyk\b/i, brand: 'pieprzyk' },
  { pattern: /\bavia\b/i, brand: 'avia' },
  { pattern: /\bshell\b/i, brand: 'shell' },
  { pattern: /\bbp\b/i, brand: 'bp' },
  { pattern: /orlen/i, brand: 'orlen' },
];
