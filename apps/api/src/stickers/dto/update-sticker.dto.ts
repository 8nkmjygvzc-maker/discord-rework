import { IsOptional, IsString, Length } from 'class-validator';
import { MAX_STICKER_NAME_LENGTH } from '@parley/shared';

/** Body von PATCH /servers/:id/stickers/:stickerId – aktuell nur Umbenennen. */
export class UpdateStickerDto {
  @IsOptional()
  @IsString()
  @Length(1, MAX_STICKER_NAME_LENGTH)
  name?: string;
}
