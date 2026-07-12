import { Equals, IsOptional, IsString, Length } from 'class-validator';

export class UpdateServerDto {
  @IsOptional()
  @IsString()
  @Length(2, 100)
  name?: string;

  /**
   * Seit Phase 15 wird das Icon ausschließlich über POST /servers/:id/icon
   * hochgeladen; hier ist nur noch '' erlaubt (Icon entfernen). Beliebige
   * URLs wären ein Privacy-Leak (siehe UpdateProfileDto.avatarUrl).
   */
  @IsOptional()
  @Equals('', { message: 'Server-Icons werden über den Upload gesetzt' })
  iconUrl?: string;
}
