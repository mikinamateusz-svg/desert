import { View, Text, StyleSheet } from 'react-native';
import type { FuelType } from '@desert/types';

interface Props {
  fuelType: FuelType;
  size: 'sm' | 'lg';
}

const BADGE_CONFIG: Record<FuelType, { label: string; bg: string; star?: boolean }> = {
  PB_95:      { label: '95',  bg: '#22c55e' },
  PB_98:      { label: '98',  bg: '#15803d' },
  ON:         { label: 'ON',  bg: '#1c1c1e' },
  ON_PREMIUM: { label: 'ON',  bg: '#1c1c1e', star: true },
  LPG:        { label: 'LPG', bg: '#ef4444' },
};

export function FuelBadge({ fuelType, size }: Props) {
  const config = BADGE_CONFIG[fuelType];
  if (!config) return null;
  const { label, bg, star } = config;
  const isLg = size === 'lg';

  return (
    <View style={[styles.badge, isLg ? styles.badgeLg : styles.badgeSm, { backgroundColor: bg }]}>
      <Text style={[styles.label, isLg ? styles.labelLg : styles.labelSm]}>{label}</Text>
      {star && (
        <View style={[styles.star, isLg ? styles.starLg : styles.starSm]}>
          <Text style={[styles.starText, isLg ? styles.starTextLg : styles.starTextSm]}>★</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeLg: { width: 38, height: 28, borderRadius: 6 },
  badgeSm: { width: 30, height: 22, borderRadius: 4 },
  label: {
    color: '#ffffff',
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  labelLg: { fontSize: 14 },
  labelSm: { fontSize: 11 },
  star: {
    position: 'absolute',
    backgroundColor: '#f59e0b',
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  starLg: { width: 11, height: 11, top: -4, right: -4 },
  starSm: { width: 9,  height: 9,  top: -3, right: -3 },
  starText: { color: '#ffffff', fontWeight: '900' },
  starTextLg: { fontSize: 7 },
  starTextSm: { fontSize: 6 },
});
