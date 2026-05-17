import { View, Text } from 'react-native';
import type { PriceColor } from '../../utils/priceColor';

// Teardrop: 32×32 square with three rounded corners + sharp bottom-left,
// rotated -45° so the sharp corner points straight down.
// Container height = size + ceil(size/2 * √2 - size/2) so the visual tip
// aligns with MarkerView anchor={{ x: 0.5, y: 1 }}.

const PIN_SIZE = 32;
const PIN_SIZE_SELECTED = 38;

const FILL: Record<PriceColor, string> = {
  cheapest:  '#1a9641',
  cheap:     '#66bd63',
  mid:       '#f5c542',
  pricey:    '#f46d43',
  expensive: '#d7191c',
  nodata:    '#94a3b8',
};

// Dark text on light backgrounds, white on dark
const TEXT_COLOR: Record<PriceColor, string> = {
  cheapest:  '#ffffff',
  cheap:     '#1a1a1a',
  mid:       '#1a1a1a',
  pricey:    '#ffffff',
  expensive: '#ffffff',
  nodata:    '#ffffff',
};

interface StationPinProps {
  priceColor: PriceColor;
  /** Short price string e.g. "6.42", "~6.40", "?" */
  label: string;
  isEstimated: boolean;
  /**
   * Story 2.17 — rack-stale marker. When true, a small neutral-grey dot
   * is drawn at the top-right corner to signal "this price may be
   * outdated even if the timestamp looks fresh".
   */
  isStale?: boolean;
  isSelected?: boolean;
  /**
   * Story 2.19 — chain monogram badge. 2-char uppercase token (`OR`,
   * `BP`, `SH`...) rendered as a small neutral chip floating above the
   * pin. `null` = no badge.
   */
  monogram?: string | null;
  /**
   * Story 2.19 — chain filter is active AND this station is not in the
   * filter. Demotes the pin: scales the inner price head only (NOT the
   * monogram chip, so chain identity stays legible) + removes shadow.
   * The pin remains visible and tappable.
   */
  isDemoted?: boolean;
  /**
   * Story 2.19 (review F6 — AC12) — full a11y description for screen
   * readers. Composed by the caller from chain name + fuel + price,
   * e.g. "Stacja Orlen, PB 95 6,29 zł na litr". Falls through to a
   * minimal default when not provided.
   */
  accessibilityLabel?: string;
  onPress: () => void;
}

// Story 2.17 — small neutral-grey decoration.
const STALE_DOT_SIZE = 8;
const STALE_DOT_COLOR = '#94a3b8';

// Story 2.19 — monogram chip dimensions.
const MONOGRAM_HEIGHT = 12;
const MONOGRAM_GAP = 2;

// Story 2.19 — demote scale applied to the inner pin head only. The
// monogram chip is intentionally left at 100% so chain identity stays
// legible at small sizes (review F12). Selected pins always render at
// full scale regardless of demote (review F5 + selection-wins rule).
const DEMOTE_SCALE = 0.8;
const DEMOTE_OPACITY = 0.6;

