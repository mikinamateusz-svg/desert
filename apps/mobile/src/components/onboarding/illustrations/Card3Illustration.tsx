import Svg, { Circle, Path, Text as SvgText } from 'react-native-svg';
import { tokens } from '../../../theme';

/**
 * Story 1.14 Card 3 — How to read the map.
 *
 * Visual: four teardrop pins side-by-side. First three: green / yellow /
 * red (Tanio / Średnio / Drogo). Fourth: dashed-outline pin with a "~"
 * inside (Szacunkowa) — subtle introduction of the estimate marker.
 * Spec: "the less we bother the user with mechanics, the better" — so
 * the tilde is acknowledged but not explained.
 *
 * v1 placeholder — see Card1Illustration for the swap-pattern note.
 */
const SIZE_W = 200;
const SIZE_H = 120;

export function Card3Illustration() {
  return (
    <Svg width={SIZE_W} height={SIZE_H} viewBox="0 0 200 120" fill="none">
      <Pin cx={30} cy={50} color={tokens.price.cheap} />
      <Pin cx={80} cy={50} color={tokens.price.mid} />
      <Pin cx={130} cy={50} color={tokens.price.expensive} />
      <EstimatePin cx={180} cy={50} />
    </Svg>
  );
}

function Pin({ cx, cy, color }: { cx: number; cy: number; color: string }) {
  return (
    <>
      <Path
        d={`M ${cx - 11} ${cy - 4} Q ${cx} ${cy + 24} ${cx + 11} ${cy - 4} Z`}
        fill={color}
      />
      <Circle cx={cx} cy={cy - 7} r={11} fill={color} />
      <Circle cx={cx} cy={cy - 7} r={4} fill={tokens.neutral.n0} />
    </>
  );
}

function EstimatePin({ cx, cy }: { cx: number; cy: number }) {
  // Outline-only (dashed) teardrop with "~" centred — visually distinct
  // from solid coloured pins. Uses the no-data slate tone for a
  // "not-yet-confirmed" feel that's still legible.
  return (
    <>
      <Path
        d={`M ${cx - 11} ${cy - 4} Q ${cx} ${cy + 24} ${cx + 11} ${cy - 4} Z`}
        fill="none"
        stroke={tokens.price.noData}
        strokeWidth="2"
        strokeDasharray="3 2"
      />
      <Circle
        cx={cx}
        cy={cy - 7}
        r={11}
        fill={tokens.surface.card}
        stroke={tokens.price.noData}
        strokeWidth="2"
        strokeDasharray="3 2"
      />
      <SvgText
        x={cx}
        y={cy - 3}
        fontSize="14"
        fontWeight="700"
        fill={tokens.price.noData}
        textAnchor="middle"
      >
        ~
      </SvgText>
    </>
  );
}
