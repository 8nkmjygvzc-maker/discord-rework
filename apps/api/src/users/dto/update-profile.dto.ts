import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(128, { message: 'Status darf höchstens 128 Zeichen lang sein' })
  status?: string;

  @IsOptional()
  @IsUrl({ require_tld: false }, { message: 'Avatar muss eine gültige URL sein' })
  @MaxLength(512)
  avatarUrl?: string;
}
