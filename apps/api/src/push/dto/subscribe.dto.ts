import { Type } from 'class-transformer';
import { IsNotEmpty, IsString, IsUrl, MaxLength, ValidateNested } from 'class-validator';

/** Öffentliche Client-Schlüssel aus der Browser-PushSubscription. */
export class PushKeysDto {
  // p256dh = 65-Byte-P-256-Punkt base64url (~88 Zeichen), auth = 16 Byte (~22).
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  p256dh!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  auth!: string;
}

/** Body von POST /api/push/subscribe (entspricht PushSubscription.toJSON()). */
export class SubscribeDto {
  // Der Server sendet später Requests an diese URL – nur https zulassen,
  // sonst ließe sich die API als Relay gegen beliebige (interne) HTTP-Ziele
  // missbrauchen. Echte Browser-Push-Endpoints sind immer https; zusätzlich
  // prüft web-push das TLS-Zertifikat des Ziels (interne Ziele ohne vertrautes
  // Zertifikat scheitern also ohnehin). require_tld false erlaubt localhost
  // für lokale Tests.
  @IsUrl({ protocols: ['https'], require_protocol: true, require_tld: false })
  @MaxLength(2048)
  endpoint!: string;

  @ValidateNested()
  @Type(() => PushKeysDto)
  keys!: PushKeysDto;
}

/** Body von POST /api/push/unsubscribe. */
export class UnsubscribeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  endpoint!: string;
}
