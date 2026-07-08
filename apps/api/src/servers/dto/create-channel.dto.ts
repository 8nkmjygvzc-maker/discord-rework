import { IsIn, IsOptional, IsString, Length } from 'class-validator';

export class CreateChannelDto {
  @IsString()
  @Length(2, 100)
  name!: string;

  // Nur TEXT und VOICE sind aktuell anlegbar; VIDEO folgt in Phase 11, DM wird
  // separat verwaltet. Fehlt der Typ, entsteht ein Textkanal (Rückwärtskompat.).
  @IsOptional()
  @IsIn(['TEXT', 'VOICE'])
  type?: 'TEXT' | 'VOICE';
}
