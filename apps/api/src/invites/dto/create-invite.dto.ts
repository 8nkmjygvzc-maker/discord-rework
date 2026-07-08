import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** Body von POST /api/servers/:id/invites. Beide Felder optional. */
export class CreateInviteDto {
  /** Maximale Einlösungen (1..1000); weglassen = unbegrenzt. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  maxUses?: number;

  /** Gültigkeitsdauer in Sekunden (1 min .. 30 Tage); weglassen = kein Ablauf. */
  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(2_592_000)
  expiresInSeconds?: number;
}
