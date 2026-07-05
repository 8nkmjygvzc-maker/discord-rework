import { IsEmail, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'Bitte eine gültige E-Mail-Adresse angeben' })
  email!: string;

  @IsString()
  @MaxLength(128)
  password!: string;
}
