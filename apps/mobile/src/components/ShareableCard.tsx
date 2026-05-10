import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { tokens } from '../theme';
import { formatIntegerForLocale } from '../utils/formatNumber';

export interface ShareableCardProps {
  /** Pre-formatted month label, e.g. "March 2026" or "marzec 2026". */
  monthLabel: string;
  /** PLN saved that month. Always > 0 when this component renders (AC4
   *  guarded at the screen level — never share negative outcomes). */
  totalSavingsPln: number;
  fillupCount: number;
  /** Story 5.8: 1–100, lower is better. null when cohort <10 (privacy
   *  floor) or the user has no positive savings — ranking pill is
   *  omitted gracefully. */
  rankingPercentile: number | null;
  /** Story 5.9: integer PLN of the cohort's best saver. null when
   *  the cohort threshold isn't met OR when the viewer IS the max
   *  (leak guard at the service boundary — the recipient could
   *  otherwise infer the viewer's own savings from this amount). */
  bestSaverSavingsPln: number | null;
  /** Locale tag (e.g. 'pl', 'en') — used to format the savings amount
   *  with locale-correct decimal separator (PL/UK = comma). */
  locale: string;
}

/**
 * Pure presentational card rendered as a React Native View, captured to
 * a PNG by the parent screen using react-native-view-shot.
 *
 * Display size 320×320 (looks fine inline as a preview); the parent's
 * ViewShot is configured with `width/height: 640` → captured at 640×640 px,
 * a good balance of quality vs file size for WhatsApp / Instagram
 * Stories upload. (`pixelRatio` doesn't exist on react-native-view-shot
 * 4.x's CaptureOptions, despite common references suggesting it does.)
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
  bestSaverSavingsPln,
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

        {/* Story 5.8 ranking pill — region-free copy ("top X% of savers").
            Conditional render so layout has no visible gap when null.
            Voivodeship is intentionally NEVER passed in or rendered —
            the cohort scoping stays server-side so the captured PNG
            can't leak the user's region to share recipients. */}
        {rankingPercentile !== null && (
          <View style={styles.rankingPill}>
            <Text style={styles.rankingText}>
              {t('savingsCard.topPercent', { pct: rankingPercentile })}
            </Text>
          </View>
        )}

        {/* Story 5.9 best-saver line — visually subordinate to the pill
            so it reads as context, not the headline. Server-side leak
            guard already suppressed the value when the viewer IS the
            max; if it arrives non-null here it's safe to render.
            Gated on rankingPercentile too so an inconsistently-shaped
            server response (e.g. a stale cache returning bestSaver
            without percentile) can't render an orphaned line that
            looks like an unanchored "this number you don't know about
            in some unspecified cohort". */}
        {rankingPercentile !== null && bestSaverSavingsPln !== null && (
          <Text style={styles.bestSaverLine} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
            {t('savingsCard.bestSaverLine', {
              amount: formatIntegerForLocale(bestSaverSavingsPln, locale),
            })}
          </Text>
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
    // Story 5.9: tightened from 14 → 10 to absorb the added best-saver
    // line height without risking vertical clipping at the bottom of
    // the 320×320 card. Body usable height ≈ 170px; with all sections
    // populated (savedLabel + amount + subline + divider + fillupCount
    // + rankingPill + bestSaverLine) the stacked content is right at
    // the limit on Hermes Android with taller Cyrillic line metrics.
    marginVertical: 10,
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
  bestSaverLine: {
    fontSize: 11,
    color: tokens.neutral.n500,
    marginTop: 8,
    textAlign: 'center',
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
