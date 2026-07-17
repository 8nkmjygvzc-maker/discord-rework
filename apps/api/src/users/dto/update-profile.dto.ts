import { Equals, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { PresenceMode } from '@parley/shared';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(128, { message: 'Status darf höchstens 128 Zeichen lang sein' })
  status?: string;

  /**
   * Seit Phase 15 wird das Profilbild ausschließlich über POST /users/me/avatar
   * hochgeladen; hier ist nur noch '' erlaubt (Bild entfernen). Beliebige URLs
   * wären ein Privacy-Leak: Avatare werden bei ALLEN sichtbaren Nutzern als
   * <img> gerendert – eine externe URL könnte deren IP-Adressen einsammeln.
   */
  @IsOptional()
  @Equals('', { message: 'Profilbilder werden über den Upload gesetzt' })
  avatarUrl?: string;

  /** Wie avatarUrl: nur '' erlaubt (Banner entfernen), gesetzt wird per Upload. */
  @IsOptional()
  @Equals('', { message: 'Banner werden über den Upload gesetzt' })
  bannerUrl?: string;

  /** Anwesenheits-Status: online, dnd (Nicht stören) oder invisible (Offline). */
  @IsOptional()
  @IsIn(['online', 'dnd', 'invisible'], { message: 'Ungültiger Anwesenheits-Status' })
  presence?: PresenceMode;
}
