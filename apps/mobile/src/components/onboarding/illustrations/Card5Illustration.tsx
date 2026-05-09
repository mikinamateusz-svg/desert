import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { tokens } from '../../../theme';

/**
 * Story 1.14 Card 5 — The reward.
 *
 * Visual: bell icon (matching the same bell that 6.10's alerts surface
 * uses on the map header) with a small "+30 dni" badge floating next
 * to it. A subtle clock/calendar element conveying the renewal cycle.
 *
 * P9 (1.14 review) — badge text is now localised via the `badge` prop
 * (passed from WelcomeCarousel using the `card5.badge` i18n key) instead
 * of the previous hardcoded "+30". Adapts to PL/EN/UK + future locales
 * without an SVG edit.
 *
 * v1 placeholder — see Card1Illustration for the swap-pattern note.
 */
const SIZE = 160;

interface Card5Props {
  /** Localised badge text (e.g. "+30 dni" / "+30 days"). */
  badge: string;
}

export function Card5Illustration({ badge }: Card5Props) {
  return (
    <Svg width={SIZE} height={SIZE} viewBox="0 0 160 160" fill="none">
      {/* ── Bell ───────────────────────────────────────────────────────── */}
      {/* Bell body */}
      <Path
        d="M 50 90 Q 50 56 80 56 Q 110 56 110 90 L 116 100 L 44 100 Z"
        fill={tokens.brand.accent}
      />
      {/* Bell top knob */}
      <Rect x="76" y="48" width="8" height="10" rx="2" fill={tokens.brand.accent} />
      {/* Bell clapper */}
      <Circle cx="80" cy="106" r="6" fill={tokens.brand.accent} />

      {/* ── +30 dni badge floating top-right ───────────────────────────── */}
      <Circle cx="120" cy="60" r="22" fill={tokens.surface.card} stroke={tokens.brand.accent} strokeWidth="2.5" />
      <SvgText
        x="120"
        y="64"
        fontSize="11"
        fontWeight="700"
        fill={tokens.brand.accent}
        textAnchor="middle"
      >
        {badge}
      </SvgText>

      {/* ── Subtle clock arc beneath the bell suggesting renewal ───────── */}
      <Path
        d="M 56 130 A 28 28 0 0 0 104 130"
        stroke={tokens.brand.accent}
        strokeWidth="2"
        strokeDasharray="3 3"
        fill="none"
      />
      <Line
        x1="80"
        y1="124"
        x2="80"
        y2="116"
        stroke={tokens.brand.accent}
        strokeWidth="2"
      />
      <Line
        x1="80"
        y1="124"
        x2="88"
        y2="124"
        stroke={tokens.brand.accent}
        strokeWidth="2"
      />
    </Svg>
  );
}
