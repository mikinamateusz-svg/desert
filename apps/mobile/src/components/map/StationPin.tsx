import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import type { PriceColor } from '../../utils/priceColor';

// Teardrop: 32×32 square with three rounded corners + sharp bottom-left,
// rotated -45° so the sharp corner points straight down.
// Container height = 32 + ceil(16√2 − 16) ≈ 39dp so the visual tip aligns
// with MarkerView anchor={{ x: 0.5, y: 1 }}.

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
  onPress: () => void;
}

export function StationPin({ priceColor, label, isEstimated, onPress }: StationPinProps) {
  const color = FILL[priceColor];
  const showEstimated = isEstimated && priceColor !== 'nodata';

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8} style={styles.container}>
      <View
        style={[
          styles.pin,
          showEstimated
            ? { backgroundColor: '#e5e7eb', borderWidth: 2.5, borderColor: color }
            : { backgroundColor: color },
        ]}
      >
        <Text
          style={[styles.label, { color: showEstimated ? color : '#ffffff' }]}
          numberOfLines={1}
          allowFontScaling={false}
        >
          {label}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 32,
    height: 39,
  },
  pin: {
    width: 32,
    height: 32,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderBottomRightRadius: 16,
    borderBottomLeftRadius: 0,
    transform: [{ rotate: '-45deg' }],
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.20,
    shadowRadius: 4,
    elevation: 4,
  },
  label: {
    fontSize: 7,
    fontWeight: '800',
    transform: [{ rotate: '45deg' }],
    textAlign: 'center',
    includeFontPadding: false,
  },
});
