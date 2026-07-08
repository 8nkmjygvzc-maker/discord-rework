import { IsBoolean } from 'class-validator';

/** Body von PATCH /api/voice/channels/:id/state (Mute/Deafen umschalten). */
export class VoiceStateDto {
  @IsBoolean()
  muted!: boolean;

  @IsBoolean()
  deafened!: boolean;
}
