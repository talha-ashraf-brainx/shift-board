import { SocketEvents, TicketStatus } from '@agent-board/shared';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { Test, type TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { createFakeGit, fakeGitFactory } from '../../test/helpers/fake-git';
import { insertTestProject, resetTestDatabase, testDatabaseUrl, truncateAll } from '../../test/helpers/test-db';
import { CommonModule } from '../common/common.module';
import { RunRegistry } from '../common/run-registry.service';
import { WorkerSignal } from '../common/worker-signal.service';
import { AppConfig } from '../config/app-config';
import { buildDataSourceOptions } from '../database/db-options';
import { GitServiceFactory } from '../git/git-service.factory';
import { ProjectsService } from '../projects/projects.service';
import { AgentStatusService } from '../status/agent-status.service';
import { StatusModule } from '../status/status.module';
import { TicketEntity } from '../tickets/ticket.entity';
import { SettingsModule } from './settings.module';
import { SettingsService } from './settings.service';

const config = { targetRepoPath: null, baseBranch: null, worktreesDir: '/wt' } as AppConfig;

describe('SettingsService + AgentStatusService (Postgres)', () => {
  let moduleRef: TestingModule;
  let settings: SettingsService;
  let status: AgentStatusService;
  let ds: DataSource;
  let emitter: EventEmitter2;
  let wake: jest.SpyInstance;
  const git = createFakeGit();

  async function build(): Promise<void> {
    await moduleRef?.close();
    moduleRef = await Test.createTestingModule({
      imports: [
        EventEmitterModule.forRoot(),
        CommonModule,
        TypeOrmModule.forRoot(buildDataSourceOptions(testDatabaseUrl())),
        { module: class ConfigStub {}, global: true, providers: [{ provide: AppConfig, useValue: config }], exports: [AppConfig] },
        SettingsModule,
        StatusModule,
      ],
    })
      .overrideProvider(GitServiceFactory)
      .useValue(fakeGitFactory(git))
      .compile();
    await moduleRef.init();
    settings = moduleRef.get(SettingsService);
    status = moduleRef.get(AgentStatusService);
    ds = moduleRef.get(DataSource);
    emitter = moduleRef.get(EventEmitter2);
    wake = jest.spyOn(moduleRef.get(WorkerSignal), 'wake');
  }

  beforeAll(async () => {
    await resetTestDatabase();
  });

  beforeEach(async () => {
    await build();
    await truncateAll(ds);
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('reads the seeded defaults and includes read-only repo info', async () => {
    expect(await settings.get()).toEqual({ globalRules: '', workerEnabled: true });
    expect(await settings.getDto()).toEqual({
      globalRules: '',
      workerEnabled: true,
      worktreesRoot: '/wt',
    });
  });

  it('update persists, wakes the worker and broadcasts agent.status', async () => {
    const statuses: unknown[] = [];
    emitter.on(SocketEvents.AgentStatus, (s) => statuses.push(s));
    const dto = await settings.update({ globalRules: 'Be terse', workerEnabled: false });
    expect(dto).toMatchObject({ globalRules: 'Be terse', workerEnabled: false });
    expect(wake).toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 120));
    expect(statuses.at(-1)).toMatchObject({ state: 'paused' });

    // Survives a restart (fresh cache).
    await build();
    expect(await settings.get()).toEqual({ globalRules: 'Be terse', workerEnabled: false });
  });

  it('status lists projects whose repo is not ready', async () => {
    const id = await insertTestProject(ds, { name: 'dirty' });
    git.repoStatus.mockResolvedValueOnce({ ready: false, reason: 'Repo has uncommitted changes: a.txt', currentBranch: 'main' });
    const r = await moduleRef.get(ProjectsService).refreshReadiness();
    expect(r.readyIds).toEqual([]);
    expect((await status.getStatus()).blockedProjects).toEqual([
      { projectId: id, name: 'dirty', reason: 'Repo has uncommitted changes: a.txt' },
    ]);
  });

  it('status: idle, running (from RunRegistry), queue length', async () => {
    const repo = ds.getRepository(TicketEntity);
    await repo.save([
      repo.create({ title: 'a', description: 'd', position: 1 }),
      repo.create({ title: 'b', description: 'd', position: 2 }),
      repo.create({ title: 'c', description: 'd', position: 3, status: TicketStatus.Review }),
    ]);
    expect(await status.getStatus()).toEqual({
      state: 'idle',
      ticketId: null,
      ticketNumber: null,
      queueLength: 2,
      blockedProjects: [],
      waiting: [],
    });
    const handle = moduleRef.get(RunRegistry).register('t-1', 7);
    await settings.update({ workerEnabled: false });
    expect(await status.getStatus()).toMatchObject({ state: 'running', ticketId: 't-1', ticketNumber: 7 });
    handle.finish();
    expect((await status.getStatus()).state).toBe('paused');
  });
});
