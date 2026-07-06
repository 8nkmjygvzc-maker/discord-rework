import { IsString, Length } from 'class-validator';

export class CreateRoleDto {
  @IsString()
  @Length(2, 100)
  name!: string;
}
