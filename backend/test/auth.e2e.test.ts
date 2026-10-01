import { Module, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { io } from 'socket.io-client';
import request from 'supertest';
import { AgentModule } from '../src/agent/agent.module';
import { AppModule } from '../src/app.module';
import { LOGIN_MAX_FAILURES } from '../src/auth/auth.service';
import { configureApp } from '../src/common/app-setup';
import { AppConfig } from '../src/config/app-config';
import { resetAppConfigCache } from '../src/config/env-validation';
import { createTempGitRepo, resetTestDatabase, testDatabaseUrl, type TempRepo } from './helpers/test-db';

@Module({})
class NoAgentModule {}

const TOKEN = 'e2e-board-token-0123456789';

/** Boots the full app (agent worker stubbed out) with the given BOARD_TOKEN and listens on a random port. */
function useApp(boardToken: string | undefined) {
  const ctx = {} as { app: INestApplication; baseUrl: string };
  let repo: TempRepo;
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    await resetTestDatabase();
    repo = createTempGitRepo();
    Object.assign(process.env, { DATABASE_URL: testDatabaseUrl(), WORKTREES_DIR: repo.worktreesDir });
    delete process.env.TARGET_REPO_PATH;
    if (boardToken) process.env.BOARD_TOKEN = boardToken;
    else delete process.env.BOARD_TOKEN;
    resetAppConfigCache();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideModule(AgentModule)
      .useModule(NoAgentModule)
      .compile();
    ctx.app = moduleRef.createNestApplication({ logger: ['error'] });
    configureApp(ctx.app, ctx.app.get(AppConfig));
    await ctx.app.listen(0, '127.0.0.1');
    const { port } = ctx.app.getHttpServer().address() as AddressInfo;
    ctx.baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await ctx.app?.close();
    repo?.cleanup();
    process.env = savedEnv;
    resetAppConfigCache();
  });

  return ctx;
}

/** Resolves 'connected' or the connect_error message. */
function trySocket(baseUrl: string, opts: { cookie?: string; token?: string } = {}): Promise<string> {
  return new Promise((resolve) => {
    const socket = io(baseUrl, {
      path: '/socket.io',
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
      extraHeaders: opts.cookie ? { cookie: opts.cookie } : undefined,
      auth: opts.token ? { token: opts.token } : undefined,
    });
    const done = (r: string) => {
      socket.disconnect();
      resolve(r);
    };
    socket.on('connect', () => done('connected'));
    socket.on('connect_error', (e) => done(e.message));
  });
}

describe('Auth (e2e): BOARD_TOKEN unset', () => {
  const ctx = useApp(undefined);
  const http = () => request(ctx.app.getHttpServer());

  it('leaves the API and socket open', async () => {
    expect((await http().get('/api/auth/status').expect(200)).body).toEqual({ required: false, authenticated: true });
    await http().get('/api/settings').expect(200);
    const login = await http().post('/api/auth/login').send({ token: 'whatever' }).expect(200);
    expect(login.body).toEqual({ ok: true });
    expect(login.headers['set-cookie']).toBeUndefined();
    expect(await trySocket(ctx.baseUrl)).toBe('connected');
  });
});

describe('Auth (e2e): BOARD_TOKEN set', () => {
  const ctx = useApp(TOKEN);
  const http = () => request(ctx.app.getHttpServer());
  const cookie = `shiftboard_token=${encodeURIComponent(TOKEN)}`;

  it('rejects requests without the token with a 401 ApiError', async () => {
    const res = await http().get('/api/settings').expect(401);
    expect(res.body).toEqual({ statusCode: 401, message: expect.any(String) });
    await http().get('/api/tickets').set('Authorization', 'Bearer wrong-token-wrong-token').expect(401);
    await http().get('/api/settings').set('Cookie', 'shiftboard_token=nope').expect(401);
    await http().get('/API/settings').expect(401);
    await http().post('/api/tickets').send({}).expect(401);
  });

  it('accepts the token as a Bearer header or as the cookie (so <img> attachment GETs work)', async () => {
    await http().get('/api/settings').set('Authorization', `Bearer ${TOKEN}`).expect(200);
    await http().get('/api/settings').set('Cookie', cookie).expect(200);
    // Past the auth check: an unknown attachment is a 404, not a 401.
    await http().get(`/api/attachments/${randomUUID()}`).set('Cookie', cookie).expect(404);
    await http().get(`/api/attachments/${randomUUID()}`).expect(401);
  });

  it('reports status without requiring the token', async () => {
    expect((await http().get('/api/auth/status').expect(200)).body).toEqual({ required: true, authenticated: false });
    expect((await http().get('/api/auth/status').set('Cookie', cookie).expect(200)).body).toEqual({
      required: true,
      authenticated: true,
    });
  });

  it('login sets an HttpOnly SameSite=Strict cookie that then authenticates; logout clears it', async () => {
    const res = await http().post('/api/auth/login').send({ token: TOKEN }).expect(200);
    expect(res.body).toEqual({ ok: true });
    const setCookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    expect(setCookie).toHaveLength(1);
    const c = setCookie[0]!;
    expect(c).toMatch(/^shiftboard_token=[^;]+;/);
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/SameSite=Strict/i);
    expect(c).toMatch(/Path=\//);
    expect(c).toMatch(/Max-Age=31536000/);
    expect(c).not.toMatch(/Secure/i);
    await http().get('/api/settings').set('Cookie', c.split(';')[0]!).expect(200);

    const out = await http().post('/api/auth/logout').expect(200);
    expect(([] as string[]).concat(out.headers['set-cookie'] ?? [])[0]).toMatch(/^shiftboard_token=;.*Expires=Thu, 01 Jan 1970/);
  });

  it('rejects a wrong or missing token at login', async () => {
    const res = await http().post('/api/auth/login').send({ token: 'not-the-token' }).expect(401);
    expect(res.body).toEqual({ statusCode: 401, message: 'Wrong board token' });
    expect(res.headers['set-cookie']).toBeUndefined();
    await http().post('/api/auth/login').send({}).expect(400);
  });

  it('rejects socket connections without the token and accepts the cookie or auth.token', async () => {
    expect(await trySocket(ctx.baseUrl)).toBe('Unauthorized');
    expect(await trySocket(ctx.baseUrl, { cookie: 'shiftboard_token=nope' })).toBe('Unauthorized');
    expect(await trySocket(ctx.baseUrl, { cookie })).toBe('connected');
    expect(await trySocket(ctx.baseUrl, { token: TOKEN })).toBe('connected');
  });

  // Last: it uses up this client's sign-in budget.
  it('rate-limits repeated failed sign-ins', async () => {
    // One failure was already recorded by the wrong-token test above.
    for (let i = 1; i < LOGIN_MAX_FAILURES; i++) await http().post('/api/auth/login').send({ token: 'guess' }).expect(401);
    const res = await http().post('/api/auth/login').send({ token: TOKEN }).expect(429);
    expect(res.headers['retry-after']).toBeDefined();
    // Requests that already carry the token are unaffected.
    await http().get('/api/settings').set('Authorization', `Bearer ${TOKEN}`).expect(200);
  });
});
