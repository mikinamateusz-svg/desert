import catalogJson from './vehicle-catalog-engines.batch1.json';

export type VehicleFuelType =
  | 'PB_95'
  | 'PB_98'
  | 'ON'
  | 'ON_PREMIUM'
  | 'LPG'
  | 'CNG'
  | 'EV'
  | 'PHEV';

export type CatalogConfidence = 'high' | 'medium' | 'low';

export interface CatalogEngine {
  name: string;
  displacement_cc: number | null;
  power_kw: number | null;
  power_hp: number | null;
  fuel_type: VehicleFuelType;
  transmission_options?: string[];
  year_from: number | null;
  year_to: number | null;
  confidence: CatalogConfidence;
}

export interface CatalogModel {
  /** Display label including the make prefix, e.g. "Volkswagen Golf". */
  key: string;
  wikidata_id: string;
  model_year_from: number | null;
  model_year_to: number | null;
  model_year_confidence: CatalogConfidence;
  engines: CatalogEngine[];
}

export interface VehicleCatalog {
  $schema_version: number;
  generated_at: string;
  source: string;
  batch: string;
  makes: Record<string, CatalogModel[]>;
}

export const vehicleCatalog = catalogJson as unknown as VehicleCatalog;

export function getMakes(): string[] {
  return Object.keys(vehicleCatalog.makes).sort((a, b) => a.localeCompare(b));
}

export function getModels(make: string): CatalogModel[] {
  const list = vehicleCatalog.makes[make];
  if (!list) return [];
  return [...list].sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Strip the make prefix from a model key so the dropdown shows "Golf" rather
 * than "Volkswagen Golf". Falls back to the raw key when the prefix is absent.
 */
export function getModelDisplayName(make: string, model: CatalogModel): string {
  const prefix = `${make} `;
  return model.key.startsWith(prefix) ? model.key.slice(prefix.length) : model.key;
}

/**
 * Year list for a model, newest first. Bounded by:
 *   - `model_year_from` (catalog floor; falls back to 1980 — story year cutoff)
 *   - `model_year_to` (catalog ceiling; falls back to current year + 1 for
 *     models still in production — buyers picking up next year's plate edition)
 */
export function getYearsForModel(model: CatalogModel): number[] {
  const currentYearPlusOne = new Date().getFullYear() + 1;
  const from = model.model_year_from ?? 1980;
  const to = model.model_year_to ?? currentYearPlusOne;
  if (to < from) return [];
  const years: number[] = [];
  for (let y = to; y >= from; y--) years.push(y);
  return years;
}

/**
 * Engines available for a given model year. An engine without explicit year
 * bounds is treated as covering the full model lifespan (matches the catalog
 * convention where `year_from`/`year_to` is null when unknown but the engine
 * was sold across all generations).
 */
export function getEnginesForYear(model: CatalogModel, year: number): CatalogEngine[] {
  return model.engines.filter((e) => {
    const from = e.year_from ?? -Infinity;
    const to = e.year_to ?? Infinity;
    return year >= from && year <= to;
  });
}
