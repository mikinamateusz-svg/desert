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
 * Story 1.14 — Welcome carousel.
 *
 * Two modes share the same component:
 *   - `first-run`: shown once on first app launch, blocks all dismissal
 *     paths except "Zaczynamy" on card 5. Persists `welcomeLastCard` for
 *     resume-on-force-quit and writes `welcomeCompleted` when finished.
 *   - `reaccess`: opened from Account → "Jak działa litro?". All
 *     dismissal paths work (tap-outside, hardware-back, "Zamknij"); no
 *     completion-flag side-effects.
 *
 * Cards are linear-only. No swipe gesture, no auto-advance, no force-
 * read timer — natural reading pace + 5 cards delivers the spec's
 * "20-30s through it" target without disabling buttons.
 */
export const WELCOME_COMPLETED_KEY = 'desert:onboarding:welcomeCompleted';
// P5 (1.14 review) — internal-only; root layout doesn't need this key.
const WELCOME_LAST_CARD_KEY = 'desert:onboarding:welcomeLastCard';

const TOTAL_CARDS = 5;

// P4 (1.14 review) — defensive clamp: callers passing initialCard outside
// 1..TOTAL_CARDS would otherwise produce an undefined CARDS lookup and a
// runtime crash on titleKey access.
const clampCard = (n: number): number =>
  Math.min(TOTAL_CARDS, Math.max(1, Number.isFinite(n) ? n : 1));

export type WelcomeCarouselMode = 'first-run' | 'reaccess';

export interface WelcomeCarouselProps {
  visible: boolean;
  mode: WelcomeCarouselMode;
  /** First-run: called when the user finishes card 5 (after the flag write).
   *  Re-access: not used; pass undefined or the close handler. */
  onComplete?: () => void;
  /** Re-access: called for any dismissal (tap-outside / back / Zamknij).
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
  // P1 (1.14 review) — gate the persistence effect until the resume read
  // has resolved. Without this, the persistence effect fires synchronously
  // on mount with the initial value `1` and overwrites a legitimate stored
  // resume value (e.g. `4`) before the read completes.
  const restoredRef = useRef(false);
  // P2 (1.14 review) — block double-taps on Zaczynamy while the completion
  // write is in flight; a fast second tap would otherwise fire onComplete
  // twice and queue a duplicate AsyncStorage write.
  const [completing, setCompleting] = useState(false);

  // First-run mount: restore last-seen card from AsyncStorage so a force-quit
  // mid-carousel resumes where the user left off. Re-access mode is purely
  // local and starts at the requested initial card.
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

  // Persist the current card every time it changes in first-run mode so
  // a force-quit / crash mid-carousel resumes accurately. Skipped until
  // the restore read completes (P1) — otherwise the synchronous mount
  // write would clobber the stored value with the initial `1`.
  useEffect(() => {
    if (!visible || mode !== 'first-run') return;
    if (!restoredRef.current) return;
    void AsyncStorage.setItem(WELCOME_LAST_CARD_KEY, String(currentCard)).catch(() => {
      // AsyncStorage write failure → user re-sees from card 1 next launch;
      // recoverable degradation, not a crash.
    });
  }, [currentCard, mode, visible]);

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
        try {
          await AsyncStorage.setItem(WELCOME_COMPLETED_KEY, 'true');
          // P3 (1.14 review) — clear the resume key so a future flag-reset
          // (debug, account-reset, future "show me again" feature) resumes
          // from card 1 rather than landing back on card 5.
          await AsyncStorage.removeItem(WELCOME_LAST_CARD_KEY);
        } catch {
          // Write failed → the user will re-see the carousel next launch.
          // Better than crashing or blocking the UI on a recoverable issue.
        }
        onComplete?.();
      })();
      return;
    }
    onClose?.();
  }, [completing, currentCard, mode, onComplete, onClose]);

  const handleBack = useCallback(() => {
    if (currentCard > 1) {
      setCurrentCard(currentCard - 1);
    }
  }, [currentCard]);

  const handleClose = useCallback(() => {
    if (mode === 'reaccess') onClose?.();
  }, [mode, onClose]);

  // Android hardware-back. First-run: navigate back; on card 1, swallow
  // (block dismissal). Re-access: same back-navigation, except on card 1
  // the back button closes the modal.
  useEffect(() => {
    if (!visible) return;
    const sub: NativeEventSubscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
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
  }, [currentCard, handleBack, handleClose, mode, visible]);

  const cards = buildCards(t);
  const currentCardData = cards[currentCard - 1]!;
  const isLastCard = currentCard === TOTAL_CARDS;
  const showBackButton = currentCard > 1 || mode === 'reaccess';
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
        <View
          style={styles.progressRow}
          // P14 (1.14 review) — single accessible region for the dot row
          // with the "Step N of M" announcement; child dots are decorative
          // shapes hidden from the a11y tree.
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

          {/* P13 (1.14 review) — drop the redundant `accessibilityLabel`;
              the visible <Text> auto-supplies the label and avoids stale-
              key edge cases on i18n updates. */}
          <Text style={styles.title} accessibilityRole="header">
            {t(currentCardData.titleKey)}
          </Text>

          {currentCard === 4 ? (
            <Card4Body t={t} />
          ) : (
            currentCardData.bodyKey && (
              <Text style={styles.body}>{t(currentCardData.bodyKey)}</Text>
            )
          )}

          {currentCard === 1 && (
            <Text style={styles.hint}>{t('onboarding.welcome.card1.hint')}</Text>
          )}
          {currentCard === 3 && <Card3Legend t={t} />}
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
            accessibilityRole="button"
            accessibilityLabel={primaryLabel}
          >
            <Text style={styles.primaryButtonText}>{primaryLabel}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

