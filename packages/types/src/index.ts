// Fuel types — standard grade names used throughout the platform
export type FuelType = 'PB_95' | 'PB_98' | 'ON' | 'ON_PREMIUM' | 'LPG';

// User roles — maps to NestJS RBAC guards
export type UserRole =
  | 'DRIVER'
  | 'STATION_MANAGER'
  | 'FLEET_MANAGER'
  | 'ADMIN'
  | 'DATA_BUYER';
