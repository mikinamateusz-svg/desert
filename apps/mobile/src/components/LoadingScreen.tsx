import { useMemo, useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { tokens } from '../theme';

export type LoadingStage = 'gps' | 'stations' | 'prices' | 'done';

interface Props {
  stage: LoadingStage;
  /** Called when the fade-out transition finishes — parent can unmount */
  onHidden: () => void;
}

const STAGE_PROGRESS: Record<LoadingStage, number> = {
  gps:      0.0,
  stations: 0.4,
  prices:   0.75,
  done:     1.0,
};

const DROP_WIDTH   = 90;
const DROP_HEIGHT  = 112;
const LABEL_HEIGHT = 20;
// Above all map layers and overlays; must stay highest in the z-stack
const Z_SPLASH = 100;

export function LoadingScreen({ stage, onHidden }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const fillAnim   = useRef(new Animated.Value(0)).current;
  const screenAnim = useRef(new Animated.Value(1)).current;

  // Animate fill to match the current stage progress.
  // Skips when stage === 'done' — the done effect owns fillAnim from that point.
  useEffect(() => {
    if (stage === 'done') return;
    Animated.timing(fillAnim, {
      toValue: STAGE_PROGRESS[stage],
      duration: 700,
      useNativeDriver: false, // height cannot use native driver
    }).start();
  }, [stage, fillAnim]);

  // When done: stop any in-flight fill animation, fill to 100%, hold, fade out.
  // D2: cancelled ref prevents onHidden firing after unmount.
  useEffect(() => {
    if (stage !== 'done') return;
    const cancelled = { current: false };
    fillAnim.stopAnimation();
    Animated.sequence([
      Animated.timing(fillAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: false,
      }),
      Animated.delay(200),
      Animated.timing(screenAnim, {
        toValue: 0,
        duration: 350,
        useNativeDriver: true,
      }),
    ]).start(() => {
      if (!cancelled.current) onHidden();
    });
    return () => { cancelled.current = true; };
  }, [stage, fillAnim, screenAnim, onHidden]);

  const fillHeight = fillAnim.interpolate({
    inputRange:  [0, 1],
    outputRange: [0, DROP_HEIGHT],
  });

  // D7: useMemo instead of IIFE — avoids recomputing on every render
  const stageLabel = useMemo<string>(() => {
    switch (stage) {
      case 'gps':      return t('loading.gps');
      case 'stations': return t('loading.stations');
      case 'prices':   return t('loading.prices');
      case 'done':     return t('loading.done');
    }
  }, [stage, t]);

  return (
    <Animated.View
      style={[styles.container, { opacity: screenAnim, paddingBottom: insets.bottom }]}
      accessibilityRole="progressbar"
      accessibilityLabel={stageLabel}
    >
      {/* Wordmark */}
      <Text style={styles.wordmark} accessibilityRole="text">
        litr<Text style={styles.accent}>o</Text>
      </Text>

      {/* Fuel drop — CSS teardrop clip with animated fill */}
      <View style={styles.dropOuter} accessibilityElementsHidden>
        <View style={styles.dropBackground} />
        <Animated.View style={[styles.dropFill, { height: fillHeight }]} />
        <View style={styles.dropOutline} />
      </View>

      {/* Stage label — live region so screen readers announce each stage */}
      <Text
        style={styles.stageLabel}
        accessibilityLiveRegion="polite"
      >
        {stageLabel}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: tokens.surface.warmPage,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: Z_SPLASH,
    gap: 32,
  },

  wordmark: {
    fontSize: 52,
    fontWeight: '800',
    color: tokens.brand.ink,
    letterSpacing: -2,
    lineHeight: 56,
  },
  accent: {
    color: tokens.brand.accent,
  },

  dropOuter: {
    width: DROP_WIDTH,
    height: DROP_HEIGHT,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    borderBottomLeftRadius: DROP_WIDTH / 2,
    borderBottomRightRadius: DROP_WIDTH / 2,
    overflow: 'hidden',
  },
  dropBackground: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: tokens.neutral.n200,
  },
  dropFill: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: tokens.brand.accent,
  },
  dropOutline: {
    ...StyleSheet.absoluteFillObject,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    borderBottomLeftRadius: DROP_WIDTH / 2,
    borderBottomRightRadius: DROP_WIDTH / 2,
    borderWidth: 2.5,
    borderColor: tokens.neutral.n400,
    backgroundColor: 'transparent',
  },

  stageLabel: {
    fontSize: 13,
    color: tokens.neutral.n400,
    fontWeight: '500',
    letterSpacing: 0.2, // P5: was 0.02 (sub-pixel no-op)
    height: LABEL_HEIGHT,
    textAlign: 'center',
  },
});
