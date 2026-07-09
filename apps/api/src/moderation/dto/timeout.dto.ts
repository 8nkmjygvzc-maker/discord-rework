import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import {
  MAX_TIMEOUT_SECONDS,
  MIN_TIMEOUT_SECONDS,
  MODERATION_REASON_MAX_LENGTH,
} from '@parley/shared';

/** Body für PUT …/timeout (Phase 13): Auszeit-Dauer + optionale Begründung. */
export class TimeoutDto {
  @IsInt()
  @Min(MIN_TIMEOUT_SECONDS)
  @Max(MAX_TIMEOUT_SECONDS)
  durationSeconds!: number;

  @IsOptional()
  @IsString()
  @MaxLength(MODERATION_REASON_MAX_LENGTH)
  reason?: string;
}
