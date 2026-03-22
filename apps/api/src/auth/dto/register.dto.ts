import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class RegisterDto {
  @IsEmail()
  @Transform(({ value }: { value: string }) => value.trim().toLowerCase())
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @Transform(({ value }: { value: string }) => value.trim())
  displayName!: string;
}
