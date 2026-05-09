import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import { tokens } from '../../../theme';

/**
 * Story 1.14 Card 4 — Your role.
 *
 * Visual: two-section "Ty / My" composition.
 *   - Left: simplified person silhouette holding a phone, taking a photo.
 *   - Arrow in the middle pointing right.
 *   - Right: cloud + checkmark + map pin.
 *
 * Conveys "your job is small (one snap); ours is the rest". Per spec:
 * the user-feedback gap was "I take photo and then what??" — explicitly
 * bound user effort and reassure on the system side.
 *
 * v1 placeholder — see Card1Illustration for the swap-pattern note.
 */
const SIZE_W = 220;
const SIZE_H = 140;

export function Card4Illustration() {
  return (
    <Svg width={SIZE_W} height={SIZE_H} viewBox="0 0 220 140" fill="none">
      {/* ── LEFT: person + phone ───────────────────────────────────────── */}
      {/* Head */}
      <Circle cx="40" cy="46" r="12" fill={tokens.brand.ink} />
      {/* Body / shoulders */}
      <Path
        d="M 22 100 Q 22 76 40 76 Q 58 76 58 100 Z"
        fill={tokens.brand.ink}
      />
      {/* Phone in hand */}
      <Rect
        x="56"
        y="60"
        width="22"
        height="32"
        rx="3"
        fill={tokens.surface.card}
        stroke={tokens.brand.ink}
        strokeWidth="2"
      />
      {/* Phone screen detail (small camera lens) */}
      <Circle cx="67" cy="76" r="3" fill={tokens.brand.accent} />

      {/* ── ARROW ──────────────────────────────────────────────────────── */}
      <Line x1="92" y1="76" x2="124" y2="76" stroke={tokens.brand.accent} strokeWidth="2.5" />
      <Path
        d="M 121 71 L 128 76 L 121 81"
        stroke={tokens.brand.accent}
        strokeWidth="2.5"
        fill="none"
      />

      {/* ── RIGHT: system processes (cloud + check) → map pin ─────────── */}
      <Path
        d="M 142 74 Q 138 74 138 68 Q 138 62 145 62 Q 147 56 156 56 Q 167 56 169 64 Q 178 64 178 72 Q 178 80 169 80 L 145 80 Q 138 80 142 74 Z"
        fill={tokens.brand.accent}
        opacity="0.18"
        stroke={tokens.brand.accent}
        strokeWidth="2"
      />
      <Path
        d="M 148 70 L 153 75 L 165 63"
        stroke={tokens.brand.accent}
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Map pin landing on the right edge.
          P12 (1.14 review) — single brand-accent colour throughout this
          illustration (previously used `price.cheap` green which mixed
          functional colour with the brand palette, against AC9 "monochrome
          with one brand-accent colour"). */}
      <Path
        d="M 192 92 Q 200 110 208 92 Z"
        fill={tokens.brand.accent}
      />
      <Circle cx="200" cy="86" r="9" fill={tokens.brand.accent} />
      <Circle cx="200" cy="86" r="3" fill={tokens.neutral.n0} />
    </Svg>
  );
}
