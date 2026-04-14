import { View, Text, StyleSheet } from 'react-native';
import { tokens } from '../theme';

interface Props {
  brand: string | null;
}

/**
 * Displays a station brand identity in a 44×44 rounded square.
 *
 * Known brands render as a colored text badge matching the brand's primary colour.
 * When real logo PNG assets are available, add them to a require() map here and
 * render an <Image> instead of the text badge.
 *
 * Unknown / null brands fall back to a generic fuel pump icon.
 */

interface BrandStyle {
  bg: string;
  text: string;
  label: string;
  fontSize?: number;
}

const BRAND_STYLES: Record<string, BrandStyle> = {
  orlen:      { bg: '#e30613', text: '#ffffff', label: 'O',   fontSize: 22 },
  shell:      { bg: '#FFD500', text: '#cc0000', label: 'S',   fontSize: 22 },
  bp:         { bg: '#006600', text: '#ffffff', label: 'bp',  fontSize: 16 },
  circle_k:   { bg: '#ee2e24', text: '#ffffff', label: 'CK',  fontSize: 14 },
  lotos:      { bg: '#003da5', text: '#ffffff', label: 'L',   fontSize: 22 },
  huzar:      { bg: '#1a1a1a', text: '#f59e0b', label: 'H',   fontSize: 22 },
  moya:       { bg: '#ffffff', text: '#003366', label: 'M',   fontSize: 22 },
  amic:       { bg: '#e84e0f', text: '#ffffff', label: 'A',   fontSize: 22 },
  auchan:     { bg: '#ffffff', text: '#e30613', label: 'Au',  fontSize: 14 },
  carrefour:  { bg: '#004f9f', text: '#ffffff', label: 'C',   fontSize: 22 },
};

export function BrandLogo({ brand }: Props) {
  const style = brand ? BRAND_STYLES[brand.toLowerCase()] : undefined;

  if (style) {
    return (
      <View
        style={[styles.container, { backgroundColor: style.bg }]}
        accessibilityLabel={`${style.label} station`}
        accessibilityRole="image"
      >
        <Text
          style={[styles.brandLabel, { color: style.text, fontSize: style.fontSize ?? 9 }]}
          numberOfLines={2}
          adjustsFontSizeToFit
        >
          {style.label}
        </Text>
      </View>
    );
  }

  return (
    <View
      style={[styles.container, styles.fallback]}
      accessibilityLabel="Fuel station"
      accessibilityRole="image"
    >
      <Text style={styles.fallbackIcon}>⛽</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 44,
    height: 44,
    borderRadius: tokens.radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: tokens.neutral.n200,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  fallback: {
    backgroundColor: tokens.neutral.n100,
  },
  brandLabel: {
    fontWeight: '800',
    letterSpacing: 0.3,
    textAlign: 'center',
    paddingHorizontal: 2,
  },
  fallbackIcon: {
    fontSize: 22,
  },
});
