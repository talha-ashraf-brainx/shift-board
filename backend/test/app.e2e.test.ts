import { SocketEvents, type TicketDto } from '@agent-board/shared';
import { Module, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AgentModule } from '../src/agent/agent.module';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/app-setup';
import { AppConfig } from '../src/config/app-config';
import { resetAppConfigCache } from '../src/config/env-validation';
import { createTempGitRepo, resetTestDatabase, testDatabaseUrl, truncateAll, type TempRepo } from './helpers/test-db';

/** The real worker is replaced so tests never start agent runs. */
@Module({})
class NoAgentModule {}

describe('API smoke (e2e)', () => {
  let app: INestApplication;
  let repo: TempRepo;
  let baseUrl: string;
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    await resetTestDatabase();
    repo = createTempGitRepo();
    Object.assign(process.env, {
      DATABASE_URL: testDatabaseUrl(),
      TARGET_REPO_PATH: repo.repoPath,
      BASE_BRANCH: 'main',
      WORKTREES_DIR: repo.worktreesDir,
    });
    resetAppConfigCache();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideModule(AgentModule)
      .useModule(NoAgentModule)
      .compile();
    app = moduleRef.createNestApplication({ logger: ['error'] });
    configureApp(app, app.get(AppConfig));
    await app.listen(0);
    const { port } = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app?.close();
    repo?.cleanup();
    process.env = savedEnv;
    resetAppConfigCache();
  });

  let projectId: string;
  beforeEach(async () => {
    await truncateAll(app.get(DataSource));
    const res = await http()
      .post('/api/projects')
      .send({ name: 'Sample', repoPath: repo.repoPath, baseBranch: 'main', extraAllowedTools: [' Bash(x:*) ', ''] })
      .expect(201);
    projectId = res.body.id;
  });

  const http = () => request(app.getHttpServer());

  it('create -> list -> get -> patch -> cancel', async () => {
    const created = await http()
      .post('/api/tickets')
      .send({ projectId, title: '  Fix the off-by-one  ', description: 'Loop skips the last item', priority: 'high' })
      .expect(201);
    const t = created.body as TicketDto;
    expect(t).toMatchObject({ projectId, title: 'Fix the off-by-one', status: 'pending', priority: 'high', position: 1 });
    expect(t.number).toBeGreaterThan(0);

    const list = await http().get('/api/tickets').expect(200);
    expect(list.body.map((x: TicketDto) => x.id)).toEqual([t.id]);
    expect((await http().get('/api/tickets?q=OFF-BY').expect(200)).body).toHaveLength(1);
    expect((await http().get('/api/tickets?status=review').expect(200)).body).toHaveLength(0);
    expect((await http().get(`/api/tickets?projectId=${randomUUID()}`).expect(200)).body).toHaveLength(0);

    const got = await http().get(`/api/tickets/${t.id}`).expect(200);
    expect(got.body.events.map((e: { type: string }) => e.type)).toEqual(['created']);

    const patched = await http().patch(`/api/tickets/${t.id}`).send({ title: 'Renamed', priority: 'urgent' }).expect(200);
    expect(patched.body).toMatchObject({ title: 'Renamed', priority: 'urgent' });

    const cancelled = await http().post(`/api/tickets/${t.id}/cancel`).expect(200);
    expect(cancelled.body.status).toBe('cancelled');

    const status = await http().get('/api/agent/status').expect(200);
    expect(status.body).toMatchObject({ state: 'idle', queueLength: 0, ticketId: null, blockedProjects: [] });

    const settings = await http().get('/api/settings').expect(200);
    expect(settings.body).toEqual({
      workerEnabled: true,
      globalRules: '',
      worktreesRoot: expect.any(String),
      notifyWebhookUrl: null,
    });
    await http().put('/api/settings').send({ globalRules: 'No new deps' }).expect(200);
  });

  it('projects: list, inspect, validation, delete', async () => {
    const list = (await http().get('/api/projects').expect(200)).body;
    expect(list).toEqual([
      expect.objectContaining({
        id: projectId,
        name: 'Sample',
        baseBranch: 'main',
        extraAllowedTools: ['Bash(x:*)'],
        repoStatus: { ready: true, reason: null, currentBranch: 'main' },
        ticketCounts: {},
      }),
    ]);
    const inspect = (await http().get(`/api/projects/inspect?path=${encodeURIComponent(repo.repoPath)}`).expect(200)).body;
    expect(inspect).toMatchObject({ isGitRepo: true, error: null, branches: ['main'], existingProjectId: projectId });
    expect((await http().get('/api/projects/inspect?path=relative').expect(200)).body.error).toBeTruthy();

    await http().post('/api/projects').send({ name: 'Other', repoPath: repo.repoPath, baseBranch: 'main' }).expect(409);
    await http().patch(`/api/projects/${projectId}`).send({ baseBranch: 'nope' }).expect(400);

    await http().post('/api/tickets').send({ projectId, title: 'x', description: 'y' }).expect(201);
    const untitled = await http().post('/api/tickets').send({ projectId, title: '  ', description: 'no title' }).expect(201);
    expect(untitled.body.title).toBe('');
    expect((await http().post('/api/tickets').send({ projectId, description: 'no title' }).expect(201)).body.title).toBe('');
    await http().delete(`/api/projects/${projectId}`).expect(409);
    await app.get(DataSource).query(`UPDATE tickets SET status = 'cancelled'`);
    expect((await http().delete(`/api/projects/${projectId}`).expect(200)).body).toEqual({ id: projectId });
    expect((await http().get('/api/tickets').expect(200)).body).toHaveLength(0);

    const browse = (await http().get('/api/fs/browse').expect(200)).body;
    expect(browse).toMatchObject({ path: expect.any(String), home: expect.any(String), entries: expect.any(Array) });
    await http().get('/api/fs/browse?path=/definitely/not/here').expect(400);
  });

  it('validation errors are 400 with a readable string message', async () => {
    const res = await http().post('/api/tickets').send({ title: 'x'.repeat(201), priority: 'whenever', extra: 1 }).expect(400);
    expect(res.body.statusCode).toBe(400);
    expect(typeof res.body.message).toBe('string');
    expect(res.body.message).toContain('property extra should not exist');
    expect(res.body.message).toContain('title must be at most 200 characters');
    expect(res.body.message).toContain('description is required');
    expect(res.body.message).toContain('priority must be one of');
    expect(res.body.message).toContain('projectId is required');
    await http().post('/api/tickets').send({ projectId: randomUUID(), title: 'x', description: 'y' }).expect(404);
    expect(res.body.message).toContain('; ');

    const reject = await http().post(`/api/tickets/${randomUUID()}/reject`).send({ feedback: '' }).expect(400);
    expect(reject.body.message).toBe('feedback is required');
    const answer = `/api/tickets/${randomUUID()}/answer`;
    expect((await http().post(answer).send({ message: ' ' }).expect(400)).body.message).toBe('message or answers is required');
    expect(
      (await http().post(answer).send({ answers: [{ question: 'Q?', selected: [], other: '' }] }).expect(400)).body.message,
    ).toBe('message or answers is required');
    await http().post(answer).send({ answers: [{ question: 'Q?', selected: 'Login' }] }).expect(400);
    await http().post(answer).send({ answers: [{ question: 'Q?', selected: [], other: 'x', extra: 1 }] }).expect(400);
    await http().post(answer).send({ answers: [{ question: 'Q?', selected: ['Login'] }] }).expect(404);
    await http().put('/api/settings').send({ workerEnabled: 'yes' }).expect(400);
    await http().put('/api/settings').send({ notifyWebhookUrl: 'ftp://example.com' }).expect(400);
    await http().put('/api/settings').send({ notifyWebhookUrl: null }).expect(200);
    expect((await http().post('/api/settings/notify-test').expect(200)).body).toEqual({
      ok: false,
      error: 'No webhook URL is configured',
    });
  });

  it('invalid transitions are 409', async () => {
    const t = (await http().post('/api/tickets').send({ projectId, title: 'x', description: 'y' }).expect(201))
      .body as TicketDto;
    const res = await http().post(`/api/tickets/${t.id}/approve`).expect(409);
    expect(res.body).toEqual({ statusCode: 409, message: expect.stringContaining('not review') });
    await http().post(`/api/tickets/${t.id}/answer`).send({ message: 'hi' }).expect(409);
    await http().get(`/api/tickets/${t.id}/diff`).expect(409);
    await http().post(`/api/tickets/${t.id}/cancel`).expect(200);
    await http().post(`/api/tickets/${t.id}/cancel`).expect(409);
  });

  it('unknown ids are 404, malformed ids 400', async () => {
    const res = await http().get(`/api/tickets/${randomUUID()}`).expect(404);
    expect(res.body).toEqual({ statusCode: 404, message: expect.stringContaining('not found') });
    await http().post(`/api/tickets/${randomUUID()}/cancel`).expect(404);
    await http().get('/api/tickets/not-a-uuid').expect(400);
  });

  it('socket clients receive ticket.created (and agent.status)', async () => {
    const socket: Socket = io(baseUrl, { transports: ['websocket'], forceNew: true });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('connect_error', reject);
      });
      const createdP = new Promise<TicketDto>((resolve) => socket.once(SocketEvents.TicketCreated, resolve));
      const statusP = new Promise<{ queueLength: number }>((resolve) =>
        socket.once(SocketEvents.AgentStatus, resolve),
      );
      const eventP = new Promise<{ ticketId: string }>((resolve) => socket.once(SocketEvents.TicketEvent, resolve));
      const res = await http().post('/api/tickets').send({ projectId, title: 'live', description: 'socket' }).expect(201);
      const created = await createdP;
      expect(created.id).toBe(res.body.id);
      expect((await eventP).ticketId).toBe(res.body.id);
      expect((await statusP).queueLength).toBe(1);
    } finally {
      socket.disconnect();
    }
  });
});