// ── Card metadata ────────────────────────────────────────────────────────

// P11 (1.14 review) — bodyKey is null for card 4 because Card4Body renders
// a structured "Ty / My / closing" layout instead of a single body string.
// Future cards with structured layouts should follow the same pattern.
//
// P9 (1.14 review) — illustration is built per-render so we can pass the
// localised Card 5 badge string in. Cards 1-4 ignore translation context.
function buildCards(t: (key: string) => string) {
  return [
    { illustration: <Card1Illustration />, titleKey: 'onboarding.welcome.card1.title', bodyKey: 'onboarding.welcome.card1.body' as const },
    { illustration: <Card2Illustration />, titleKey: 'onboarding.welcome.card2.title', bodyKey: 'onboarding.welcome.card2.body' as const },
    { illustration: <Card3Illustration />, titleKey: 'onboarding.welcome.card3.title', bodyKey: 'onboarding.welcome.card3.body' as const },
    { illustration: <Card4Illustration />, titleKey: 'onboarding.welcome.card4.title', bodyKey: null },
    { illustration: <Card5Illustration badge={t('onboarding.welcome.card5.badge')} />, titleKey: 'onboarding.welcome.card5.title', bodyKey: 'onboarding.welcome.card5.body' as const },
  ];
}

// ── Card-specific subviews ───────────────────────────────────────────────

interface BodyProps {
  t: (key: string, opts?: Record<string, unknown>) => string;
}

function Card3Legend({ t }: BodyProps) {
  return (
    <View style={styles.legendRow}>
      <Legend label={t('onboarding.welcome.card3.labelCheap')} color={tokens.price.cheap} />
      <Legend label={t('onboarding.welcome.card3.labelMid')} color={tokens.price.mid} />
      <Legend label={t('onboarding.welcome.card3.labelExpensive')} color={tokens.price.expensive} />
      <Legend label={t('onboarding.welcome.card3.labelEstimate')} color={tokens.price.noData} dashed />
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

function Card4Body({ t }: BodyProps) {
  return (
    <View style={styles.tymyContainer}>
      <View style={styles.tymyBlock}>
        <Text style={styles.tymyLabel}>{t('onboarding.welcome.card4.labelTy')}</Text>
        <Text style={styles.tymyText}>{t('onboarding.welcome.card4.bodyTy')}</Text>
      </View>
      <View style={[styles.tymyBlock, styles.tymyBlockMy]}>
        <Text style={styles.tymyLabel}>{t('onboarding.welcome.card4.labelMy')}</Text>
        <Text style={styles.tymyText}>{t('onboarding.welcome.card4.bodyMy')}</Text>
      </View>
      <Text style={styles.tymyClosing}>{t('onboarding.welcome.card4.closing')}</Text>
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: tokens.surface.page,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
    position: 'relative',
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
  hint: {
    fontSize: 13,
    color: tokens.neutral.n400,
    textAlign: 'center',
    marginTop: 16,
    fontStyle: 'italic',
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
  tymyContainer: {
    width: '100%',
    marginTop: 8,
    gap: 10,
  },
  tymyBlock: {
    backgroundColor: tokens.surface.card,
    borderRadius: tokens.radius.lg,
    padding: 14,
    borderLeftWidth: 4,
    borderLeftColor: tokens.brand.accent,
  },
  tymyBlockMy: {
    borderLeftColor: tokens.price.cheap,
  },
  tymyLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: tokens.neutral.n400,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  tymyText: {
    fontSize: 14,
    color: tokens.brand.ink,
    lineHeight: 20,
  },
  tymyClosing: {
    fontSize: 14,
    color: tokens.neutral.n500,
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 20,
    fontStyle: 'italic',
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
