import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Story 6.6 — AsyncStorage keys + two-strike rule for the smart
 * notification re-prompt sheet.
 *
 * Once both the photo-trigger and the monthly-trigger have shown, the
 * driver's decision is respected permanently (AC4). A reinstall resets
 * — accepted because reinstalls are rare relative to user fatigue from
 * repeated prompts.
 */

export const REPROMPT_PHOTO_KEY = '@reprompt:photo_shown';
export const REPROMPT_MONTHLY_KEY = '@reprompt:monthly_shown';

/**
 * AC4 — true when both trigger flags are set; the caller should skip any
 * further re-prompt evaluation entirely. Errors fail-closed (treat as
 * "skip") so an AsyncStorage hiccup can't accidentally surface a third
 * prompt to a driver who already saw both.
 */
export async function shouldSkipAllReprompts(): Promise<boolean> {
  try {
    const [photo, monthly] = await Promise.all([
      AsyncStorage.getItem(REPROMPT_PHOTO_KEY),
      AsyncStorage.getItem(REPROMPT_MONTHLY_KEY),
    ]);
    return photo !== null && monthly !== null;
  } catch {
    return true;
  }
}

/**
 * AC3 — true when this specific trigger has already been shown.
 * Errors fail-closed (treat as "already shown") for the same reason as
 * shouldSkipAllReprompts.
 */
export async function hasShownReprompt(key: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(key)) !== null;
  } catch {
    return true;
  }
}

/**
 * AC5/AC6 — record that a re-prompt was shown for a trigger. Called on
 * any terminal outcome (Enable / No thanks / OS denial) so the trigger
 * doesn't fire again. Best-effort: AsyncStorage failure means the
 * trigger may fire one more time — preferable to throwing inside the
 * sheet's onDismiss path.
 */
export async function recordRepromptShown(key: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key, 'true');
  } catch {
    // Best-effort.
  }
}
