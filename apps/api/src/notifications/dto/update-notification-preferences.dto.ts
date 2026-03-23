import { IsBoolean, IsOptional, IsString, ValidateIf } from 'class-validator';

export class UpdateNotificationPreferencesDto {
  @IsOptional()
  @ValidateIf((o: UpdateNotificationPreferencesDto) => o.expo_push_token !== null)
  @IsString()
  expo_push_token?: string | null;

  @IsOptional()
  @IsBoolean()
  price_drops?: boolean;

  @IsOptional()
  @IsBoolean()
  sharp_rise?: boolean;

  @IsOptional()
  @IsBoolean()
  monthly_summary?: boolean;
}
