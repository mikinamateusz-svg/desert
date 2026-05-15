import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { tokens } from '../../theme';
import type { FuelType } from '@desert/types';

interface FuelFilterPillProps {
  fuelType: FuelType;
  onPress: () => void;
}

/**
 * Story 2.19 — fuel selection pill. Single-select dropdown affordance
 * that replaces the chip row from Story 2.4 / UI-8. Always renders in
 * the brand-accent fill (a fuel is always selected, post first-launch
 * picker). Tap opens FuelTypePickerSheet in change-mode.
 */
export function FuelFilterPill({ fuelType, onPress }: FuelFilterPillProps) {
  const { t } = useTranslation();
  return (
    <TouchableOpacity
      style={[styles.pill, styles.pillActive]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('mapFilters.fuelPillA11y', {
        fuel: t(`fuelTypes.${fuelType}`),
      })}
    >
      <Text style={styles.pillTextActive}>
        {t('mapFilters.fuelPillPrefix')}: {t(`fuelTypes.${fuelType}`)}
      </Text>
      <Text style={styles.chevronActive}>▾</Text>
    </TouchableOpacity>
  );
}

interface ChainFilterPillProps {
  selectedCount: number;
  onPress: () => void;
}

/**
 * Story 2.19 — chain filter pill. Multi-select dropdown. Renders in
 * neutral outline when no filter is active; switches to brand-accent
 * fill with the active count once one or more chains are selected.
 */
export function ChainFilterPill({ selectedCount, onPress }: ChainFilterPillProps) {
  const { t } = useTranslation();
  const isActive = selectedCount > 0;
  return (
    <TouchableOpacity
      style={[styles.pill, isActive && styles.pillActive]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        isActive
          ? t('mapFilters.chainPillActiveA11y', { count: selectedCount })
          : t('mapFilters.chainPillInactiveA11y')
      }
    >
      <Text style={isActive ? styles.pillTextActive : styles.pillText}>
        {isActive
          ? t('mapFilters.chainPillActive', { count: selectedCount })
          : t('mapFilters.chainPillInactive')}
      </Text>
      <Text style={isActive ? styles.chevronActive : styles.chevron}>▾</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: tokens.radius.full,
    backgroundColor: 'rgba(26,26,26,0.85)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  pillActive: {
    backgroundColor: tokens.brand.accent,
    borderColor: tokens.brand.accent,
  },
  pillText: {
    color: tokens.neutral.n200,
    fontSize: 13,
    fontWeight: '600',
  },
  pillTextActive: {
    color: tokens.brand.ink,
    fontSize: 13,
    fontWeight: '700',
  },
  chevron: {
    color: tokens.neutral.n200,
    fontSize: 11,
    fontWeight: '600',
  },
  chevronActive: {
    color: tokens.brand.ink,
    fontSize: 11,
    fontWeight: '700',
  },
});
