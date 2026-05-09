import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import { tokens } from '../../../theme';

/**
 * Story 1.14 Card 1 — Welcome / Identity.
 *
 * Visual: app wordmark over an abstract street-grid pattern with three
 * coloured fuel pins floating over it (green / yellow / red). Suggests
 * "fuel-price map" without referencing real geography.
 *
 * P10 (1.14 review) — wordmark added to match the spec's Visual concept
 * ("app logo/wordmark centered. Background: abstract / generic stylised
 * map illustration"). Previous v1 had only the grid + pins.
 *
 * v1 placeholder — designed for swap with v2 commissioned illustrations
 * (per project_deferred.md "App icon / brand visual identity revisit").
 * The component shape (single SVG, fixed viewBox, no external refs) lets
 * the swap be a single-file replacement.
 */
const SIZE = 160;

export function Card1Illustration() {
  return (
    <Svg width={SIZE} height={SIZE} viewBox="0 0 160 160" fill="none">
      {/* Abstract street grid — light ink lines, soft */}
      <Line x1="20" y1="50" x2="140" y2="50" stroke={tokens.neutral.n200} strokeWidth="1.5" />
      <Line x1="20" y1="90" x2="140" y2="90" stroke={tokens.neutral.n200} strokeWidth="1.5" />
      <Line x1="20" y1="130" x2="140" y2="130" stroke={tokens.neutral.n200} strokeWidth="1.5" />
      <Line x1="40" y1="20" x2="40" y2="150" stroke={tokens.neutral.n200} strokeWidth="1.5" />
      <Line x1="80" y1="20" x2="80" y2="150" stroke={tokens.neutral.n200} strokeWidth="1.5" />
      <Line x1="120" y1="20" x2="120" y2="150" stroke={tokens.neutral.n200} strokeWidth="1.5" />

      {/* Three teardrop pins anchored at intersections */}
      <Pin cx={50} cy={50} color={tokens.price.cheap} />
      <Pin cx={92} cy={92} color={tokens.price.mid} />
      <Pin cx={120} cy={50} color={tokens.price.expensive} />

      {/* Wordmark centered over the grid */}
      <SvgText
        x="80"
        y="100"
        fontSize="22"
        fontWeight="800"
        fill={tokens.brand.ink}
        textAnchor="middle"
        letterSpacing="-0.5"
      >
        litro
      </SvgText>
    </Svg>
  );
}

function Pin({ cx, cy, color }: { cx: number; cy: number; color: string }) {
  // Teardrop = circle on top + triangle pointing down to (cx, cy + 18).
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
