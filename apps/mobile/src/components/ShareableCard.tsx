import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { tokens } from '../theme';

export interface ShareableCardProps {
  /** Pre-formatted month label, e.g. "March 2026" or "marzec 2026". */
  monthLabel: string;
  /** PLN saved that month. Always > 0 when this component renders (AC4
   *  guarded at the screen level — never share negative outcomes). */
  totalSavingsPln: number;
  fillupCount: number;
  /** null when Story 6.7 hasn't shipped or the user has no ranking yet —
   *  ranking pill is omitted gracefully (AC3). */
  rankingPercentile: number | null;
  /** Voivodeship slug for the ranking pill, e.g. "mazowieckie". */
  rankingVoivodeship: string | null;
  /** Locale tag (e.g. 'pl', 'en') — used to format the savings amount
   *  with locale-correct decimal separator (PL/UK = comma). */
  locale: string;
}

/**
 * Pure presentational card rendered as a React Native View, captured to
 * a PNG by the parent screen using react-native-view-shot.
 *
 * Display size 320×320 (looks fine inline as a preview); the parent's
 * ViewShot is configured with `pixelRatio: 2` → captured at 640×640 px,
 * a good balance of quality vs file size for WhatsApp / Instagram
 * Stories upload.
 *
 * Branding rules:
 *   - Amber stripe top + bottom (brand.accent #f59e0b)
 *   - Brand wordmark "desert" at the bottom in brand.ink
 *   - No emoji in the captured view — Android emoji rendering is
 *     inconsistent inside view-shot captures (per spec note); use plain
 *     text labels and SVG icons if needed.
 *
 * The parent attaches a ref to the wrapping `<ViewShot>` element, not
 * to this component — capture happens at the ViewShot boundary.
 */
export function ShareableCard({
  monthLabel,
  totalSavingsPln,
  fillupCount,
  rankingPercentile,
  rankingVoivodeship,
  locale,
}: ShareableCardProps) {
  const { t } = useTranslation();
  const amountLabel = formatAmountForLocale(totalSavingsPln, locale);

  return (
    <View style={styles.card} collapsable={false}>
      {/* Top amber stripe — toLocaleUpperCase respects locale rules
          (Turkish dotless-i etc.). numberOfLines + adjustsFontSizeToFit
          guard against long Cyrillic month names like "ВЕРЕСЕНЬ 2026"
          overflowing the 320px stripe at letterSpacing 2. */}
      <View style={styles.topStripe}>
        <Text
          style={styles.monthLabel}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
        >
          {safeUpper(monthLabel, locale)}
        </Text>
      </View>

      {/* Body */}
      <View style={styles.body}>
        <Text style={styles.savedLabel}>{t('savingsCard.saved')}</Text>
        <Text style={styles.amount}>
          {amountLabel} <Text style={styles.amountUnit}>PLN</Text>
        </Text>
        <Text style={styles.subline}>{t('savingsCard.onFuelThisMonth')}</Text>

        <View style={styles.divider} />

        {/* Plural-aware count — Polish/Ukrainian have multiple plural
            forms (one/few/many/other). The card is publicly shared, so
            grammatical correctness matters. */}
        <Text style={styles.fillupCount}>
          {t('savingsCard.fillupCount', { count: fillupCount })}
        </Text>

        {/* Ranking pill — only when Story 6.7 has populated the data.
            Conditional render so layout has no visible gap when null. */}
        {rankingPercentile !== null && rankingVoivodeship && (
          <View style={styles.rankingPill}>
            <Text style={styles.rankingText}>
              {t('savingsCard.topPercent', {
                pct: rankingPercentile,
                region: rankingVoivodeship,
              })}
            </Text>
          </View>
        )}
      </View>

      {/* Bottom amber stripe with brand wordmark */}
      <View style={styles.bottomStripe}>
        <Text style={styles.brandWordmark}>desert</Text>
        <Text style={styles.brandTagline}>{t('savingsCard.brandTagline')}</Text>
      </View>
    </View>
  );
}

// ── Locale helpers ─────────────────────────────────────────────────────────

