import { Type } from 'class-transformer';
import { IsNotEmpty, IsString, ValidateNested } from 'class-validator';

/** Öffentliche Client-Schlüssel aus der Browser-PushSubscription. */
export class PushKeysDto {
  @IsString()
  @IsNotEmpty()
  p256dh!: string;

  @IsString()
  @IsNotEmpty()
  auth!: string;
}

/** Body von POST /api/push/subscribe (entspricht PushSubscription.toJSON()). */
export class SubscribeDto {
  @IsString()
  @IsNotEmpty()
  endpoint!: string;

  @ValidateNested()
  @Type(() => PushKeysDto)
  keys!: PushKeysDto;
}

/** Body von POST /api/push/unsubscribe. */
export class UnsubscribeDto {
  @IsString()
  @IsNotEmpty()
  endpoint!: string;
}
