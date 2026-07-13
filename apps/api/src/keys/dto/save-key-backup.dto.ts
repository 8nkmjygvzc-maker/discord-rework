import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/** Body von PUT /api/keys/backup – undurchsichtiger, clientseitig verschlüsselter Blob. */
export class SaveKeyBackupDto {
  @IsString()
  @MaxLength(128)
  salt!: string;

  @IsString()
  @MaxLength(128)
  nonce!: string;

  @IsString()
  @MaxLength(16 * 1024)
  ciphertext!: string;

  @IsOptional()
  @IsBoolean()
  onlyIfMissing?: boolean;
}
