import { IsString, Length, Matches } from 'class-validator';
import { MAX_STICKER_NAME_LENGTH } from '@parley/shared';

/**
 * Metadaten eines Sticker-Uploads. Sie reisen als QUERY-Parameter, weil der
 * Request-Body das rohe Bild ist (application/octet-stream, gleiche Mechanik
 * wie Anhänge und Soundboard-Sounds – bewusst kein Multipart/multer).
 */
export class CreateStickerDto {
  @IsString()
  @Length(1, MAX_STICKER_NAME_LENGTH)
  name!: string;

  /** MIME-Typ der Datei – nur image/* ist erlaubt (Render-Hinweis für Clients). */
  @Matches(/^image\/[\w.+-]{1,64}$/, { message: 'mimeType muss ein image/*-Typ sein' })
  mimeType!: string;
}
