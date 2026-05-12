import Svg, { Circle, Line, Path } from 'react-native-svg';
import { tokens } from '../../../theme';

/**
 * Story 1.14 Card 1 — Pillar 1: Real prices, no fakes.
 *
 * Visual concept (per amended spec 2026-05-10): map fragment with a few
 * colour-coded pins (green / red), with a soft check-mark "verified"
 * badge anchoring one of them. Communicates "real, trustworthy prices."
 * Avoid showing a camera/photo — that's mechanism, not promise.
 *
 * v1 placeholder — see `_design/welcome-flow-brief.md` for the v2
 * commissioned-illustration direction. The component shape (single SVG,
 * fixed viewBox, no external refs) lets the swap be a single-file
 * replacement.
 */
const SIZE = 160;

export function Card1Illustration() {
  return (
    <Svg width={SIZE} height={SIZE} viewBox="0 0 160 160" fill="none">
      {/* Abstract street grid — light ink lines */}
      <Line x1="20" y1="50" x2="140" y2="50" stroke={tokens.neutral.n200} strokeWidth="1.5" />
      <Line x1="20" y1="90" x2="140" y2="90" stroke={tokens.neutral.n200} strokeWidth="1.5" />
      <Line x1="20" y1="130" x2="140" y2="130" stroke={tokens.neutral.n200} strokeWidth="1.5" />
      <Line x1="40" y1="20" x2="40" y2="150" stroke={tokens.neutral.n200} strokeWidth="1.5" />
      <Line x1="80" y1="20" x2="80" y2="150" stroke={tokens.neutral.n200} strokeWidth="1.5" />
      <Line x1="120" y1="20" x2="120" y2="150" stroke={tokens.neutral.n200} strokeWidth="1.5" />

      {/* Two contextual pins kept in a neutral tone — they exist to
          suggest "the map has multiple stations" without competing with
          the brand-accent hero pin. AC9 (1.14) — monochrome + one
          brand-accent rule kept; colour-coded pins are reserved for
          card 4's legend visual. */}
      <Pin cx={50} cy={90} color={tokens.neutral.n400} />
      <Pin cx={120} cy={50} color={tokens.neutral.n400} />

      {/* Hero pin (centre) — the "verified" anchor. Brand-accent fill so
          it reads as the focal point, with the verified checkmark badge
          attached to its top-right. */}
      <Pin cx={80} cy={90} color={tokens.brand.accent} />

      {/* Verified-check badge anchored to the hero pin's upper-right.
          Soft brand-accent ring with a checkmark inside — the trust
          differentiator that distinguishes Litro from rumour-based
          competitors. */}
      <Circle cx="98" cy="74" r="14" fill={tokens.surface.card} stroke={tokens.brand.accent} strokeWidth="2.5" />
      <Path
        d="M 91 74 L 96 79 L 105 70"
        stroke={tokens.brand.accent}
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function Pin({ cx, cy, color }: { cx: number; cy: number; color: string }) {
  return (
    <>
      <Path
        d={`M ${cx - 9} ${cy - 4} Q ${cx} ${cy + 22} ${cx + 9} ${cy - 4} Z`}
        fill={color}
      />
      <Circle cx={cx} cy={cy - 6} r={9} fill={color} />
      <Circle cx={cx} cy={cy - 6} r={3} fill={tokens.neutral.n0} />
    </>
  );
}
