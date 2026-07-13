import { Type } from 'class-transformer';
import { IsInt, IsString, Length, Max, Min, ValidateNested } from 'class-validator';

/**
 * Grenzen des Zustands-Blobs: Base64-Ciphertext bis ~1 MiB. Der Blob wächst
 * mit der Zahl der Kanäle/Sessions – realistisch sind wenige hundert KiB.
 */
export const MAX_BACKUP_BLOB_CHARS = 1_400_000;

/** Ein AEAD-Ciphertext mit Nonce (beides Base64) – Form wie `SealedBox`. */
export class SealedBoxDto {
  /** XChaCha20-Poly1305-Nonce (24 Byte → 32 Zeichen Base64). */
  @IsString()
  @Length(30, 40)
  nonce!: string;

  @IsString()
  @Length(1, MAX_BACKUP_BLOB_CHARS)
  ciphertext!: string;
}

/** Umhüllter Master-Key: 32 Byte + AEAD-Tag → kurzer Ciphertext. */
export class WrappedKeyDto extends SealedBoxDto {
  @IsString()
  @Length(40, 100)
  declare ciphertext: string;
}

/** PUT /api/keys/backup – Backup einrichten bzw. komplett ersetzen. */
export class PutBackupDto {
  /** Argon2id-Salt (16 Byte → 22 Zeichen Base64). */
  @IsString()
  @Length(20, 30)
  kdfSalt!: string;

  /** Argon2id-Iterationen (libsodium-opslimit). */
  @IsInt()
  @Min(1)
  @Max(16)
  kdfOpsLimit!: number;

  /** Argon2id-Speicher in Byte (libsodium-memlimit), 8 MiB – 1 GiB. */
  @IsInt()
  @Min(8 * 1024 * 1024)
  @Max(1024 * 1024 * 1024)
  kdfMemLimit!: number;

  @ValidateNested()
  @Type(() => WrappedKeyDto)
  wrappedMasterKey!: WrappedKeyDto;

  @ValidateNested()
  @Type(() => SealedBoxDto)
  blob!: SealedBoxDto;
}

/** PUT /api/keys/backup/blob – nur den Zustands-Blob aktualisieren. */
export class PutBackupBlobDto {
  @ValidateNested()
  @Type(() => SealedBoxDto)
  blob!: SealedBoxDto;
}
