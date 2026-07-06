import { IsUUID } from 'class-validator';

/** Öffnet (oder findet) den DM-Kanal zu einem Nutzer. */
export class OpenDmDto {
  @IsUUID()
  userId!: string;
}