/**
 * Format a monetary amount with locale-correct decimal separator. Three
 * paths to the same outcome:
 *   1. toLocaleString throws → catch → use the manual PL/UK comma path
 *      OR fall back to toFixed for English.
 *   2. toLocaleString silently emits ASCII (Hermes Android with limited
 *      ICU) → detect missing comma for PL/UK locales → manual swap.
 *   3. Happy path: toLocaleString returns the right separator already.
 *
 * Manual swap is intentionally simple — `replace('.', ',')` handles the
 * grosz-precision values we generate (always 2 decimals), so there's no
 * thousand-separator corner case to worry about for amounts < 1000 PLN
 * (the realistic monthly max for a single driver).
 */
function formatAmountForLocale(value: number, locale: string): string {
  const usesComma = isCommaDecimalLocale(locale);
  let formatted: string;
  try {
    formatted = value.toLocaleString(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    formatted = value.toFixed(2);
  }
  // Hermes Android can return ASCII even for pl/uk when ICU data is
  // limited — patch the separator manually so the publicly-shared PNG
  // matches the user's locale.
  if (usesComma && formatted.includes('.')) {
    formatted = formatted.replace('.', ',');
  }
  return formatted;
}

function isCommaDecimalLocale(locale: string): boolean {
  // BCP-47 language tag: 'pl', 'pl-PL', 'uk', 'uk-UA' all start with the
  // bare 2-letter primary code.
  const primary = locale.toLowerCase().split('-')[0];
  return primary === 'pl' || primary === 'uk';
}

function safeUpper(value: string, locale: string): string {
  // toLocaleUpperCase falls back to plain toUpperCase if the locale is
  // unknown — preserves correctness on Hermes' limited ICU. The
  // try/catch guards the rare RangeError from a malformed tag like 'dev'.
  try {
    return value.toLocaleUpperCase(locale);
  } catch {
    return value.toUpperCase();
  }
}

// Card is rendered at 320×320 display size. ViewShot pixelRatio: 2 →
// 640px PNG. Layout uses absolute pixel values rather than %s so the
// captured image is identical across devices.
const CARD_SIZE = 320;
const STRIPE_TOP = 60;
const STRIPE_BOTTOM = 50;

const styles = StyleSheet.create({
  card: {
    width: CARD_SIZE,
    height: CARD_SIZE,
    backgroundColor: tokens.surface.card,
    borderRadius: tokens.radius.lg,
    overflow: 'hidden',
  },
  topStripe: {
    height: STRIPE_TOP,
    backgroundColor: tokens.brand.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  monthLabel: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 2,
    color: tokens.neutral.n0,
  },
  body: {
    flex: 1,
    paddingHorizontal: 24,
    paddingVertical: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  savedLabel: {
    fontSize: 14,
    color: tokens.neutral.n500,
    fontWeight: '500',
  },
  amount: {
    fontSize: 44,
    fontWeight: '700',
    color: tokens.brand.ink,
    marginVertical: 4,
    textAlign: 'center',
  },
  amountUnit: {
    fontSize: 24,
    fontWeight: '600',
    color: tokens.neutral.n500,
  },
  subline: {
    fontSize: 13,
    color: tokens.neutral.n500,
    textAlign: 'center',
  },
  divider: {
    width: 60,
    height: 1,
    backgroundColor: tokens.neutral.n200,
    marginVertical: 14,
  },
  fillupCount: {
    fontSize: 14,
    color: tokens.brand.ink,
    fontWeight: '600',
  },
  rankingPill: {
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: tokens.radius.full,
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: tokens.brand.accent,
  },
  rankingText: {
    fontSize: 12,
    color: tokens.brand.accent,
    fontWeight: '600',
  },
  bottomStripe: {
    height: STRIPE_BOTTOM,
    backgroundColor: tokens.brand.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  brandWordmark: {
    fontSize: 16,
    fontWeight: '800',
    color: tokens.neutral.n0,
    letterSpacing: 1,
  },
  brandTagline: {
    fontSize: 9,
    fontWeight: '500',
    color: tokens.neutral.n0,
    opacity: 0.85,
    marginTop: 1,
    letterSpacing: 0.5,
  },
});
