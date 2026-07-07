import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AttachmentInfo } from '@parley/shared';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import type { AccessTokenPayload } from '../auth/auth.service';
import { RateLimit, RateLimitGuard } from '../common/rate-limit.guard';
import { AttachmentsService } from './attachments.service';

@Controller()
@UseGuards(AuthGuard, RateLimitGuard)
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  /**
   * Verschlüsselten Blob hochladen. Bewusst KEIN Multipart (kein multer):
   * Der Body ist der rohe Ciphertext als application/octet-stream –
   * express.raw (siehe main.ts) stellt ihn als Buffer bereit.
   */
  @Post('channels/:channelId/attachments')
  @RateLimit({ limit: 30, windowS: 60 })
  upload(
    @CurrentUser() user: AccessTokenPayload,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Req() req: Request,
  ): Promise<AttachmentInfo> {
    if (!Buffer.isBuffer(req.body)) {
      throw new BadRequestException('Anhang als application/octet-stream senden');
    }
    return this.attachments.upload(channelId, user.sub, req.body);
  }

  /** Ciphertext-Blob streamen; entschlüsselt wird ausschließlich im Client. */
  @Get('attachments/:id')
  @RateLimit({ limit: 120, windowS: 60 })
  async download(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StreamableFile> {
    const { stream, sizeBytes } = await this.attachments.download(id, user.sub);
    return new StreamableFile(stream, {
      type: 'application/octet-stream',
      length: sizeBytes,
    });
  }
}
