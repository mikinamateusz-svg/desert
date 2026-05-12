import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import { tokens } from '../../../theme';

/**
 * Story 1.14 Card 5 — Community contribution + final CTA.
 *
 * Visual concept (per amended spec 2026-05-10): phone in hand framing
 * a price board, with a soft success indicator (small checkmark). The
 * "i Tobie również" framing in the body copy carries the reciprocation
 * point; the alerts-unlock is NOT explained here — it lands as an
 * in-app delight moment at first verified photo (see Story 6.13).
 *
 * Deliberately omits any "+30 dni" badge, cloud/pipeline glyphs, or
 * other mechanism cues — communicates the contribution moment without
 * teaching the OCR pipeline.
 *
 * v1 placeholder — see Card1Illustration for the swap-pattern note.
 */
const SIZE = 160;

export function Card5Illustration() {
  return (
    <Svg width={SIZE} height={SIZE} viewBox="0 0 160 160" fill="none">
      {/* ── Hand outline framing the bottom of the phone ────────────── */}
      {/* Simple curved hand shape — soft, abstract, no fingers */}
      <Path
        d="M 30 130 Q 40 152 80 152 Q 120 152 130 130 L 30 130 Z"
        fill={tokens.neutral.n200}
        stroke={tokens.brand.ink}
        strokeWidth="2"
      />

      {/* ── Phone outline ───────────────────────────────────────────── */}
      <Rect
        x="46"
        y="20"
        width="68"
        height="118"
        rx="10"
        ry="10"
        stroke={tokens.brand.ink}
        strokeWidth="2.5"
        fill={tokens.neutral.n0}
      />
      {/* Phone speaker dot */}
      <Rect x="74" y="26" width="12" height="2.5" rx="1.25" fill={tokens.neutral.n400} />

      {/* ── Price board inside the phone screen ─────────────────────── */}
      <Rect
        x="56"
        y="36"
        width="48"
        height="78"
        rx="3"
        fill={tokens.surface.warmPage}
        stroke={tokens.neutral.n400}
        strokeWidth="1"
      />

      {/* Fuel rows on the price board — 4 horizontal price marks */}
      <Line x1="62" y1="48" x2="98" y2="48" stroke={tokens.brand.ink} strokeWidth="2.5" />
      <Line x1="62" y1="62" x2="92" y2="62" stroke={tokens.brand.ink} strokeWidth="2.5" />
      <Line x1="62" y1="76" x2="98" y2="76" stroke={tokens.brand.ink} strokeWidth="2.5" />
      <Line x1="62" y1="90" x2="88" y2="90" stroke={tokens.brand.ink} strokeWidth="2.5" />

      {/* Camera button at the bottom of the phone screen */}
      <Circle cx="80" cy="124" r="6" fill="none" stroke={tokens.brand.ink} strokeWidth="2" />
      <Circle cx="80" cy="124" r="2.5" fill={tokens.brand.ink} />

      {/* ── Soft success badge at top-right of the phone ────────────── */}
      <Circle cx="118" cy="28" r="11" fill={tokens.surface.card} stroke={tokens.brand.accent} strokeWidth="2.5" />
      <Path
        d="M 113 28 L 117 32 L 123 24"
        stroke={tokens.brand.accent}
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
