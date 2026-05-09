import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import { tokens } from '../../../theme';

/**
 * Story 1.14 Card 2 — Where the data comes from.
 *
 * Visual: stylised phone outline framing a fuel-price board (rectangular
 * with three price-style horizontal marks). Arrow flowing right from the
 * phone into a cloud → checkmark, communicating "you snap → we process →
 * it lands."
 *
 * v1 placeholder — see Card1Illustration for the swap-pattern note.
 */
const SIZE = 160;

export function Card2Illustration() {
  return (
    <Svg width={SIZE} height={SIZE} viewBox="0 0 160 160" fill="none">
      {/* Phone outline — rounded rectangle */}
      <Rect
        x="14"
        y="20"
        width="56"
        height="100"
        rx="8"
        ry="8"
        stroke={tokens.brand.ink}
        strokeWidth="2"
        fill={tokens.neutral.n0}
      />
      {/* Phone notch */}
      <Rect x="32" y="24" width="20" height="3" rx="1.5" fill={tokens.neutral.n400} />

      {/* Price board inside the phone screen */}
      <Rect x="22" y="38" width="40" height="56" rx="2" fill={tokens.surface.warmPage} />
      <Line x1="28" y1="50" x2="56" y2="50" stroke={tokens.brand.ink} strokeWidth="2" />
      <Line x1="28" y1="62" x2="50" y2="62" stroke={tokens.brand.ink} strokeWidth="2" />
      <Line x1="28" y1="74" x2="56" y2="74" stroke={tokens.brand.ink} strokeWidth="2" />
      <Line x1="28" y1="86" x2="44" y2="86" stroke={tokens.brand.ink} strokeWidth="2" />

      {/* Arrow from phone → cloud (horizontal) */}
      <Line x1="78" y1="70" x2="98" y2="70" stroke={tokens.brand.accent} strokeWidth="2.5" />
      <Path d="M 96 65 L 102 70 L 96 75" stroke={tokens.brand.accent} strokeWidth="2.5" fill="none" />

      {/* Cloud */}
      <Path
        d="M 110 78 Q 105 78 105 72 Q 105 66 112 66 Q 114 60 122 60 Q 132 60 134 68 Q 142 68 142 76 Q 142 84 134 84 L 112 84 Q 105 84 110 78 Z"
        fill={tokens.brand.accent}
        opacity="0.18"
        stroke={tokens.brand.accent}
        strokeWidth="2"
      />
      {/* Checkmark inside the cloud */}
      <Path
        d="M 116 74 L 121 79 L 132 68"
        stroke={tokens.brand.accent}
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Tiny photo-frame indicator near phone for camera-ness */}
      <Circle cx="42" cy="108" r="4" fill="none" stroke={tokens.brand.ink} strokeWidth="1.5" />
    </Svg>
  );
}
