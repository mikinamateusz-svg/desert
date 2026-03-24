import { IsString, MaxLength, MinLength } from 'class-validator';

export class SubmitFeedbackDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  message!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  app_version!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  os!: string;
}
