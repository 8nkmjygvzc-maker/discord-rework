import { IsInt, IsNumberString, IsOptional, IsString, Length, Matches, Min } from 'class-validator';

export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  @Length(2, 100)
  name?: string;

  /** Bitfield als Dezimal-String (BigInt). */
  @IsOptional()
  @IsNumberString()
  permissions?: string;

  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'color muss ein Hex-Farbwert wie #5865f2 sein' })
  color?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}
