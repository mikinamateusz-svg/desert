import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import { tokens } from '../../../theme';

/**
 * Story 1.14 Card 2 — Pillar 4: Predictive price alerts.
 *
 * Visual concept (per amended spec 2026-05-10): bell or notification
 * glyph paired with a subtle upward-trend line + arrow, hinting at
 * "we anticipate price changes." Clean, minimal — no chart noise.
 *
 * Deliberately omits any "+30 dni" badge or "premium" framing — alerts
 * are core, not a tier; the 30-day unlock surfaces in-app at first
 * verified photo, NOT here. (See Story 6.13 — "Premium" framing was
 * retired across the entire alerts loop.)
 *
 * v1 placeholder — see Card1Illustration for the swap-pattern note.
 */
const SIZE = 160;

export function Card2Illustration() {
  return (
    <Svg width={SIZE} height={SIZE} viewBox="0 0 160 160" fill="none">
      {/* ── Bell ───────────────────────────────────────────────────────── */}
      {/* Bell top knob */}
      <Rect x="56" y="38" width="8" height="10" rx="2" fill={tokens.brand.accent} />
      {/* Bell body */}
      <Path
        d="M 30 80 Q 30 46 60 46 Q 90 46 90 80 L 96 90 L 24 90 Z"
        fill={tokens.brand.accent}
      />
      {/* Bell clapper */}
      <Circle cx="60" cy="96" r="5" fill={tokens.brand.accent} />

      {/* ── Upward trend line on the right (the "we anticipate" cue) ──── */}
      {/* Baseline */}
      <Line x1="100" y1="120" x2="148" y2="120" stroke={tokens.neutral.n200} strokeWidth="1.5" />

      {/* Trend path — ascending zigzag with three notes */}
      <Path
        d="M 102 108 L 116 96 L 128 82 L 142 64"
        stroke={tokens.brand.accent}
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Arrowhead at the trend's apex */}
      <Path
        d="M 136 64 L 142 60 L 144 68"
        stroke={tokens.brand.accent}
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Three small dots along the trend line — sample data points */}
      <Circle cx="102" cy="108" r="3" fill={tokens.brand.accent} />
      <Circle cx="116" cy="96" r="3" fill={tokens.brand.accent} />
      <Circle cx="128" cy="82" r="3" fill={tokens.brand.accent} />
    </Svg>
  );
}
