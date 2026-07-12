import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { MAX_SOUNDBOARD_NAME_LENGTH } from '@parley/shared';

/**
 * Metadaten eines Sound-Uploads. Sie reisen als QUERY-Parameter, weil der
 * Request-Body die rohe Audiodatei ist (application/octet-stream, wie bei den
 * Anhängen aus Phase 8 – bewusst kein Multipart/multer).
 */
export class CreateSoundDto {
  @IsString()
  @Length(1, MAX_SOUNDBOARD_NAME_LENGTH)
  name!: string;

  // Nur Länge/Typ hier – die Emoji-Plausibilität (isPlausibleReactionEmoji)
  // prüft der Service, class-validator kennt keine Emoji-Bausteine.
  @IsOptional()
  @IsString()
  @Length(1, 32)
  emoji?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.05)
  @Max(1)
  volume?: number;

  /** MIME-Typ der Datei – nur audio/* ist erlaubt (Wiedergabe-Hinweis für Clients). */
  @Matches(/^audio\/[\w.+-]{1,64}$/, { message: 'mimeType muss ein audio/*-Typ sein' })
  mimeType!: string;
}
