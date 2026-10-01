import type { AttachmentDto } from '@agent-board/shared';
import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AttachmentsService } from './attachments.service';
import { UploadAttachmentDto } from './dto/upload-attachment.dto';
import { MAX_ATTACHMENT_BYTES } from './image-files';

@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  /** Multipart, field `file`. Over 10 MB is a 413 (multer); non-images are a 415. */
  @Post()
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 } }),
  )
  upload(@UploadedFile() file: Express.Multer.File | undefined, @Body() body: UploadAttachmentDto): Promise<AttachmentDto> {
    return this.attachments.upload(file, body.ticketId ?? null);
  }

  /** Ids are random and objects never change, so the bytes can be cached forever. */
  @Get(':id')
  @Header('Cache-Control', 'private, max-age=31536000, immutable')
  @Header('X-Content-Type-Options', 'nosniff')
  async download(@Param('id', new ParseUUIDPipe()) id: string): Promise<StreamableFile> {
    const { attachment, body } = await this.attachments.open(id);
    return new StreamableFile(body, {
      type: attachment.contentType,
      length: attachment.sizeBytes,
      disposition: `inline; filename*=UTF-8''${encodeURIComponent(attachment.originalFilename)}`,
    });
  }
}
