import { IsString, Length } from 'class-validator';

/** Freundschaftsanfrage per Benutzername (wie bei Discord). */
export class AddFriendDto {
  @IsString()
  @Length(3, 40, { message: 'Benutzername muss 3–40 Zeichen lang sein' })
  username!: string;
}
