import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class GoogleAuthDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  idToken!: string;
}
