import { IsObject, IsUUID } from 'class-validator';
import type { KeyEnvelopePayload } from '@parley/shared';

/**
 * Schlüssel-Umschlag an einen Nutzer. Der Payload ist Ende-zu-Ende
 * verschlüsselt – der Server validiert nur Empfänger und Größe (im Service),
 * nicht den Inhalt.
 */
export class SendEnvelopeDto {
  @IsUUID()
  toUserId!: string;

  @IsObject()
  payload!: KeyEnvelopePayload;
}
