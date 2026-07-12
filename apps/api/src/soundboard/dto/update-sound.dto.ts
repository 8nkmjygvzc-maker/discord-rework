import { IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { MAX_SOUNDBOARD_NAME_LENGTH } from '@parley/shared';

/** Body von PATCH /servers/:id/soundboard/:soundId (JSON, kein Upload). */
export class UpdateSoundDto {
  @IsOptional()
  @IsString()
  @Length(1, MAX_SOUNDBOARD_NAME_LENGTH)
  name?: string;

  // @IsOptional() lässt neben undefined auch null durch – null ENTFERNT das
  // Emoji (wie color bei Rollen); die Plausibilität prüft der Service.
  @IsOptional()
  @IsString()
  @Length(1, 32)
  emoji?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0.05)
  @Max(1)
  volume?: number;
}
