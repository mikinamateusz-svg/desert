import { IsString, IsNotEmpty, IsOptional, IsObject } from 'class-validator';

export class AppleAuthDto {
  @IsString()
  @IsNotEmpty()
  identityToken!: string;

  @IsOptional()
  @IsObject()
  fullName?: {
    givenName?: string | null;
    familyName?: string | null;
  } | null;
}
