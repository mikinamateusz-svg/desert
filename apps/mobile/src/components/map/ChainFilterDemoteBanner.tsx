import { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { tokens } from '../../theme';

interface Props {
  /** Active chain count. 0 = no filter; banner hidden. */
  activeChainCount: number;
  /**
   * Demoted station count (number of visible stations not in the
   * active filter). Banner stays hidden while the user is at a zoom
   * level where nothing is on screen.
   */
  demotedStationCount: number;
  /**
   * Bumped each time the filter selection changes. Re-summons the
   * banner so the auto-dismiss timer restarts on every change.
   */
  triggerKey: number;
  /** Tap on "Wyczyść" — caller clears the chain filter. */
  onClear: () => void;
  /** Tap anywhere else on the banner — caller reopens the chain sheet. */
  onTap?: () => void;
  /** Absolute-positioning offset from the host. */
  topOffset: number;
}

const AUTO_DISMISS_MS = 4000;

/**
 * Story 2.19 — banner that explains the current chain filter state.
 * Shows for 4 seconds after each filter change, then auto-dismisses.
 * Re-tapping the chain pill (which calls onTap before reopening) is
 * not needed for re-summoning — the triggerKey change does it
 * automatically when the filter is altered from the sheet.
 */
export function ChainFilterDemoteBanner({
  activeChainCount,
  demotedStationCount,
  triggerKey,
  onClear,
  onTap,
  topOffset,
}: Props) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Review patch F7 — only fire the banner on user-initiated changes.
    // triggerKey === 0 means "cold start" (the caller hasn't bumped it
    // yet). Without this guard, opening the app with a persisted filter
    // pops a 4s banner on every launch even though the user did nothing.
    if (activeChainCount === 0 || triggerKey === 0) {
      setVisible(false);
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }
    setVisible(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(false), AUTO_DISMISS_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [activeChainCount, triggerKey]);

  if (!visible) return null;

  return (
    <View
      style={[styles.host, { top: topOffset }]}
      pointerEvents="box-none"
      accessibilityLiveRegion="polite"
    >
      <TouchableOpacity
        style={styles.banner}
        onPress={onTap}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={t('mapFilters.banner.a11y', {
          activeCount: activeChainCount,
          demotedCount: demotedStationCount,
        })}
      >
        <Text style={styles.bannerText}>
          {t('mapFilters.banner.body', {
            activeCount: activeChainCount,
            demotedCount: demotedStationCount,
          })}
        </Text>
        <TouchableOpacity
          onPress={onClear}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={t('mapFilters.banner.clear')}
        >
          <Text style={styles.clearText}>{t('mapFilters.banner.clear')} →</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 14,
    right: 14,
    zIndex: 9,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: tokens.surface.card,
    borderRadius: tokens.radius.md,
    borderLeftWidth: 4,
    borderLeftColor: tokens.brand.accent,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  bannerText: {
    flex: 1,
    color: tokens.brand.ink,
    fontSize: 12,
    lineHeight: 16,
  },
  clearText: {
    color: tokens.brand.accent,
    fontSize: 12,
    fontWeight: '700',
  },
});
