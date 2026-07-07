import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  Equals,
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_ATTACHMENTS_PER_MESSAGE } from '@parley/shared';

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

  /** IDs zuvor hochgeladener Anhänge (Phase 8) – werden beim Senden gebunden. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ATTACHMENTS_PER_MESSAGE)
  @IsUUID('4', { each: true })
  attachmentIds?: string[];
}
