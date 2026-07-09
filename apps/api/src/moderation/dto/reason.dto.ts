import { IsOptional, IsString, MaxLength } from 'class-validator';
import { MODERATION_REASON_MAX_LENGTH } from '@parley/shared';

/** Body für Kick/Bann (Phase 13): optionale Begründung fürs Audit-Log. */
export class ReasonDto {
  @IsOptional()
  @IsString()
  @MaxLength(MODERATION_REASON_MAX_LENGTH)
  reason?: string;
}
