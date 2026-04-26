// Canonical list of Polish voivodeship slugs as stored in Station.voivodeship.
// Mirrors the value set of VOIVODESHIP_SLUGS in station-classification.service.ts.
//
// Used by:
//  - admin freshness dashboard for voivodeship-filter sanitisation (story 4.8)
//  - any future feature that needs to enumerate or validate the 16 regions

export const VALID_VOIVODESHIPS = [
  'dolnoslaskie',
  'kujawsko-pomorskie',
  'lubelskie',
  'lubuskie',
  'lodzkie',
  'malopolskie',
  'mazowieckie',
  'opolskie',
  'podkarpackie',
  'podlaskie',
  'pomorskie',
  'slaskie',
  'swietokrzyskie',
  'warminsko-mazurskie',
  'wielkopolskie',
  'zachodniopomorskie',
] as const;

export type VoivodeshipSlug = (typeof VALID_VOIVODESHIPS)[number];

export function isValidVoivodeship(value: unknown): value is VoivodeshipSlug {
  return typeof value === 'string' && (VALID_VOIVODESHIPS as readonly string[]).includes(value);
}
