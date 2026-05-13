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
   * outdated even if the timestamp looks fresh". Aggregation across
   * multiple fuels happens in the caller — pin shows the dot if ANY
   * fuel relevant to the displayed price is stale (per AC3).
   * Distinct from the GPS-override amber dot used by Story 3.20.
   */
  isStale?: boolean;
  isSelected?: boolean;
  onPress: () => void;
}

// Story 2.17 — small neutral-grey decoration. 8×8 with a thin white
// outline so it reads against any pin colour (including the no-data
// grey). Anchored absolutely at top-right of the pin container.
const STALE_DOT_SIZE = 8;
const STALE_DOT_COLOR = '#94a3b8'; // slate-400 — neutral, NOT the warning amber

export function StationPin({
  priceColor,
  label,
  isEstimated,
  isStale = false,
  isSelected = false,
  onPress,
}: StationPinProps) {
  const color = FILL[priceColor];
  const showEstimated = isEstimated && priceColor !== 'nodata';
  // Don't draw the stale dot on no-data pins — the pin already says
  // "no signal", layering a stale dot adds noise without information.
  const showStaleDot = isStale && priceColor !== 'nodata';
  const size = isSelected ? PIN_SIZE_SELECTED : PIN_SIZE;
  const radius = size / 2;
  // Container height leaves room for the rotated tip (≈ size * 1.207)
  const containerHeight = size + Math.ceil(radius * Math.SQRT2 - radius);

  return (
    <View
      style={{ width: size, height: containerHeight }}
      onStartShouldSetResponder={() => true}
      onResponderGrant={onPress}
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
            shadowOpacity: isSelected ? 0.30 : 0.20,
            shadowRadius: isSelected ? 8 : 4,
            elevation: isSelected ? 8 : 4,
          },
          showEstimated
            ? { backgroundColor: '#6b7280', borderWidth: isSelected ? 3 : 2.5, borderColor: color }
            : { backgroundColor: color, borderWidth: isSelected ? 3 : 0, borderColor: 'white' },
        ]}
      >
        <Text
          style={{
            fontSize: isSelected ? 8 : 7,
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
  );
}
