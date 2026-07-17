import { ArrayMaxSize, ArrayNotEmpty, ArrayUnique, IsUUID } from 'class-validator';

// Die Liste muss GENAU alle Kanäle des Servers enthalten (Abgleich im Service) –
// so bleiben die Positionen lückenlos 0..n-1 und kein Kanal wird vergessen.
export class ReorderChannelsDto {
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  channelIds!: string[];
}
