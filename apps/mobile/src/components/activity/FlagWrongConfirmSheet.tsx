import { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import { tokens } from '../../theme';
import { apiFlagWrong } from '../../api/submissions';
import { useAuth } from '../../store/auth.store';

interface Props {
  visible: boolean;
  submissionId: string;
  onDismiss: () => void;
  onFlagged: () => void;
}

/**
 * Story 3.14 AC2 — confirmation sheet shown when a driver taps `Wrong?` on a
 * verified row. Two-step protection against mistaps: row button alone never
 * commits, only the explicit `Withdraw` action here does.
 *
 * Routes to the thanks screen on success (AC4); shows inline error otherwise.
 */
export function FlagWrongConfirmSheet({
  visible,
  submissionId,
  onDismiss,
  onFlagged,
}: Props) {
  const { t } = useTranslation();
  const { accessToken } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleConfirm = useCallback(async () => {
    if (!accessToken) {
      // Shouldn't be possible (sheet only shows on auth'd activity rows),
      // but guard anyway.
      onDismiss();
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await apiFlagWrong(accessToken, submissionId);
      onFlagged();
      router.push('/(app)/flag-wrong-thanks');
    } catch (err) {
      // P-15: 400 means the server thinks the row is outside the 24h window
      // (or the client clock is skewed forward). Distinct copy + refresh
      // hint, since retrying the same action will keep failing — also poke
      // the activity list so the row's eligibility is recomputed.
      const statusCode = (err as { statusCode?: number } | undefined)?.statusCode;
      if (statusCode === 400) {
        setErrorMsg(t('contribution.flagWrong.windowExpiredError'));
        onFlagged();
      } else {
        setErrorMsg(t('contribution.flagWrong.submitError'));
      }
      // eslint-disable-next-line no-console
      console.warn('[FlagWrongConfirmSheet] flag-wrong failed:', err);
    } finally {
      setSubmitting(false);
    }
  }, [accessToken, submissionId, onFlagged, onDismiss, t]);

  const handleDismiss = useCallback(() => {
    if (submitting) return; // ignore dismiss while in flight
    setErrorMsg(null);
    onDismiss();
  }, [submitting, onDismiss]);

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={handleDismiss}>
      <Pressable style={styles.overlay} onPress={handleDismiss} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title}>{t('contribution.flagWrong.confirmTitle')}</Text>
        <Text style={styles.body}>{t('contribution.flagWrong.confirmBody')}</Text>

        {errorMsg && <Text style={styles.error}>{errorMsg}</Text>}

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.button, styles.cancelButton]}
            onPress={handleDismiss}
            disabled={submitting}
            accessibilityRole="button"
          >
            <Text style={styles.cancelText}>{t('contribution.flagWrong.confirmCancel')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.confirmButton, submitting && styles.confirmDisabled]}
            onPress={() => void handleConfirm()}
            disabled={submitting}
            accessibilityRole="button"
          >
            {submitting ? (
              <ActivityIndicator size="small" color={tokens.brand.ink} />
            ) : (
              <Text style={styles.confirmText}>{t('contribution.flagWrong.confirmConfirm')}</Text>
            )}
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
  error: {
    fontSize: 13,
    color: tokens.price.expensive,
    textAlign: 'center',
    marginBottom: 16,
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
  cancelButton: {
    backgroundColor: tokens.neutral.n100,
  },
  confirmButton: {
    backgroundColor: tokens.brand.accent,
  },
  confirmDisabled: {
    opacity: 0.6,
  },
  cancelText: {
    fontSize: 16,
    color: tokens.brand.ink,
    fontWeight: '500',
  },
  confirmText: {
    fontSize: 16,
    color: tokens.brand.ink,
    fontWeight: '600',
  },
});
