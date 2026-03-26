import { Modal, View, Text, TouchableOpacity, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tokens } from '../theme';
import type { FuelType } from '@desert/types';
import { VALID_FUEL_TYPES } from '../hooks/useFuelTypePreference';

interface Props {
  visible: boolean;
  onSelect: (ft: FuelType) => void;
  /** Called on backdrop tap or back gesture — caller should persist default and mark seen */
  onDismiss: () => void;
}

export function FuelTypePickerSheet({ visible, onSelect, onDismiss }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      onRequestClose={onDismiss}
    >
      <View style={styles.container}>
        {/* Backdrop — fills everything behind the sheet */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} />

        {/* Sheet — sits at the bottom of the container */}
        <View
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 24) }]}
          accessibilityViewIsModal
        >
          <View style={styles.handle} />

          <Text style={styles.title}>{t('fuelPicker.title')}</Text>
          <Text style={styles.subtitle}>{t('fuelPicker.subtitle')}</Text>

          {(VALID_FUEL_TYPES as FuelType[]).map((ft, index) => (
            <TouchableOpacity
              key={ft}
              style={[styles.row, index < VALID_FUEL_TYPES.length - 1 && styles.rowBorder]}
              onPress={() => onSelect(ft)}
              accessibilityRole="button"
              accessibilityLabel={t(`fuelTypes.${ft}`)}
            >
              <Text style={styles.rowText}>{t(`fuelTypes.${ft}`)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: tokens.surface.card,
    borderTopLeftRadius: tokens.radius.lg,
    borderTopRightRadius: tokens.radius.lg,
    paddingHorizontal: 24,
    paddingTop: 12,
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
