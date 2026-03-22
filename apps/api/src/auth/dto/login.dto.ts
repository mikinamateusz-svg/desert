import { IsEmail, IsString, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class LoginDto {
  @IsEmail()
  @Transform(({ value }: { value: string }) => value.trim().toLowerCase())
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}
