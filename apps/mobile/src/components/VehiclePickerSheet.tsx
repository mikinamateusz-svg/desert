import { Modal, View, Text, ScrollView, TouchableOpacity, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tokens } from '../theme';
import { formatVehicleDisplayName } from '../utils/formatVehicle';
import type { Vehicle } from '../api/vehicles';

export const ALL_VEHICLES_SCOPE = 'all';
export type VehicleScope = string; // vehicle UUID OR the literal 'all'

interface Props {
  visible: boolean;
  vehicles: Vehicle[];
  selected: VehicleScope;
  onSelect: (scope: VehicleScope) => void;
  onDismiss: () => void;
}

/**
 * Vehicle selector bottom sheet. Lists each car as a row, with "Wszystkie
 * pojazdy" as the LAST option (secondary, separated by a divider) so the
 * specific-vehicle picks read as primary — matches the user's mental model
 * of "I'm normally looking at one car; cross-vehicle is the exception".
 *
 * Matches the FuelTypePickerSheet / PeriodPickerSheet pattern: tap a row
 * to select + close, tap outside to dismiss, hardware-back closes.
 */
export function VehiclePickerSheet({
  visible,
  vehicles,
  selected,
  onSelect,
  onDismiss,
}: Props) {
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
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} />

        <View
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 24) }]}
          accessibilityViewIsModal
        >
          <View style={styles.handle} />
          <Text style={styles.title}>{t('history.vehicleSheetTitle')}</Text>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
            {vehicles.map((v, index) => {
              const isSelected = selected === v.id;
              const label = formatVehicleDisplayName(v);
              return (
                <TouchableOpacity
                  key={v.id}
                  style={[styles.row, index < vehicles.length - 1 && styles.rowBorder]}
                  onPress={() => onSelect(v.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={label}
                >
                  <Text style={[styles.rowText, isSelected && styles.rowTextSelected]}>
                    {label}
                  </Text>
                  {isSelected && <Text style={styles.checkmark}>✓</Text>}
                </TouchableOpacity>
              );
            })}

            {/* Secondary "all vehicles" option, visually demoted via the
                divider gap + softer text colour. The user's mental model
                is: "I usually look at one car; all-cars is the exception". */}
            <View style={styles.allSeparator} />
            <TouchableOpacity
              style={styles.row}
              onPress={() => onSelect(ALL_VEHICLES_SCOPE)}
              accessibilityRole="button"
              accessibilityState={{ selected: selected === ALL_VEHICLES_SCOPE }}
              accessibilityLabel={t('history.vehicleSelectorAll')}
            >
              <Text
                style={[
                  styles.rowText,
                  styles.rowTextSecondary,
                  selected === ALL_VEHICLES_SCOPE && styles.rowTextSelected,
                ]}
              >
                {t('history.vehicleSelectorAll')}
              </Text>
              {selected === ALL_VEHICLES_SCOPE && <Text style={styles.checkmark}>✓</Text>}
            </TouchableOpacity>
          </ScrollView>
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
    // Capped so the sheet doesn't take over the screen if the user has
    // many cars; ScrollView inside handles overflow.
    maxHeight: '80%',
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
    marginBottom: 12,
  },
  scroll: {
    flexShrink: 1,
  },
  scrollContent: {
    paddingBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
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
  rowTextSecondary: {
    color: tokens.neutral.n500,
    fontWeight: '400',
  },
  rowTextSelected: {
    fontWeight: '700',
    color: tokens.brand.accent,
  },
  checkmark: {
    fontSize: 16,
    fontWeight: '800',
    color: tokens.brand.accent,
  },
  allSeparator: {
    height: 8,
  },
});
