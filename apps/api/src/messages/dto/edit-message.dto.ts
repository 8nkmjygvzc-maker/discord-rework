import { Type } from 'class-transformer';
import { IsObject, IsString, Length, ValidateNested } from 'class-validator';
import { MessageHeaderDto } from './send-message.dto';

/**
 * Body von PATCH /api/channels/:id/messages/:messageId (Phase 13). Wie beim
 * Senden nimmt der Server nur Ciphertext an – der Client hat den Text neu mit
 * dem aktuellen Sender-Key verschlüsselt. Anhänge bleiben unverändert.
 */
export class EditMessageDto {
  @IsString()
  @Length(1, 32768)
  ciphertext!: string;

  @IsString()
  @Length(16, 64)
  nonce!: string;

  @IsObject()
  @ValidateNested()
  @Type(() => MessageHeaderDto)
  header!: MessageHeaderDto;
}
