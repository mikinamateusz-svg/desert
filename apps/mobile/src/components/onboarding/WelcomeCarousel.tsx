import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  Modal,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type NativeEventSubscription,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { tokens } from '../../theme';
import { Card1Illustration } from './illustrations/Card1Illustration';
import { Card2Illustration } from './illustrations/Card2Illustration';
import { Card3Illustration } from './illustrations/Card3Illustration';
import { Card4Illustration } from './illustrations/Card4Illustration';
import { Card5Illustration } from './illustrations/Card5Illustration';

/**
 * Story 1.14 — Welcome carousel (four-pillar rewrite, amended 2026-05-10).
 *
 * Two modes share the same component:
 *   - `first-run`: shown once on first app launch, blocks all dismissal
 *     paths except "Zaczynamy" on card 5 and the "Pomiń" skip affordance
 *     on cards 1-4. Persists `welcomeLastCard` for resume-on-force-quit
 *     and writes `welcomeCompleted` on finish or skip.
 *   - `reaccess`: opened from Account → "Jak działa litro?". All
 *     dismissal paths work (tap-outside, hardware-back, "Zamknij"); no
 *     completion-flag side-effects. The "Pomiń" affordance is hidden in
 *     re-access mode — already-completed users have no need for it.
 *
 * Cards map 1:1 to positioning pillars + a community CTA:
 *   1 — Pillar 1: Real prices, no fakes
 *   2 — Pillar 4: Predictive price alerts
 *   3 — Pillar 3: Personal spend log
 *   4 — Pillar 2: Easy + map-colour orientation
 *   5 — Community contribution + final CTA
 *
 * Linear-only navigation. No swipe, no auto-advance, no force-read
 * timer — natural reading pace + 5 cards delivers the spec's "20-30s
 * through it" target without disabling buttons. Passive users can opt
 * out via "Pomiń" on any of the first four cards.
 */
export const WELCOME_COMPLETED_KEY = 'desert:onboarding:welcomeCompleted';
// Internal-only resume key — root layout doesn't need to read this.
const WELCOME_LAST_CARD_KEY = 'desert:onboarding:welcomeLastCard';

const TOTAL_CARDS = 5;

// Defensive clamp: callers passing initialCard outside 1..TOTAL_CARDS
// would otherwise produce an undefined CARDS lookup and a runtime crash
// on titleKey access.
const clampCard = (n: number): number =>
  Math.min(TOTAL_CARDS, Math.max(1, Number.isFinite(n) ? n : 1));

export type WelcomeCarouselMode = 'first-run' | 'reaccess';

export interface WelcomeCarouselProps {
  visible: boolean;
  mode: WelcomeCarouselMode;
  /** First-run: called when the user finishes card 5 or taps "Pomiń"
   *  (after the flag write). Re-access: not used; pass undefined or
   *  the close handler. */
  onComplete?: () => void;
  /** Re-access: called for any dismissal (hardware-back / "Zamknij").
   *  First-run: called only as a no-op on Android-back-on-card-1 attempts. */
  onClose?: () => void;
  /** Initial card. First-run reads from AsyncStorage on mount and ignores
   *  this. Re-access uses it (default 1). */
  initialCard?: number;
}

