import { IsString, Length } from 'class-validator';

export class CreateServerDto {
  @IsString()
  @Length(2, 100)
  name!: string;
}
