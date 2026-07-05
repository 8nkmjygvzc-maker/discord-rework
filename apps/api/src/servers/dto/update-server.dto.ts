import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class UpdateServerDto {
  @IsOptional()
  @IsString()
  @Length(2, 100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  iconUrl?: string;
}
