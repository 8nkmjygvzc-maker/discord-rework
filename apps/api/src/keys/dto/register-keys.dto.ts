import { IsString, Length } from 'class-validator';

/** Öffentliche Geräteschlüssel (Base64). Private Schlüssel kommen NIE hierher. */
export class RegisterKeysDto {
  /** Ed25519-Identitätsschlüssel (32 Byte → 43 Zeichen Base64). */
  @IsString()
  @Length(40, 60)
  identityKey!: string;

  /** X25519-Signed-Prekey (32 Byte). */
  @IsString()
  @Length(40, 60)
  signedPreKey!: string;

  /** Ed25519-Signatur über den Prekey (64 Byte → 86 Zeichen Base64). */
  @IsString()
  @Length(80, 100)
  signedPreKeySignature!: string;
}
