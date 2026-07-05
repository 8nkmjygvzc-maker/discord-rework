import { IsEmail, Matches, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @Matches(/^[a-zA-Z0-9_.]+$/, {
    message: 'Benutzername darf nur Buchstaben, Zahlen, Punkt und Unterstrich enthalten',
  })
  @MinLength(3, { message: 'Benutzername muss mindestens 3 Zeichen lang sein' })
  @MaxLength(32, { message: 'Benutzername darf höchstens 32 Zeichen lang sein' })
  username!: string;

  @IsEmail({}, { message: 'Bitte eine gültige E-Mail-Adresse angeben' })
  email!: string;

  @MinLength(8, { message: 'Passwort muss mindestens 8 Zeichen lang sein' })
  @MaxLength(128, { message: 'Passwort darf höchstens 128 Zeichen lang sein' })
  password!: string;
}
