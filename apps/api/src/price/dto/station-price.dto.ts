export class StationPriceDto {
  stationId!: string;
  prices!: Record<string, number>; // keys: 'PB_95' | 'PB_98' | 'ON' | 'ON_PREMIUM' | 'LPG'
  updatedAt!: string; // ISO string
}
