import { IsString, Length } from 'class-validator';

export class CreateChannelDto {
  @IsString()
  @Length(2, 100)
  name!: string;
}
