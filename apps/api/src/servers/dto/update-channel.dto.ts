import { IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

export class UpdateChannelDto {
  @IsOptional()
  @IsString()
  @Length(2, 100)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}