export function WelcomeCarousel({
  visible,
  mode,
  onComplete,
  onClose,
  initialCard = 1,
}: WelcomeCarouselProps) {
  const { t } = useTranslation();
  const [currentCard, setCurrentCard] = useState(clampCard(initialCard));
  // Gate the persistence effect until the resume read completes;
  // without this, the persistence effect fires synchronously on mount
  // with the initial value `1` and overwrites a legitimate stored
  // resume value (e.g. `4`) before the read completes.
  const restoredRef = useRef(false);
  // Block double-taps on Zaczynamy / Pomiń while the completion write
  // is in flight; a fast second tap would otherwise fire onComplete
  // twice and queue a duplicate AsyncStorage write.
  const [completing, setCompleting] = useState(false);

  // First-run mount: restore last-seen card from AsyncStorage so a
  // force-quit mid-carousel resumes where the user left off. Re-access
  // mode is purely local and starts at the requested initial card.
  useEffect(() => {
    if (!visible) {
      restoredRef.current = false;
      return;
    }
    if (mode !== 'first-run') {
      setCurrentCard(clampCard(initialCard));
      restoredRef.current = true;
      return;
    }
    restoredRef.current = false;
    let cancelled = false;
    void (async () => {
      try {
        const stored = await AsyncStorage.getItem(WELCOME_LAST_CARD_KEY);
        if (cancelled) return;
        const parsed = stored ? parseInt(stored, 10) : NaN;
        if (Number.isFinite(parsed) && parsed >= 1 && parsed <= TOTAL_CARDS) {
          setCurrentCard(parsed);
        } else {
          setCurrentCard(1);
        }
      } catch {
        // AsyncStorage failure on read → start at 1; not blocking.
        if (!cancelled) setCurrentCard(1);
      } finally {
        if (!cancelled) restoredRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, visible, initialCard]);

  // Persist the current card every time it changes in first-run mode
  // so a force-quit / crash mid-carousel resumes accurately. Skipped
  // until the restore read completes — otherwise the synchronous mount
  // write would clobber the stored value with the initial `1`.
  useEffect(() => {
    if (!visible || mode !== 'first-run') return;
    if (!restoredRef.current) return;
    void AsyncStorage.setItem(WELCOME_LAST_CARD_KEY, String(currentCard)).catch(() => {
      // AsyncStorage write failure → user re-sees from card 1 next launch;
      // recoverable degradation, not a crash.
    });
  }, [currentCard, mode, visible]);

  const writeCompletion = useCallback(async () => {
    try {
      await AsyncStorage.setItem(WELCOME_COMPLETED_KEY, 'true');
      // Clear the resume key so a future flag-reset resumes from card
      // 1 rather than landing back on the last-seen card.
      await AsyncStorage.removeItem(WELCOME_LAST_CARD_KEY);
    } catch {
      // Write failed → user re-sees the carousel next launch. Better
      // than crashing or blocking the UI on a recoverable issue.
    }
  }, []);

  const handleNext = useCallback(() => {
    if (completing) return;
    if (currentCard < TOTAL_CARDS) {
      setCurrentCard(currentCard + 1);
      return;
    }
    // Card 5: "Zaczynamy" / "Zamknij" branch.
    if (mode === 'first-run') {
      setCompleting(true);
      void (async () => {
        await writeCompletion();
        onComplete?.();
      })();
      return;
    }
    onClose?.();
  }, [completing, currentCard, mode, onComplete, onClose, writeCompletion]);

  const handleBack = useCallback(() => {
    if (currentCard > 1) {
      setCurrentCard(currentCard - 1);
    }
  }, [currentCard]);

  const handleClose = useCallback(() => {
    if (mode === 'reaccess') onClose?.();
  }, [mode, onClose]);

  // "Pomiń" — first-run only, cards 1-4. Writes the completion flag
  // and exits the carousel for passive users who don't want the full
  // contribution narrative. Reuses the same completion path as
  // "Zaczynamy" so the user re-sees the carousel only if they reinstall.
  //
  // Defensive `currentCard < TOTAL_CARDS` guard — the button is hidden
  // on card 5 via `showSkipButton`, but the handler can fire via a11y
  // custom actions or test harnesses that bypass the button's hidden
  // state. Spec line 196 explicitly: "no Pomiń on the final card".
  const handleSkip = useCallback(() => {
    if (completing || mode !== 'first-run' || currentCard === TOTAL_CARDS) return;
    setCompleting(true);
    void (async () => {
      await writeCompletion();
      onComplete?.();
    })();
  }, [completing, currentCard, mode, onComplete, writeCompletion]);

  // Android hardware-back. First-run: navigate back; on card 1, swallow
  // (block dismissal). Re-access: same back-navigation, except on card 1
  // the back button closes the modal.
  //
  // While a completion write is in flight (`completing`), swallow the
  // back event entirely — otherwise a fast back-press after Pomiń /
  // Zaczynamy decrements `currentCard`, the persist effect writes the
  // new value to LAST_CARD after writeCompletion already removed it,
  // and a debug/flag-reset flow resumes at the wrong card.
  useEffect(() => {
    if (!visible) return;
    const sub: NativeEventSubscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (completing) return true;
        if (currentCard > 1) {
          handleBack();
          return true;
        }
        if (mode === 'reaccess') {
          handleClose();
          return true;
        }
        // First-run + card 1: swallow to prevent accidental skipping.
        return true;
      },
    );
    return () => sub.remove();
  }, [completing, currentCard, handleBack, handleClose, mode, visible]);

  const currentCardData = CARDS[currentCard - 1]!;
  const isLastCard = currentCard === TOTAL_CARDS;
  const showBackButton = currentCard > 1 || mode === 'reaccess';
  // Pomiń appears on cards 1-4 in first-run mode only. Final card has
  // no skip — by then the user either commits or has already opted out
  // earlier; re-access mode hides it (already-completed users don't
  // need to re-skip).
  const showSkipButton = mode === 'first-run' && !isLastCard;
  const primaryLabel = isLastCard
    ? mode === 'first-run'
      ? t('onboarding.welcome.buttons.start')
      : t('onboarding.welcome.buttons.close')
    : t('onboarding.welcome.buttons.next');

  return (
    <Modal
      visible={visible}
      animationType="slide"
      // `fullScreen` blocks the iOS swipe-down dismissal gesture. The
      // re-access mode still allows close via the on-screen "Zamknij"
      // button + Android back.
      presentationStyle="fullScreen"
      transparent={false}
      onRequestClose={() => {
        // Android back propagates here too; our BackHandler effect runs
        // first and consumes the event, so this is a defensive no-op
        // for first-run. In re-access mode the back handler also calls
        // `handleClose` directly.
      }}
    >
      <StatusBar barStyle="dark-content" backgroundColor={tokens.surface.page} />
      <SafeAreaView style={styles.safeArea}>
        {/* Header row: progress-dots wrapper + skip/close buttons are
            siblings so iOS VoiceOver doesn't collapse the Touchables
            under the accessible-progressbar parent. (Setting
            `accessible={true}` on a parent View hides interactive
            children from VoiceOver entirely on iOS.) */}
        <View style={styles.headerRow}>
          <View
            style={styles.progressDots}
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={t('onboarding.welcome.progress.stepN', {
              current: currentCard,
              total: TOTAL_CARDS,
            })}
          >
            {Array.from({ length: TOTAL_CARDS }).map((_, i) => (
              <View
                key={i}
                style={[styles.progressDot, i === currentCard - 1 && styles.progressDotActive]}
                importantForAccessibility="no-hide-descendants"
                accessibilityElementsHidden
              />
            ))}
          </View>
          {showSkipButton && (
            <TouchableOpacity
              style={styles.skipButton}
              onPress={handleSkip}
              disabled={completing}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel={t('onboarding.welcome.buttons.skip')}
              accessibilityState={{ disabled: completing }}
            >
              <Text style={styles.skipButtonText}>{t('onboarding.welcome.buttons.skip')}</Text>
            </TouchableOpacity>
          )}
          {mode === 'reaccess' && (
            <TouchableOpacity
              style={styles.closeButton}
              onPress={handleClose}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel={t('onboarding.welcome.buttons.close')}
            >
              <Text style={styles.closeButtonText}>×</Text>
            </TouchableOpacity>
          )}
        </View>

        <ScrollView
          contentContainerStyle={styles.cardScroll}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.illustrationWrap}>{currentCardData.illustration}</View>

          <Text style={styles.title} accessibilityRole="header">
            {t(currentCardData.titleKey)}
          </Text>

          <Text style={styles.body}>{t(currentCardData.bodyKey)}</Text>

          {/* Colour-pin legend is the supporting visual for card 4
              (Pillar 2). It used to live under card 3 before the
              four-pillar rewrite — moved here so the labels sit next
              to the pin illustration above. */}
          {currentCard === 4 && <Card4Legend t={t} />}
        </ScrollView>

        <View style={styles.buttonRow}>
          {showBackButton ? (
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={handleBack}
              accessibilityRole="button"
              accessibilityLabel={t('onboarding.welcome.buttons.back')}
              // Card 1 in re-access mode disables back since there's no
              // earlier card. Visually still rendered to keep the button
              // row symmetric.
              disabled={currentCard === 1}
              accessibilityState={{ disabled: currentCard === 1 }}
            >
              <Text
                style={[
                  styles.secondaryButtonText,
                  currentCard === 1 && styles.disabledText,
                ]}
              >
                {t('onboarding.welcome.buttons.back')}
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.secondaryButtonPlaceholder} />
          )}

          <TouchableOpacity
            style={styles.primaryButton}
            onPress={handleNext}
            disabled={completing}
            accessibilityRole="button"
            accessibilityLabel={primaryLabel}
            accessibilityState={{ disabled: completing }}
          >
            <Text style={styles.primaryButtonText}>{primaryLabel}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

// ── Card metadata ────────────────────────────────────────────────────────

const CARDS = [
  { illustration: <Card1Illustration />, titleKey: 'onboarding.welcome.card1.title', bodyKey: 'onboarding.welcome.card1.body' },
  { illustration: <Card2Illustration />, titleKey: 'onboarding.welcome.card2.title', bodyKey: 'onboarding.welcome.card2.body' },
  { illustration: <Card3Illustration />, titleKey: 'onboarding.welcome.card3.title', bodyKey: 'onboarding.welcome.card3.body' },
  { illustration: <Card4Illustration />, titleKey: 'onboarding.welcome.card4.title', bodyKey: 'onboarding.welcome.card4.body' },
  { illustration: <Card5Illustration />, titleKey: 'onboarding.welcome.card5.title', bodyKey: 'onboarding.welcome.card5.body' },
] as const;

// ── Card-specific subviews ───────────────────────────────────────────────

interface BodyProps {
  t: (key: string, opts?: Record<string, unknown>) => string;
}

function Card4Legend({ t }: BodyProps) {
  return (
    <View style={styles.legendRow}>
      <Legend label={t('onboarding.welcome.card4.labelCheap')} color={tokens.price.cheap} />
      <Legend label={t('onboarding.welcome.card4.labelMid')} color={tokens.price.mid} />
      <Legend label={t('onboarding.welcome.card4.labelExpensive')} color={tokens.price.expensive} />
      <Legend label={t('onboarding.welcome.card4.labelEstimate')} color={tokens.price.noData} dashed />
    </View>
  );
}

function Legend({ label, color, dashed }: { label: string; color: string; dashed?: boolean }) {
  return (
    <View style={styles.legendItem}>
      <View
        style={[
          styles.legendSwatch,
          { backgroundColor: dashed ? 'transparent' : color, borderColor: color },
          dashed && { borderStyle: 'dashed' },
        ]}
      />
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: tokens.surface.page,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    position: 'relative',
  },
  progressDots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  progressDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: tokens.neutral.n200,
  },
  progressDotActive: {
    width: 24,
    backgroundColor: tokens.brand.accent,
  },
  skipButton: {
    position: 'absolute',
    right: 16,
    top: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  skipButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: tokens.neutral.n500,
  },
  closeButton: {
    position: 'absolute',
    right: 16,
    top: 4,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: {
    fontSize: 26,
    color: tokens.neutral.n500,
    lineHeight: 28,
  },
  cardScroll: {
    flexGrow: 1,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 32,
  },
  illustrationWrap: {
    height: 180,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: tokens.brand.ink,
    textAlign: 'center',
    marginBottom: 12,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: tokens.neutral.n500,
    textAlign: 'center',
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
    marginTop: 20,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendSwatch: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
  },
  legendLabel: {
    fontSize: 12,
    color: tokens.neutral.n500,
  },
  buttonRow: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 24,
    gap: 12,
  },
  secondaryButton: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: tokens.radius.full,
    borderWidth: 1.5,
    borderColor: tokens.neutral.n200,
    alignItems: 'center',
  },
  secondaryButtonPlaceholder: {
    flex: 1,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: tokens.neutral.n500,
  },
  disabledText: {
    color: tokens.neutral.n400,
  },
  primaryButton: {
    flex: 2,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: tokens.radius.full,
    backgroundColor: tokens.brand.accent,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: tokens.neutral.n0,
    fontSize: 15,
    fontWeight: '700',
  },
});
