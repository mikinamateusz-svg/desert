import { View, Text } from 'react-native';
import type { PriceColor } from '../../utils/priceColor';

// Teardrop: 32×32 square with three rounded corners + sharp bottom-left,
// rotated -45° so the sharp corner points straight down.
// Container height = size + ceil(size/2 * √2 - size/2) so the visual tip
// aligns with MarkerView anchor={{ x: 0.5, y: 1 }}.

const PIN_SIZE = 32;
const PIN_SIZE_SELECTED = 38;

const FILL: Record<PriceColor, string> = {
  cheap:     '#22c55e',
  mid:       '#f59e0b',
  expensive: '#ef4444',
  nodata:    '#94a3b8',
};

interface StationPinProps {
  priceColor: PriceColor;
  /** Short price string e.g. "6.42", "~6.40", "?" */
  label: string;
  isEstimated: boolean;
  isSelected?: boolean;
  onPress: () => void;
}

export function StationPin({ priceColor, label, isEstimated, isSelected = false, onPress }: StationPinProps) {
  const color = FILL[priceColor];
  const showEstimated = isEstimated && priceColor !== 'nodata';
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
            ? { backgroundColor: '#e5e7eb', borderWidth: isSelected ? 3 : 2.5, borderColor: color }
            : { backgroundColor: color, borderWidth: isSelected ? 3 : 0, borderColor: 'white' },
        ]}
      >
        <Text
          style={{
            fontSize: isSelected ? 8 : 7,
            fontWeight: '800',
            color: showEstimated ? color : '#ffffff',
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
    </View>
  );
}
