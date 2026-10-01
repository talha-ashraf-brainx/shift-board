import type { AttachmentDto } from '@agent-board/shared';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { In, QueryFailedError, Repository } from 'typeorm';
import { AppConfig } from '../config/app-config';
import { AttachmentEntity } from './attachment.entity';
import { attachmentUrl, cleanFilename, detectImage, MAX_ATTACHMENT_BYTES } from './image-files';

export interface UploadedImageFile {
  buffer: Buffer;
  originalname?: string;
}

/** An attachment loaded for the agent: base64 bytes ready for an image content block. */
export interface LoadedImage {
  id: string;
  filename: string;
  mediaType: string;
  data: string;
}

const UNAVAILABLE = 'Image storage is unavailable: check that MinIO (S3_ENDPOINT) is running';

function httpStatusOf(err: unknown): number | undefined {
  return (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
}

/** A short reason for logs: connection errors are AggregateErrors with only a `code` (e.g. ECONNREFUSED). */
function describe(err: unknown): string {
  const e = err as { code?: string; message?: string; name?: string };
  return e?.code || e?.message || e?.name || String(err);
}

function isNotFound(err: unknown): boolean {
  const name = (err as { name?: string })?.name;
  return name === 'NoSuchKey' || name === 'NotFound' || name === 'NoSuchBucket' || httpStatusOf(err) === 404;
}

/** Stores image attachments in the S3-compatible bucket (local MinIO by default) and indexes them in Postgres. */
@Injectable()
export class AttachmentsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AttachmentsService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private bucketReady: Promise<void> | null = null;

  constructor(
    config: AppConfig,
    @InjectRepository(AttachmentEntity) private readonly repo: Repository<AttachmentEntity>,
  ) {
    const { endpoint, region, bucket, accessKey, secretKey, forcePathStyle } = config.s3;
    this.bucket = bucket;
    this.s3 = new S3Client({
      endpoint,
      region,
      forcePathStyle,
      credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
      maxAttempts: 2,
      // Fail fast when the store is down; S3-compatible stores may not support the newer default checksums.
      requestHandler: { connectionTimeout: 3_000, requestTimeout: 30_000 },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  /** Creates the bucket in the background; the API boots (with a warning) when the store is down. */
  onApplicationBootstrap(): void {
    this.ensureBucket().then(
      () => this.logger.log(`Attachments bucket "${this.bucket}" is ready`),
      (err: unknown) =>
        this.logger.warn(
          `${UNAVAILABLE} (${describe(err)}). Image uploads fail until it is reachable.`,
        ),
    );
  }

  onModuleDestroy(): void {
    this.s3.destroy();
  }

  /** Memoized; a failure is forgotten so the next upload tries again (e.g. MinIO started later). */
  private ensureBucket(): Promise<void> {
    if (!this.bucketReady) {
      this.bucketReady = (async () => {
        try {
          await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
        } catch (err) {
          if (!isNotFound(err)) throw err;
          try {
            await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
          } catch (e) {
            const name = (e as { name?: string }).name;
            if (name !== 'BucketAlreadyOwnedByYou' && name !== 'BucketAlreadyExists') throw e;
          }
        }
      })().catch((err: unknown) => {
        this.bucketReady = null;
        throw err;
      });
    }
    return this.bucketReady;
  }

  toDto(a: AttachmentEntity): AttachmentDto {
    return {
      id: a.id,
      url: attachmentUrl(a.id),
      filename: a.originalFilename,
      contentType: a.contentType,
      sizeBytes: a.sizeBytes,
    };
  }

  async upload(file: UploadedImageFile | undefined, ticketId: string | null = null): Promise<AttachmentDto> {
    if (!file?.buffer?.length) throw new BadRequestException('Attach an image in the "file" field');
    if (file.buffer.length > MAX_ATTACHMENT_BYTES) throw new BadRequestException('Images must be at most 10 MB');
    const image = detectImage(file.buffer);
    if (!image) throw new UnsupportedMediaTypeException('Only PNG, JPEG, GIF and WebP images are supported');

    const id = randomUUID();
    const storageKey = `${id}.${image.ext}`;
    try {
      await this.ensureBucket();
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: storageKey,
          Body: file.buffer,
          ContentType: image.contentType,
          ContentLength: file.buffer.length,
        }),
      );
    } catch (err) {
      this.logger.warn(`Attachment upload failed: ${describe(err)}`);
      throw new ServiceUnavailableException(UNAVAILABLE);
    }

    try {
      const saved = await this.repo.save(
        this.repo.create({
          id,
          storageKey,
          originalFilename: cleanFilename(file.originalname, image.ext),
          contentType: image.contentType,
          sizeBytes: file.buffer.length,
          width: image.width,
          height: image.height,
          ticketId,
        }),
      );
      return this.toDto(saved);
    } catch (err) {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: storageKey })).catch(() => undefined);
      if (err instanceof QueryFailedError && (err.driverError as { code?: string })?.code === '23503') {
        throw new BadRequestException('Unknown ticketId');
      }
      throw err;
    }
  }

  /** The attachment row and a stream of its bytes. 404 when either is missing, 503 when the store is down. */
  async open(id: string): Promise<{ attachment: AttachmentEntity; body: Readable }> {
    const attachment = await this.repo.findOneBy({ id });
    if (!attachment) throw new NotFoundException('Attachment not found');
    try {
      const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: attachment.storageKey }));
      if (!res.Body) throw new NotFoundException('Attachment not found');
      return { attachment, body: res.Body as Readable };
    } catch (err) {
      if (err instanceof NotFoundException || isNotFound(err)) throw new NotFoundException('Attachment not found');
      this.logger.warn(`Attachment download failed: ${describe(err)}`);
      throw new ServiceUnavailableException(UNAVAILABLE);
    }
  }

  /**
   * Loads attachments for the agent, in the given order. Missing or unreadable ones are skipped with a log line,
   * as are images larger than `maxBytes` (the Claude API rejects big images). Never throws.
   */
  async loadImages(ids: readonly string[], maxBytes: number): Promise<LoadedImage[]> {
    if (ids.length === 0) return [];
    let rows: AttachmentEntity[];
    try {
      rows = await this.repo.findBy({ id: In([...ids]) });
    } catch (err) {
      this.logger.warn(`Could not look up attachments for the agent: ${describe(err)}`);
      return [];
    }
    const byId = new Map(rows.map((r) => [r.id, r]));
    const out: LoadedImage[] = [];
    for (const id of ids) {
      const row = byId.get(id);
      if (!row) {
        this.logger.warn(`Attachment ${id} is referenced but does not exist; skipping it`);
        continue;
      }
      if (row.sizeBytes > maxBytes) {
        this.logger.warn(`Attachment ${id} (${row.sizeBytes} bytes) is too large to send to the agent; skipping it`);
        continue;
      }
      try {
        const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: row.storageKey }));
        const bytes = await res.Body!.transformToByteArray();
        out.push({
          id,
          filename: row.originalFilename,
          mediaType: row.contentType,
          data: Buffer.from(bytes).toString('base64'),
        });
      } catch (err) {
        this.logger.warn(`Attachment ${id} could not be read from storage; skipping it (${describe(err)})`);
      }
    }
    return out;
  }
}
