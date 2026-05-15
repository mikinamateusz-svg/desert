import { Modal, View, Text, ScrollView, TouchableOpacity, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tokens } from '../theme';
import { FILTERABLE_BRANDS, brandMonogram, type FilterableBrand } from '../utils/brandMonogram';

interface Props {
  visible: boolean;
  selectedBrands: FilterableBrand[];
  /**
   * Live toggle — applied immediately as the user taps (no commit gate).
   * The Zastosuj button at the bottom simply closes the sheet, since the
   * selection is already in effect.
   */
  onToggle: (brand: FilterableBrand) => void;
  /** Reset to "all chains" (= empty filter). */
  onClearAll: () => void;
  onDismiss: () => void;
}

/**
 * Story 2.19 — multi-select chain filter sheet.
 *
 * Live preview pattern: selection applies on every tap so the user can
 * see the map update behind the sheet. The Zastosuj button at the bottom
 * is a confirmation / close affordance, not a commit gate. Matches the
 * FuelTypePickerSheet visual pattern (modal transparent + slide animation
 * + drag handle + tap-outside-to-dismiss + hardware-back closes).
 */
export function ChainFilterSheet({
  visible,
  selectedBrands,
  onToggle,
  onClearAll,
  onDismiss,
}: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const allSelectedTicked = selectedBrands.length === 0;
  const selectedCount = selectedBrands.length;

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

          <Text style={styles.title}>{t('chainFilter.title')}</Text>
          <Text style={styles.subtitle}>{t('chainFilter.subtitle')}</Text>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Reset row — ticks when no specific brands are selected */}
            <TouchableOpacity
              style={[styles.row, styles.rowResetBorder]}
              onPress={onClearAll}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: allSelectedTicked }}
              accessibilityLabel={t('chainFilter.allChains')}
            >
              <View style={[styles.checkbox, allSelectedTicked && styles.checkboxTicked]}>
                {allSelectedTicked && <Text style={styles.checkboxMark}>✓</Text>}
              </View>
              <Text style={styles.rowLabel}>{t('chainFilter.allChains')}</Text>
              <View style={styles.monogramSlot} />
            </TouchableOpacity>

            {FILTERABLE_BRANDS.map((brand) => {
              const checked = selectedBrands.includes(brand);
              const monogram = brandMonogram(brand);
              const labelKey = `chainNames.${brand}` as const;
              return (
                <TouchableOpacity
                  key={brand}
                  style={styles.row}
                  onPress={() => onToggle(brand)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked }}
                  accessibilityLabel={t(labelKey)}
                >
                  <View style={[styles.checkbox, checked && styles.checkboxTicked]}>
                    {checked && <Text style={styles.checkboxMark}>✓</Text>}
                  </View>
                  <Text style={styles.rowLabel}>{t(labelKey)}</Text>
                  <View style={styles.monogramSlot}>
                    {monogram ? (
                      <View style={styles.monogramChip}>
                        <Text style={styles.monogramText} allowFontScaling={false}>
                          {monogram}
                        </Text>
                      </View>
                    ) : (
                      <Text style={styles.monogramDash}>—</Text>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <TouchableOpacity
            style={styles.applyButton}
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel={
              selectedCount > 0
                ? t('chainFilter.applyButton', { count: selectedCount })
                : t('chainFilter.applyButtonAll')
            }
          >
            <Text style={styles.applyButtonText}>
              {selectedCount > 0
                ? t('chainFilter.applyButton', { count: selectedCount })
                : t('chainFilter.applyButtonAll')}
            </Text>
          </TouchableOpacity>
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
    // Sheet is bounded; ScrollView inside provides the scroll for 13 rows
    maxHeight: '85%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: tokens.neutral.n200,
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: tokens.brand.ink,
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13,
    color: tokens.neutral.n500,
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 18,
  },
  // Review patch F8 — flex:1 lets the ScrollView shrink to fit between
  // the static header (handle + title + subtitle) and footer (Apply
  // button) on short devices. flexGrow:0 was clipping the footer when
  // the 13 rows didn't fit inside the sheet's maxHeight.
  scroll: {
    flex: 1,
    flexShrink: 1,
  },
  scrollContent: {
    paddingBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  rowResetBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.neutral.n200,
    marginBottom: 4,
    paddingBottom: 14,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: tokens.neutral.n400,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  checkboxTicked: {
    backgroundColor: tokens.brand.accent,
    borderColor: tokens.brand.accent,
  },
  checkboxMark: {
    fontSize: 14,
    fontWeight: '800',
    color: tokens.brand.ink,
    lineHeight: 16,
  },
  rowLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    color: tokens.brand.ink,
  },
  monogramSlot: {
    width: 32,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  monogramChip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: '#1f2937',
    borderWidth: 0.5,
    borderColor: tokens.neutral.n400,
  },
  monogramText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: 0.4,
    includeFontPadding: false,
  },
  monogramDash: {
    fontSize: 14,
    color: tokens.neutral.n400,
    fontWeight: '600',
  },
  applyButton: {
    marginTop: 16,
    backgroundColor: tokens.brand.accent,
    borderRadius: tokens.radius.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  applyButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: tokens.brand.ink,
  },
});
