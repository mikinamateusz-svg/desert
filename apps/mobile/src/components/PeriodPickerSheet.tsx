import { Modal, View, Text, TouchableOpacity, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tokens } from '../theme';
import type { FillupPeriod } from '../api/fillups';

interface Props {
  visible: boolean;
  selected: FillupPeriod;
  onSelect: (period: FillupPeriod) => void;
  onDismiss: () => void;
}

const PERIOD_OPTIONS: FillupPeriod[] = ['30d', '3m', '12m', 'all'];

const PERIOD_LABEL_KEY: Record<FillupPeriod, string> = {
  '30d': 'history.period30d',
  '3m':  'history.period3m',
  '12m': 'history.period12m',
  'all': 'history.periodAll',
};

/**
 * Period selector bottom sheet — replaces the segmented control from
 * Story 5.5 with a single dropdown affordance. Matches the
 * `FuelTypePickerSheet` pattern from the map screen so the app has a
 * single design language across all single-select dropdowns.
 */
export function PeriodPickerSheet({ visible, selected, onSelect, onDismiss }: Props) {
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
          <Text style={styles.title}>{t('history.periodSheetTitle')}</Text>

          {PERIOD_OPTIONS.map((p, index) => {
            const isSelected = selected === p;
            return (
              <TouchableOpacity
                key={p}
                style={[styles.row, index < PERIOD_OPTIONS.length - 1 && styles.rowBorder]}
                onPress={() => {
                  onSelect(p);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={t(PERIOD_LABEL_KEY[p])}
              >
                <Text style={[styles.rowText, isSelected && styles.rowTextSelected]}>
                  {t(PERIOD_LABEL_KEY[p])}
                </Text>
                {isSelected && <Text style={styles.checkmark}>✓</Text>}
              </TouchableOpacity>
            );
          })}
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
    marginBottom: 20,
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
  rowTextSelected: {
    fontWeight: '700',
    color: tokens.brand.accent,
  },
  checkmark: {
    fontSize: 16,
    fontWeight: '800',
    color: tokens.brand.accent,
  },
});
