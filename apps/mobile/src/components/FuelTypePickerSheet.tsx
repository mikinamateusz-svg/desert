import { Modal, View, Text, TouchableOpacity, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { tokens } from '../theme';
import type { FuelType } from '@desert/types';

const FUEL_TYPES: FuelType[] = ['PB_95', 'PB_98', 'ON', 'ON_PREMIUM', 'LPG'];

interface Props {
  visible: boolean;
  onSelect: (ft: FuelType) => void;
  /** Called on backdrop tap or swipe — caller should persist default and mark seen */
  onDismiss: () => void;
}

export function FuelTypePickerSheet({ visible, onSelect, onDismiss }: Props) {
  const { t } = useTranslation();

  return (
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      onRequestClose={onDismiss}
    >
      <Pressable style={styles.overlay} onPress={onDismiss} />
      <View style={styles.sheet}>
        <View style={styles.handle} />

        <Text style={styles.title}>{t('fuelPicker.title')}</Text>
        <Text style={styles.subtitle}>{t('fuelPicker.subtitle')}</Text>

        {FUEL_TYPES.map((ft, index) => (
          <TouchableOpacity
            key={ft}
            style={[styles.row, index < FUEL_TYPES.length - 1 && styles.rowBorder]}
            onPress={() => onSelect(ft)}
            accessibilityRole="button"
            accessibilityLabel={t(`fuelTypes.${ft}`)}
          >
            <Text style={styles.rowText}>{t(`fuelTypes.${ft}`)}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    backgroundColor: tokens.surface.card,
    borderTopLeftRadius: tokens.radius.lg,
    borderTopRightRadius: tokens.radius.lg,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 40,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: tokens.neutral.n200,
    alignSelf: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: tokens.brand.ink,
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 13,
    color: tokens.neutral.n500,
    textAlign: 'center',
    marginBottom: 20,
  },
  row: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.neutral.n200,
  },
  rowText: {
    fontSize: 17,
    fontWeight: '500',
    color: tokens.brand.ink,
  },
});
