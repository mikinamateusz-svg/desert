export class StationDto {
  id!: string;
  name!: string;
  address!: string | null;
  google_places_id!: string | null;
  lat!: number;
  lng!: number;
}
