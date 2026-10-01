import { IsOptional, IsUUID } from 'class-validator';
import { TrimToNull } from '../../common/transformers';

/** Text fields of the multipart upload (besides `file`). */
export class UploadAttachmentDto {
  /** Optional: links the image to an existing ticket (answers, reject feedback). */
  @TrimToNull()
  @IsOptional()
  @IsUUID()
  ticketId?: string | null;
}
