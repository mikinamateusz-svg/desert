import { IsString, IsNotEmpty, IsOptional, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class FullNameDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  givenName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  familyName?: string | null;
}

export class AppleAuthDto {
  @IsString()
  @IsNotEmpty()
  identityToken!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => FullNameDto)
  fullName?: FullNameDto | null;
}
