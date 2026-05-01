// Fuel types — standard grade names used throughout the platform
export type FuelType = 'PB_95' | 'PB_98' | 'ON' | 'ON_PREMIUM' | 'LPG';

// User roles — maps to NestJS RBAC guards
export type UserRole =
  | 'DRIVER'
  | 'STATION_MANAGER'
  | 'FLEET_MANAGER'
  | 'ADMIN'
  | 'DATA_BUYER';

// Vehicle catalog — make/model/year/engine dictionary used by Story 5.1
// vehicle-setup screen and the api `/v1/me/vehicles` validators.
export {
  vehicleCatalog,
  getMakes,
  getModels,
  getModelDisplayName,
  getYearsForModel,
  getEnginesForYear,
} from './vehicle-catalog.js';
export type {
  VehicleCatalog,
  VehicleFuelType,
  CatalogModel,
  CatalogEngine,
  CatalogConfidence,
} from './vehicle-catalog.js';
