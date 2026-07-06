import { Type } from 'class-transformer';
import {
  Equals,
  IsInt,
  IsObject,
  IsString,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';

/** Klartext-Header der E2EE-Nachricht (EncryptedMessageHeader aus @parley/shared). */
export class MessageHeaderDto {
  @Equals(1)
  v!: 1;

  @IsString()
  @Length(1, 64)
  keyId!: string;

  @IsInt()
  @Min(0)
  iteration!: number;

  @IsString()
  @Length(1, 128)
  signature!: string;
}

/**
 * Seit Phase 6 nimmt der Server nur noch Ciphertext an – er kann und soll
 * Inhalte nicht prüfen. Größenlimits verhindern Missbrauch als Datei-Ablage
 * (4000 Zeichen Klartext ≈ 5,5 KiB Base64; Limit lässt Luft für UTF-8).
 */
export class SendMessageDto {
  @IsString()
  @Length(1, 24576)
  ciphertext!: string;

  @IsString()
  @Length(16, 64)
  nonce!: string;

  @IsObject()
  @ValidateNested()
  @Type(() => MessageHeaderDto)
  header!: MessageHeaderDto;
}
