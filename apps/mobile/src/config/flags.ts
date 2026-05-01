/**
 * Build-time feature flags.
 *
 * Values come from EAS profile env vars (see `apps/mobile/eas.json`) which
 * Metro bakes into the JS bundle at build time. Flipping a flag requires a
 * rebuild — these are NOT runtime toggles.
 *
 * Defaults are deliberately permissive (ON) so local Expo Go sessions and
 * unconfigured profiles see all features. The `production` EAS profile
 * explicitly sets risky flags to "false" — defense in depth: even if a
 * production APK is accidentally built from a non-production branch, the
 * env-var override keeps Phase 2 dark for public users.
 *
 * Distribution mapping during beta:
 *   - production profile          → Play Store production / TestFlight external (public launch)
 *   - preview profile             → Play Store closed testing / TestFlight external group (friends & family beta — Phase 1 only)
 *   - preview-phase2 profile      → Play Store internal testing / TestFlight internal group (you + acceptance team — Phase 2 enabled)
 *   - development profile         → local dev only
 */
export const flags = {
  /**
   * Phase 2 mobile features: vehicle setup (Story 5.1), fill-up logging (5.2),
   * savings tracking (5.3+), consumption (5.4+).
   * When false: `log.tsx` renders the original "Coming Soon" placeholder, and
   * the vehicle setup / edit routes redirect back to the log tab.
   */
  phase2: process.env['EXPO_PUBLIC_PHASE_2'] !== 'false',
} as const;
