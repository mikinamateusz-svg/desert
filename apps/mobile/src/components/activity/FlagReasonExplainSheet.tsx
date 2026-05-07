import { useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  Pressable,
  StyleSheet,
  Linking,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import { tokens } from '../../theme';
import { flagReasonCopy } from './flagReasonCopy';

interface Props {
  visible: boolean;
  flagReason: string | null;
  status: 'shadow_rejected' | 'rejected';
  onDismiss: () => void;
}

/**
 * Story 3.17 AC2 — tap-to-explain bottom sheet for shadow_rejected /
 * rejected activity rows. Mirrors {@link FlagWrongConfirmSheet}'s pattern
 * (Modal slide animation, overlay tap-to-dismiss, handle bar) but with one
 * primary CTA instead of two — the CTA's behaviour depends on the
 * `flag_reason` class:
 *
 * - `'retake'` → navigate to `/(app)/capture` (driver should re-photo).
 * - `'support'` → open `mailto:` to `EXPO_PUBLIC_SUPPORT_EMAIL`; falls back
 *   to dismiss-only when the env var is unset (e.g., dev or pre-launch).
 * - `'dismiss'` → just dismiss.
 *
 * For unknown / null `flag_reason` the helper returns the generic copy
 * with `cta: 'dismiss'`.
 */
export function FlagReasonExplainSheet({
  visible,
  flagReason,
  status,
  onDismiss,
}: Props) {
  const { t } = useTranslation();
  const copy = flagReasonCopy(flagReason, status, t);

  // P-7 (3.17 review) — when EXPO_PUBLIC_SUPPORT_EMAIL is unset, a 'support'
  // CTA would silently dismiss (the button promised an email composer and
  // delivered nothing). Collapse the CTA back to 'dismiss' at runtime so
  // the button label and behavior match.
  const supportEmail = process.env['EXPO_PUBLIC_SUPPORT_EMAIL'];
  const effectiveCta = copy.cta === 'support' && !supportEmail ? 'dismiss' : copy.cta;

  const handlePrimary = useCallback(() => {
    if (effectiveCta === 'retake') {
      onDismiss();
      router.push('/(app)/capture');
      return;
    }
    if (effectiveCta === 'support' && supportEmail) {
      // P-6 (3.17 review) — Linking.openURL rejects on devices without a
      // mail app. The previous `void` silenced the rejection; the user
      // tapped the button and saw the sheet dismiss with no signal. Catch
      // the rejection and log; UI-side feedback (toast / fallback display)
      // is tracked as a deferred polish — for now the sheet still closes
      // because the CTA is committal.
      Linking.openURL(`mailto:${supportEmail}`).catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.warn(
          `[FlagReasonExplainSheet] mailto failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
      onDismiss();
      return;
    }
    onDismiss();
  }, [effectiveCta, supportEmail, onDismiss]);

  const primaryLabel =
    effectiveCta === 'retake'
      ? t('contribution.flagReason.ctaRetake')
      : effectiveCta === 'support'
        ? t('contribution.flagReason.ctaSupport')
        : t('contribution.flagReason.ctaDismiss');

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onDismiss}>
      <Pressable style={styles.overlay} onPress={onDismiss} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title}>{copy.label}</Text>
        <Text style={styles.body}>{copy.explanation}</Text>

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.button, styles.cancelButton]}
            onPress={onDismiss}
            accessibilityRole="button"
          >
            <Text style={styles.cancelText}>{t('contribution.flagReason.ctaClose')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.primaryButton]}
            onPress={handlePrimary}
            accessibilityRole="button"
          >
            <Text style={styles.primaryText}>{primaryLabel}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
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
    fontSize: 18,
    fontWeight: '600',
    color: tokens.brand.ink,
    marginBottom: 12,
    textAlign: 'center',
  },
  body: {
    fontSize: 14,
    color: tokens.neutral.n500,
    marginBottom: 20,
    textAlign: 'center',
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: tokens.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: { backgroundColor: tokens.neutral.n100 },
  primaryButton: { backgroundColor: tokens.brand.accent },
  cancelText: { fontSize: 16, color: tokens.brand.ink, fontWeight: '500' },
  primaryText: { fontSize: 16, color: tokens.brand.ink, fontWeight: '600' },
});
