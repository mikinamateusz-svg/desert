import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { tokens } from '../../theme';
import type { FuelType } from '@desert/types';

const FUEL_TYPES: FuelType[] = ['PB_95', 'PB_98', 'ON', 'ON_PREMIUM', 'LPG'];

interface Props {
  fuelType: FuelType;
  stationName: string | null;
  onFuelTypeChange: (ft: FuelType) => void;
  onConfirm: (manualPrice: number | undefined) => void;
  onWrongStation: () => void;
}

export function PriceConfirmationCard({
  fuelType,
  stationName,
  onFuelTypeChange,
  onConfirm,
  onWrongStation,
}: Props) {
  const { t } = useTranslation();
  const [priceText, setPriceText] = useState('');
  const [showFuelPicker, setShowFuelPicker] = useState(false);

  const handleConfirm = () => {
    const parsed = parseFloat(priceText.replace(',', '.'));
    onConfirm(isNaN(parsed) ? undefined : parsed);
  };

  return (
    <View style={styles.card}>
      {/* Station name */}
      <View style={styles.stationRow}>
        <Text style={styles.stationName}>
          {stationName ?? t('contribution.confirmCard.matchingStation')}
        </Text>
        <TouchableOpacity onPress={onWrongStation} accessibilityRole="button">
          <Text style={styles.wrongStation}>{t('contribution.confirmCard.wrongStation')}</Text>
        </TouchableOpacity>
      </View>

      {/* Fuel type chip */}
      <Text style={styles.fieldLabel}>{t('contribution.confirmCard.fuelType')}</Text>
      <TouchableOpacity
        style={styles.fuelChip}
        onPress={() => setShowFuelPicker(p => !p)}
        accessibilityRole="button"
      >
        <Text style={styles.fuelChipText}>{fuelType.replace('_', ' ')}</Text>
      </TouchableOpacity>

      {showFuelPicker && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.fuelPicker}>
          {FUEL_TYPES.map(ft => (
            <TouchableOpacity
              key={ft}
              style={[styles.fuelOption, ft === fuelType && styles.fuelOptionActive]}
              onPress={() => { onFuelTypeChange(ft); setShowFuelPicker(false); }}
            >
              <Text style={[styles.fuelOptionText, ft === fuelType && styles.fuelOptionTextActive]}>
                {ft.replace('_', ' ')}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Price input */}
      <Text style={styles.fieldLabel}>{t('contribution.confirmCard.priceLabel')}</Text>
      <TextInput
        style={styles.priceInput}
        value={priceText}
        onChangeText={setPriceText}
        placeholder={t('contribution.confirmCard.pricePlaceholder')}
        placeholderTextColor={tokens.neutral.n400}
        keyboardType="decimal-pad"
        returnKeyType="done"
      />

      {/* Confirm CTA */}
      <TouchableOpacity
        style={styles.confirmButton}
        onPress={handleConfirm}
        accessibilityRole="button"
      >
        <Text style={styles.confirmText}>{t('contribution.confirmCard.confirm')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: tokens.surface.card,
    borderTopLeftRadius: tokens.radius.lg,
    borderTopRightRadius: tokens.radius.lg,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 8,
  },
  stationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  stationName: {
    fontSize: 16,
    fontWeight: '600',
    color: tokens.brand.ink,
    flex: 1,
    marginRight: 8,
  },
  wrongStation: {
    fontSize: 13,
    color: tokens.brand.accent,
    textDecorationLine: 'underline',
  },
  fieldLabel: {
    fontSize: 12,
    color: tokens.neutral.n500,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  fuelChip: {
    alignSelf: 'flex-start',
    backgroundColor: tokens.brand.ink,
    borderRadius: tokens.radius.full,
    paddingVertical: 6,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  fuelChipText: {
    color: tokens.neutral.n0,
    fontSize: 14,
    fontWeight: '600',
  },
  fuelPicker: {
    marginBottom: 12,
  },
  fuelOption: {
    borderRadius: tokens.radius.full,
    borderWidth: 1,
    borderColor: tokens.neutral.n200,
    paddingVertical: 6,
    paddingHorizontal: 14,
    marginRight: 8,
  },
  fuelOptionActive: {
    backgroundColor: tokens.brand.ink,
    borderColor: tokens.brand.ink,
  },
  fuelOptionText: {
    fontSize: 13,
    color: tokens.brand.ink,
    fontWeight: '500',
  },
  fuelOptionTextActive: {
    color: tokens.neutral.n0,
  },
  priceInput: {
    borderWidth: 1,
    borderColor: tokens.neutral.n200,
    borderRadius: tokens.radius.md,
    paddingVertical: 12,
    paddingHorizontal: 14,
    fontSize: 16,
    color: tokens.brand.ink,
    marginBottom: 16,
  },
  confirmButton: {
    backgroundColor: tokens.brand.accent,
    borderRadius: tokens.radius.full,
    paddingVertical: 14,
    alignItems: 'center',
  },
  confirmText: {
    color: tokens.brand.ink,
    fontSize: 16,
    fontWeight: '700',
  },
});
