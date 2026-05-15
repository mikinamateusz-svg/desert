// Story 2.19 — Pin monogram lookup for the chain badge on map pins.
//
// Keep separate from `BrandLogo`'s BRAND_STYLES map (which drives the
// 44×44 colored badge in the station detail sheet). The pin monogram
// is intentionally a flat 2-char uppercase token rendered as a small
// neutral chip above the price pin — no chain colour, no logo, no
// per-brand styling. The pin colour is reserved for price-tier
// signalling; the monogram chip is reserved for chain identity.
//
// `null` return = no monogram rendered. Used for independent stations
// (absence of badge is itself the signal) and unknown brand strings.

const BRAND_MONOGRAM: Record<string, string> = {
  orlen: 'OR',
  bp: 'BP',
  shell: 'SH',
  lotos: 'LO',
  circle_k: 'CK',
  moya: 'MO',
  amic: 'AM',
  avia: 'AV',
  auchan: 'AU',
  pieprzyk: 'PI',
  huzar: 'HU',
  carrefour: 'CA',
};

export function brandMonogram(brand: string | null | undefined): string | null {
  if (!brand) return null;
  const key = brand.toLowerCase();
  return BRAND_MONOGRAM[key] ?? null;
}

// Canonical brand list for the chain filter sheet. Order = display order.
// `independent` is included so drivers who tank at unbranded stations can
// filter to those explicitly. Keep in sync with BRAND_MONOGRAM above
// (independent has no monogram — rendered as a "—" placeholder).
export const FILTERABLE_BRANDS = [
  'orlen',
  'bp',
  'shell',
  'lotos',
  'circle_k',
  'moya',
  'amic',
  'avia',
  'auchan',
  'pieprzyk',
  'huzar',
  'carrefour',
  'independent',
] as const;

export type FilterableBrand = (typeof FILTERABLE_BRANDS)[number];
