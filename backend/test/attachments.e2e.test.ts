import { Module, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AgentModule } from '../src/agent/agent.module';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/app-setup';
import { AppConfig } from '../src/config/app-config';
import { resetAppConfigCache } from '../src/config/env-validation';
import { createTempGitRepo, resetTestDatabase, testDatabaseUrl, type TempRepo } from './helpers/test-db';

@Module({})
class NoAgentModule {}

// 1x1 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/** Runs against the S3 store in S3_* (MinIO from docker-compose). Without it, uploads must be a clean 503. */
describe('Attachments API (e2e)', () => {
  let app: INestApplication;
  let repo: TempRepo;
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    await resetTestDatabase();
    repo = createTempGitRepo();
    Object.assign(process.env, { DATABASE_URL: testDatabaseUrl(), WORKTREES_DIR: repo.worktreesDir });
    resetAppConfigCache();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideModule(AgentModule)
      .useModule(NoAgentModule)
      .compile();
    app = moduleRef.createNestApplication({ logger: ['error'] });
    configureApp(app, app.get(AppConfig));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    repo?.cleanup();
    process.env = savedEnv;
    resetAppConfigCache();
  });

  const http = () => request(app.getHttpServer());

  it('rejects non-images by content, missing files and unknown or malformed ids', async () => {
    const res = await http()
      .post('/api/attachments')
      .attach('file', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), {
        filename: 'evil.png',
        contentType: 'image/png',
      })
      .expect(415);
    expect(res.body).toEqual({ statusCode: 415, message: expect.stringContaining('PNG') });
    await http().post('/api/attachments').field('ticketId', randomUUID()).expect(400);
    await http().post('/api/attachments').field('ticketId', 'nope').attach('file', PNG, 'a.png').expect(400);
    await http().get(`/api/attachments/${randomUUID()}`).expect(404);
    await http().get('/api/attachments/not-a-uuid').expect(400);
  });

  it('rejects files over 10 MB', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]);
    await http().post('/api/attachments').attach('file', big, 'big.png').expect(413);
  });

  it('uploads and serves an image (or answers 503 when the store is down)', async () => {
    const up = await http().post('/api/attachments').attach('file', PNG, 'dot.png');
    if (up.status === 503) {
      expect(up.body.message).toContain('MinIO');
      return;
    }
    expect(up.status).toBe(201);
    expect(up.body).toEqual({
      id: expect.any(String),
      url: `/api/attachments/${up.body.id}`,
      filename: 'dot.png',
      contentType: 'image/png',
      sizeBytes: PNG.length,
    });
    const res = await http().get(up.body.url).buffer(true).expect(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(res.body as Buffer, PNG)).toBe(0);
  });
});
