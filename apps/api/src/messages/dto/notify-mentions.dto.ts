import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';

/**
 * Body von POST /api/channels/:id/notify-mentions (Phase 12). Der sendende
 * Client meldet die per @-Erwähnung angesprochenen Kanal-Mitglieder – der
 * Server pusht die offline unter ihnen (inhaltsarm). Erwähnungen selbst stecken
 * E2E-verschlüsselt im Nachrichtentext und sind serverseitig nicht erkennbar.
 */
export class NotifyMentionsDto {
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  userIds!: string[];
}
