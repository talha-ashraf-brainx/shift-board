import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { S3Client } from '@aws-sdk/client-s3';
import { QueryFailedError, type Repository } from 'typeorm';
import type { AppConfig } from '../config/app-config';
import type { AttachmentEntity } from './attachment.entity';
import { AttachmentsService } from './attachments.service';

const config = {
  s3: {
    endpoint: 'http://localhost:9000',
    region: 'us-east-1',
    bucket: 'test-bucket',
    accessKey: 'a',
    secretKey: 's',
    forcePathStyle: true,
  },
} as unknown as AppConfig;

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
  Buffer.from('IHDR', 'latin1'),
  Buffer.from([0, 0, 0, 2, 0, 0, 0, 3]),
]);

const commandName = (cmd: unknown) => (cmd as object).constructor.name;

function makeRepo(rows: AttachmentEntity[] = []) {
  return {
    create: jest.fn((x: Partial<AttachmentEntity>) => x),
    save: jest.fn(async (x: AttachmentEntity) => x),
    findOneBy: jest.fn(async ({ id }: { id: string }) => rows.find((r) => r.id === id) ?? null),
    findBy: jest.fn(async () => rows),
  };
}

describe('AttachmentsService', () => {
  let send: jest.SpyInstance;
  beforeEach(() => {
    send = jest.spyOn(S3Client.prototype, 'send').mockImplementation((async () => ({})) as never);
  });
  afterEach(() => send.mockRestore());

  const service = (repo = makeRepo()) =>
    new AttachmentsService(config, repo as unknown as Repository<AttachmentEntity>);

  it('stores a PNG under <id>.png and returns the DTO', async () => {
    const repo = makeRepo();
    const dto = await service(repo).upload({ buffer: PNG, originalname: 'shot.png' });
    expect(dto).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      url: `/api/attachments/${dto.id}`,
      filename: 'shot.png',
      contentType: 'image/png',
      sizeBytes: PNG.length,
    });
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ storageKey: `${dto.id}.png`, width: 2, height: 3, ticketId: null }),
    );
    const put = send.mock.calls.map((c) => c[0]).find((c) => commandName(c) === 'PutObjectCommand');
    expect(put.input).toMatchObject({ Bucket: 'test-bucket', Key: `${dto.id}.png`, ContentType: 'image/png' });
  });

  it('validates by magic bytes, not by the declared type', async () => {
    const svc = service();
    await expect(svc.upload({ buffer: Buffer.from('<svg/>'), originalname: 'x.png' })).rejects.toBeInstanceOf(
      UnsupportedMediaTypeException,
    );
    await expect(svc.upload(undefined)).rejects.toBeInstanceOf(BadRequestException);
    expect(send).not.toHaveBeenCalled();
  });

  it('answers 503 when the store is unreachable, and retries the bucket next time', async () => {
    send.mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { name: 'Error' }));
    const svc = service();
    await expect(svc.upload({ buffer: PNG })).rejects.toBeInstanceOf(ServiceUnavailableException);
    send.mockResolvedValue({});
    await expect(svc.upload({ buffer: PNG })).resolves.toMatchObject({ contentType: 'image/png' });
  });

  it('creates the bucket when it does not exist', async () => {
    send.mockImplementation((async (cmd: unknown) => {
      if (commandName(cmd) === 'HeadBucketCommand') throw Object.assign(new Error('nf'), { name: 'NotFound' });
      return {};
    }) as never);
    await service().upload({ buffer: PNG });
    expect(send.mock.calls.map((c) => commandName(c[0]))).toEqual([
      'HeadBucketCommand',
      'CreateBucketCommand',
      'PutObjectCommand',
    ]);
  });

  it('rejects an unknown ticketId and removes the stored object', async () => {
    const repo = makeRepo();
    repo.save.mockRejectedValue(new QueryFailedError('INSERT', [], Object.assign(new Error('fk'), { code: '23503' })));
    await expect(service(repo).upload({ buffer: PNG }, '0f8fad5b-d9cb-469f-a165-70867728950e')).rejects.toThrow(
      'Unknown ticketId',
    );
    expect(send.mock.calls.map((c) => commandName(c[0]))).toContain('DeleteObjectCommand');
  });

  it('open() is a 404 for unknown ids', async () => {
    await expect(service().open('0f8fad5b-d9cb-469f-a165-70867728950e')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('loadImages() returns base64 in the requested order and skips missing or unreadable ones', async () => {
    const row = (id: string, sizeBytes = 3) =>
      ({ id, storageKey: `${id}.png`, originalFilename: `${id}.png`, contentType: 'image/png', sizeBytes }) as AttachmentEntity;
    const repo = makeRepo([row('b'), row('a'), row('broken'), row('huge', 10_000)]);
    send.mockImplementation((async (cmd: { input: { Key: string } }) => {
      if (cmd.input.Key === 'broken.png') throw Object.assign(new Error('gone'), { name: 'NoSuchKey' });
      return { Body: { transformToByteArray: async () => new Uint8Array(Buffer.from(cmd.input.Key)) } };
    }) as never);
    const images = await service(repo).loadImages(['a', 'missing', 'broken', 'huge', 'b'], 1000);
    expect(images).toEqual([
      { id: 'a', filename: 'a.png', mediaType: 'image/png', data: Buffer.from('a.png').toString('base64') },
      { id: 'b', filename: 'b.png', mediaType: 'image/png', data: Buffer.from('b.png').toString('base64') },
    ]);
  });
});
