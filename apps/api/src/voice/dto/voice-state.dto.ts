import { IsBoolean } from 'class-validator';

/**
 * Body von PATCH /api/voice/channels/:id/state. Der Client meldet seinen
 * selbst gewählten Zustand (Mute/Deafen) und ob er aktuell Kamera bzw.
 * Bildschirm sendet (Phase 11) – die Medien-Wahrheit liegt beim SFU, dies
 * ist nur die Roster-Anzeige.
 */
export class VoiceStateDto {
  @IsBoolean()
  muted!: boolean;

  @IsBoolean()
  deafened!: boolean;

  @IsBoolean()
  cameraOn!: boolean;

  @IsBoolean()
  screenOn!: boolean;
}