export function StationPin({
  priceColor,
  label,
  isEstimated,
  isStale = false,
  isSelected = false,
  monogram = null,
  isDemoted = false,
  accessibilityLabel,
  onPress,
}: StationPinProps) {
  const color = FILL[priceColor];
  const showEstimated = isEstimated && priceColor !== 'nodata';
  const showStaleDot = isStale && priceColor !== 'nodata';
  const size = isSelected ? PIN_SIZE_SELECTED : PIN_SIZE;
  const radius = size / 2;
  const pinHeight = size + Math.ceil(radius * Math.SQRT2 - radius);
  const showMonogram = monogram !== null && monogram !== '';
  const containerHeight = showMonogram
    ? pinHeight + MONOGRAM_HEIGHT + MONOGRAM_GAP
    : pinHeight;

  // Demote: scale the inner price head only (NOT the outer container).
  // This keeps MarkerView anchor {x:0.5, y:1} aligned with the visual
  // tip — review F5 caught that scaling the outer container drifted the
  // tip ~4px off the station coordinate.
  const demotedAndNotSelected = isDemoted && !isSelected;

  return (
    <View
      style={{
        width: size,
        height: containerHeight,
        opacity: demotedAndNotSelected ? DEMOTE_OPACITY : 1,
      }}
      onStartShouldSetResponder={() => true}
      onResponderGrant={onPress}
      accessible
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? `${label} zł`}
    >
      {/* Monogram chip — floats above the pin head, NOT scaled when
          demoted (review F12 — keep chain identity legible). */}
      {showMonogram && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            alignItems: 'center',
            zIndex: 2,
          }}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <View
            pointerEvents="none"
            style={{
              height: MONOGRAM_HEIGHT,
              paddingHorizontal: 4,
              borderRadius: MONOGRAM_HEIGHT / 2,
              backgroundColor: '#1f2937',
              borderWidth: 0.5,
              borderColor: '#ffffff',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text
              style={{
                fontSize: 7,
                fontWeight: '800',
                color: '#ffffff',
                letterSpacing: 0.4,
                includeFontPadding: false,
              }}
              allowFontScaling={false}
            >
              {monogram}
            </Text>
          </View>
        </View>
      )}

      {/* Inner pin head — scaled when demoted. transformOrigin defaults
          to centre, but we scale a fixed-height inner box anchored to
          the bottom of the container via `top` so the bottom edge
          (visual tip) stays at the same y-coordinate post-scale. */}
      <View
        style={{
          position: 'absolute',
          // Bottom edge of this inner box is at the container's bottom,
          // matching MarkerView anchor y:1.
          bottom: 0,
          left: 0,
          width: size,
          height: pinHeight,
          transform: demotedAndNotSelected ? [{ scale: DEMOTE_SCALE }] : undefined,
        }}
      >
        <View
          style={[
            {
              width: size,
              height: size,
              borderTopLeftRadius: radius,
              borderTopRightRadius: radius,
              borderBottomRightRadius: radius,
              borderBottomLeftRadius: 0,
              transform: [{ rotate: '-45deg' }],
              alignItems: 'center',
              justifyContent: 'center',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: isSelected ? 4 : 2 },
              shadowOpacity: demotedAndNotSelected ? 0 : (isSelected ? 0.30 : 0.20),
              shadowRadius: demotedAndNotSelected ? 0 : (isSelected ? 8 : 4),
              elevation: demotedAndNotSelected ? 0 : (isSelected ? 8 : 4),
            },
            showEstimated
              ? { backgroundColor: '#6b7280', borderWidth: isSelected ? 3 : 2.5, borderColor: color }
              : { backgroundColor: color, borderWidth: isSelected ? 3 : 0, borderColor: 'white' },
          ]}
        >
          <Text
            style={{
              // Bumped from 7/8 to 10/12 after the original sizes were
              // confirmed unreadable on-device. The 32×32 pin (rotated
              // -45°) has ~11px of headroom for a 5-char "~x.xx" label
              // at its widest horizontal slice; 10 sits comfortably
              // inside that bound. Selected pin (38×38, 3px border)
              // gets 12 to keep the size hierarchy.
              fontSize: isSelected ? 12 : 10,
              fontWeight: '800',
              color: showEstimated ? '#ffffff' : TEXT_COLOR[priceColor],
              transform: [{ rotate: '45deg' }],
              textAlign: 'center',
              includeFontPadding: false,
            }}
            numberOfLines={1}
            allowFontScaling={false}
          >
            {label}
          </Text>
        </View>
        {showStaleDot && (
          <View
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              width: STALE_DOT_SIZE,
              height: STALE_DOT_SIZE,
              borderRadius: STALE_DOT_SIZE / 2,
              backgroundColor: STALE_DOT_COLOR,
              borderWidth: 1,
              borderColor: '#ffffff',
            }}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        )}
      </View>
    </View>
  );
}
