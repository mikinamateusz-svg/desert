import Svg, { Line, Path, Rect } from 'react-native-svg';
import { tokens } from '../../../theme';

/**
 * Story 1.14 Card 3 — Pillar 3: Personal spend log.
 *
 * Visual concept (per amended spec 2026-05-10): simple receipt + fillup-
 * card iconography on the left, with a small ascending mini-bar chart
 * on the right hinting at month-to-month spend visibility. Avoid being
 * too "fintech" — keep it utilitarian.
 *
 * Single brand-accent colour on a neutral receipt; the chart bars use
 * the same accent to tie the two halves together.
 *
 * v1 placeholder — see Card1Illustration for the swap-pattern note.
 */
const SIZE_W = 200;
const SIZE_H = 140;

export function Card3Illustration() {
  return (
    <Svg width={SIZE_W} height={SIZE_H} viewBox="0 0 200 140" fill="none">
      {/* ── LEFT: receipt ───────────────────────────────────────────────── */}
      {/* Receipt body with zig-zag tear at the bottom edge. */}
      <Path
        d="M 24 14 L 92 14 L 92 110 L 88 116 L 82 110 L 76 116 L 70 110 L 64 116 L 58 110 L 52 116 L 46 110 L 40 116 L 34 110 L 28 116 L 24 110 Z"
        fill={tokens.surface.card}
        stroke={tokens.brand.ink}
        strokeWidth="2"
      />
      {/* Receipt content — 4 horizontal lines representing line items */}
      <Line x1="32" y1="32" x2="84" y2="32" stroke={tokens.brand.ink} strokeWidth="2" />
      <Line x1="32" y1="46" x2="76" y2="46" stroke={tokens.neutral.n400} strokeWidth="1.5" />
      <Line x1="32" y1="58" x2="84" y2="58" stroke={tokens.neutral.n400} strokeWidth="1.5" />
      <Line x1="32" y1="70" x2="68" y2="70" stroke={tokens.neutral.n400} strokeWidth="1.5" />

      {/* Separator before total */}
      <Line x1="32" y1="84" x2="84" y2="84" stroke={tokens.brand.ink} strokeWidth="1" strokeDasharray="2 2" />
      {/* "Total" line emphasised */}
      <Line x1="32" y1="96" x2="84" y2="96" stroke={tokens.brand.accent} strokeWidth="3" strokeLinecap="round" />

      {/* ── RIGHT: ascending mini-bar chart (month-to-month trend) ───── */}
      {/* Baseline */}
      <Line x1="120" y1="100" x2="184" y2="100" stroke={tokens.neutral.n200} strokeWidth="1.5" />

      {/* Three ascending bars representing improving spend insight */}
      <Rect x="124" y="74" width="14" height="26" fill={tokens.brand.accent} opacity="0.4" />
      <Rect x="146" y="58" width="14" height="42" fill={tokens.brand.accent} opacity="0.7" />
      <Rect x="168" y="40" width="14" height="60" fill={tokens.brand.accent} />

      {/* Small upward arrow above the tallest bar — savings up */}
      <Path
        d="M 171 32 L 175 26 L 179 32"
        stroke={tokens.brand.accent}
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
