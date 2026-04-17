import { useMemo, useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, Image, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { tokens } from '../theme';

export type LoadingStage = 'gps' | 'stations' | 'prices' | 'done';

interface Props {
  stage: LoadingStage;
  /** Called when the fade-out transition finishes — parent can unmount */
  onHidden: () => void;
}

/* eslint-disable @typescript-eslint/no-require-imports */
const DROP_IMAGES: Record<LoadingStage, ReturnType<typeof require>> = {
  gps:      require('../../assets/loading/drop-0.png'),
  stations: require('../../assets/loading/drop-40.png'),
  prices:   require('../../assets/loading/drop-75.png'),
  done:     require('../../assets/loading/drop-100.png'),
};
/* eslint-enable @typescript-eslint/no-require-imports */

const DROP_WIDTH  = 60;
const DROP_HEIGHT = 80;
const LABEL_HEIGHT = 20;
const Z_SPLASH = 100;

export function LoadingScreen({ stage, onHidden }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const screenAnim = useRef(new Animated.Value(1)).current;

  // When done: hold briefly, then fade out
  useEffect(() => {
    if (stage !== 'done') return;
    const cancelled = { current: false };
    Animated.sequence([
      Animated.delay(400),
      Animated.timing(screenAnim, {
        toValue: 0,
        duration: 350,
        useNativeDriver: true,
      }),
    ]).start(() => {
      if (!cancelled.current) onHidden();
    });
    return () => { cancelled.current = true; };
  }, [stage, screenAnim, onHidden]);

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

      {/* Fuel drop — static image swapped per stage */}
      <View style={styles.dropContainer}>
        <Image
          source={DROP_IMAGES[stage]}
          style={styles.dropImage}
          resizeMode="contain"
        />
      </View>

      {/* Stage label */}
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

  dropContainer: {
    width: DROP_WIDTH,
    height: DROP_HEIGHT,
  },
  dropImage: {
    width: DROP_WIDTH,
    height: DROP_HEIGHT,
  },

  stageLabel: {
    fontSize: 13,
    color: tokens.neutral.n400,
    fontWeight: '500',
    letterSpacing: 0.2,
    height: LABEL_HEIGHT,
    textAlign: 'center',
  },
});
