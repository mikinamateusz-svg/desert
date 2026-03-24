import { View, StyleSheet } from 'react-native';

// MapPin: 32×32dp neutral circle marker.
// Used as a MarkerView component in Story 2.5 (station detail sheet).
// In Story 2.2 pins are rendered via ShapeSource+CircleLayer (GeoJSON) for performance.
// In Story 2.3 the circle fill becomes price-tier driven via CircleLayer paint expression.

interface MapPinProps {
  accessibilityLabel?: string;
}

export function MapPin({ accessibilityLabel }: MapPinProps) {
  return (
    <View
      style={styles.pin}
      accessible
      accessibilityLabel={accessibilityLabel}
    />
  );
}

const styles = StyleSheet.create({
  pin: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#94a3b8', // slate-400 — price-tier colour added in Story 2.3
    borderWidth: 1.5,
    borderColor: '#ffffff',
  },
});
