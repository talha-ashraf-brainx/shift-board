import {
  EventAuthor,
  SocketEvents,
  TicketEventType,
  TicketPriority,
  TicketStatus,
  TransitionActor,
} from '@agent-board/shared';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { Test, type TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, type Repository } from 'typeorm';
import { createFakeGit, fakeGitFactory } from '../../test/helpers/fake-git';
import { insertTestProject, resetTestDatabase, testDatabaseUrl, truncateAll } from '../../test/helpers/test-db';
import { CommonModule } from '../common/common.module';
import { RunRegistry } from '../common/run-registry.service';
import { WorkerSignal } from '../common/worker-signal.service';
import { buildDataSourceOptions } from '../database/db-options';
import { EventsService } from '../events/events.service';
import { GitServiceFactory } from '../git/git-service.factory';
import { MergeConflictError } from '../git/git.types';
import { TicketStateMachine } from './ticket-state-machine';
import { TicketEntity } from './ticket.entity';
import { TicketsModule } from './tickets.module';
import { TicketsService } from './tickets.service';

describe('TicketsService (Postgres)', () => {
  let moduleRef: TestingModule;
  let svc: TicketsService;
  let sm: TicketStateMachine;
  let ds: DataSource;
  let repo: Repository<TicketEntity>;
  let events: EventsService;
  let registry: RunRegistry;
  let emitter: EventEmitter2;
  const git = createFakeGit();
  let wake: jest.SpyInstance;

  beforeAll(async () => {
    await resetTestDatabase();
    moduleRef = await Test.createTestingModule({
      imports: [
        EventEmitterModule.forRoot(),
        CommonModule,
        TypeOrmModule.forRoot(buildDataSourceOptions(testDatabaseUrl())),
        TicketsModule,
      ],
    })
      .overrideProvider(GitServiceFactory)
      .useValue(fakeGitFactory(git))
      .compile();
    svc = moduleRef.get(TicketsService);
    sm = moduleRef.get(TicketStateMachine);
    ds = moduleRef.get(DataSource);
    repo = ds.getRepository(TicketEntity);
    events = moduleRef.get(EventsService);
    registry = moduleRef.get(RunRegistry);
    emitter = moduleRef.get(EventEmitter2);
    wake = jest.spyOn(moduleRef.get(WorkerSignal), 'wake');
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  let projectId: string;
  beforeEach(async () => {
    await truncateAll(ds);
    projectId = await insertTestProject(ds);
    jest.clearAllMocks();
  });

  const create = (title: string, priority?: TicketPriority) =>
    svc.create({ projectId, title, description: `desc of ${title}`, priority });
  const claimNext = () => svc.claimNext([projectId]);

  /** Puts a ticket straight into a status (bypassing the machine) for action tests. */
  async function force(id: string, status: TicketStatus, extra: Partial<TicketEntity> = {}) {
    await repo.update({ id }, { status, ...extra });
    return repo.findOneByOrFail({ id });
  }

  const typesOf = async (id: string) => (await events.listForTicket(id)).map((e) => e.type);

  describe('create / list / update', () => {
    it('assigns position = max within priority + 1, writes a created event, emits and wakes', async () => {
      const created: unknown[] = [];
      const on = (p: unknown) => created.push(p);
      emitter.on(SocketEvents.TicketCreated, on);
      const a = await create('a', TicketPriority.High);
      const b = await create('b', TicketPriority.High);
      const c = await create('c');
      emitter.off(SocketEvents.TicketCreated, on);

      expect([a.position, b.position, c.position]).toEqual([1, 2, 1]);
      expect(c.priority).toBe(TicketPriority.Medium);
      expect(c.status).toBe(TicketStatus.Pending);
      expect(b.number).toBe(a.number + 1);
      expect(await typesOf(a.id)).toEqual([TicketEventType.Created]);
      expect(created).toHaveLength(3);
      expect(wake).toHaveBeenCalledTimes(3);
      expect(svc.toDto(a).totalCostUsd).toBe(0);
    });

    it('lists in queue order with filters and title search', async () => {
      const low = await create('Fix login bug', TicketPriority.Low);
      const urgent = await create('Crash on save', TicketPriority.Urgent);
      const med = await create('Login page typo', TicketPriority.Medium);
      expect((await svc.list()).map((t) => t.id)).toEqual([urgent.id, med.id, low.id]);
      expect((await svc.list({ q: 'login' })).map((t) => t.id)).toEqual([med.id, low.id]);
      expect((await svc.list({ q: '%' })).length).toBe(0);
      expect((await svc.list({ priority: TicketPriority.Low })).map((t) => t.id)).toEqual([low.id]);
      await force(low.id, TicketStatus.Review);
      expect((await svc.list({ status: TicketStatus.Review })).map((t) => t.id)).toEqual([low.id]);
    });

    it('get returns the ticket with its events oldest first', async () => {
      const t = await create('x');
      await sm.transition(t.id, TicketStatus.Cancelled, { actor: TransitionActor.Human });
      const dto = await svc.get(t.id);
      expect(dto.events.map((e) => e.type)).toEqual([TicketEventType.Created, TicketEventType.StatusChanged]);
      await expect(svc.get(randomUUID())).rejects.toBeInstanceOf(NotFoundException);
    });

    it('update edits fields, keeps position on priority change, and is 409 while in_progress', async () => {
      const t = await create('x');
      const u = await svc.update(t.id, { title: 'y', priority: TicketPriority.Urgent, context: null });
      expect(u.title).toBe('y');
      expect(u.priority).toBe(TicketPriority.Urgent);
      expect(u.position).toBe(t.position);
      await force(t.id, TicketStatus.InProgress);
      await expect(svc.update(t.id, { title: 'z' })).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('claimNext', () => {
    it('claims urgent > high > medium > low, then position, then createdAt', async () => {
      const low = await create('low', TicketPriority.Low);
      const med = await create('med', TicketPriority.Medium);
      const urgent2 = await create('urgent2', TicketPriority.Urgent);
      const high = await create('high', TicketPriority.High);
      const urgent1 = await create('urgent1', TicketPriority.Urgent);
      await svc.update(urgent1.id, { position: 0 }); // earlier position beats earlier createdAt
      const med2 = await create('med2', TicketPriority.Medium);
      await svc.update(med2.id, { position: med.position }); // same position: createdAt decides

      const order: string[] = [];
      for (;;) {
        const c = await claimNext();
        if (!c) break;
        order.push(c.id);
        expect(c.status).toBe(TicketStatus.InProgress);
        expect(c.lockedAt).toBeInstanceOf(Date);
        expect(c.attemptCount).toBe(1);
      }
      expect(order).toEqual([urgent1.id, urgent2.id, high.id, med.id, med2.id, low.id]);

      const evs = await events.listForTicket(urgent1.id);
      const claim = evs.find((e) => e.type === TicketEventType.StatusChanged)!;
      expect(claim.meta).toEqual({ from: 'pending', to: 'in_progress', actor: 'worker' });
      expect(claim.author).toBe(EventAuthor.Agent);
    });

    it('skips non-pending and locked tickets', async () => {
      const a = await create('a');
      const b = await create('b');
      await force(a.id, TicketStatus.Review);
      await repo.update({ id: b.id }, { lockedAt: new Date() });
      expect(await claimNext()).toBeNull();
    });

    it('two (or more) concurrent claims never return the same ticket', async () => {
      for (let i = 0; i < 8; i++) await create(`t${i}`);
      const results = await Promise.all(Array.from({ length: 12 }, () => claimNext()));
      const ids = results.filter((r): r is TicketEntity => r !== null).map((r) => r.id);
      expect(ids).toHaveLength(8);
      expect(new Set(ids).size).toBe(8);
      expect(await repo.countBy({ status: TicketStatus.InProgress })).toBe(8);
      const claimEvents = await ds.query(
        `SELECT count(*)::int AS n FROM ticket_events WHERE type = 'status_changed'`,
      );
      expect(claimEvents[0].n).toBe(8);
    });
  });

  describe('worker helpers', () => {
    it('patchInternal saves allowed fields only and emits ticket.updated', async () => {
      const t = await create('x');
      const updated: unknown[] = [];
      const on = (p: unknown) => updated.push(p);
      emitter.on(SocketEvents.TicketUpdated, on);
      const p = await svc.patchInternal(t.id, {
        sessionId: 's-1',
        branchName: 'agent/ticket-1',
        status: TicketStatus.Done,
      } as never);
      emitter.off(SocketEvents.TicketUpdated, on);
      expect(p.sessionId).toBe('s-1');
      expect(p.branchName).toBe('agent/ticket-1');
      expect(p.status).toBe(TicketStatus.Pending);
      expect(updated).toHaveLength(1);
    });

    it('addCost increments atomically', async () => {
      const t = await create('x');
      await Promise.all([svc.addCost(t.id, 0.0123), svc.addCost(t.id, 0.5)]);
      expect((await svc.findById(t.id)).totalCostUsd).toBeCloseTo(0.5123, 4);
    });

    it('countPending and recoverInterrupted', async () => {
      const a = await create('a');
      const b = await create('b');
      await claimNext();
      expect(await svc.countPending()).toBe(1);
      expect(await svc.recoverInterrupted()).toBe(1);
      const ra = await svc.findById(a.id);
      expect(ra.status).toBe(TicketStatus.Pending);
      expect(ra.lockedAt).toBeNull();
      const last = (await events.listForTicket(a.id)).at(-1)!;
      expect(last.author).toBe(EventAuthor.System);
      expect(last.meta).toMatchObject({ from: 'in_progress', to: 'pending', actor: 'system' });
      expect(await svc.countPending()).toBe(2);
      expect(b.id).toBeDefined();
    });
  });

  describe('human actions', () => {
    it('answer: human_answer then needs_context -> pending', async () => {
      const t = await create('x');
      await force(t.id, TicketStatus.NeedsContext);
      const r = await svc.answer(t.id, 'Use the v2 API');
      expect(r.status).toBe(TicketStatus.Pending);
      const evs = await events.listForTicket(t.id);
      const ans = evs.find((e) => e.type === TicketEventType.HumanAnswer)!;
      expect(ans.author).toBe(EventAuthor.Human);
      expect(ans.body).toBe('Use the v2 API');
      expect(evs.at(-1)!.meta).toMatchObject({ from: 'needs_context', to: 'pending', actor: 'human' });
      await expect(svc.answer(t.id, 'again')).rejects.toBeInstanceOf(ConflictException);
    });

    it('reject: requires feedback, appends review_rejected, review -> pending', async () => {
      const t = await create('x');
      await force(t.id, TicketStatus.Review);
      await expect(svc.reject(t.id, '   ')).rejects.toBeInstanceOf(BadRequestException);
      const r = await svc.reject(t.id, 'Also handle null');
      expect(r.status).toBe(TicketStatus.Pending);
      const evs = await events.listForTicket(t.id);
      expect(evs.map((e) => e.type)).toEqual([
        TicketEventType.Created,
        TicketEventType.ReviewRejected,
        TicketEventType.StatusChanged,
      ]);
      expect(evs[1]!.body).toBe('Also handle null');
    });

    it('retry: records previousError + note, appends retry_note, clears lastError', async () => {
      const t = await create('x');
      await force(t.id, TicketStatus.Failed, { lastError: 'tests failed' });
      const r = await svc.retry(t.id, 'try smaller change');
      expect(r.status).toBe(TicketStatus.Pending);
      expect(r.lastError).toBeNull();
      const evs = await events.listForTicket(t.id);
      const note = evs.find((e) => e.type === TicketEventType.HumanAnswer)!;
      expect(note.meta).toEqual({ kind: 'retry_note' });
      expect(note.body).toBe('try smaller change');
      expect(evs.at(-1)!.meta).toEqual({
        from: 'failed',
        to: 'pending',
        actor: 'human',
        note: 'try smaller change',
        previousError: 'tests failed',
      });
    });

    it('retry without a note writes no human_answer', async () => {
      const t = await create('x');
      await force(t.id, TicketStatus.Failed, { lastError: 'boom' });
      await svc.retry(t.id);
      expect(await typesOf(t.id)).toEqual([TicketEventType.Created, TicketEventType.StatusChanged]);
      expect((await events.listForTicket(t.id)).at(-1)!.meta).toMatchObject({ previousError: 'boom' });
    });

    it('cancel: aborts the running agent first, then cancels and removes the worktree', async () => {
      const t = await create('x');
      await claimNext();
      await svc.patchInternal(t.id, { branchName: 'agent/ticket-1', worktreePath: '/tmp/wt/ticket-1' });
      const handle = registry.register(t.id, t.number);
      const order: string[] = [];
      handle.signal.addEventListener('abort', () => {
        order.push('aborted');
        setTimeout(() => handle.finish(), 20);
      });
      git.removeWorktree.mockImplementation(async () => {
        order.push('removed');
      });
      const r = await svc.cancel(t.id);
      expect(order).toEqual(['aborted', 'removed']);
      expect(handle.isCancelRequested()).toBe(true);
      expect(r.status).toBe(TicketStatus.Cancelled);
      expect(r.worktreePath).toBeNull();
      expect(r.lockedAt).toBeNull();
      expect(git.removeWorktree).toHaveBeenCalledWith(expect.objectContaining({ number: t.number }), {
        deleteBranch: true,
      });
      await expect(svc.cancel(t.id)).rejects.toBeInstanceOf(ConflictException);
    });

    it('cancel: a ticket without a worktree does not touch git; done is 409', async () => {
      const t = await create('x');
      expect((await svc.cancel(t.id)).status).toBe(TicketStatus.Cancelled);
      expect(git.removeWorktree).not.toHaveBeenCalled();
      const d = await create('d');
      await force(d.id, TicketStatus.Done);
      await expect(svc.cancel(d.id)).rejects.toBeInstanceOf(ConflictException);
    });

    it('approve: diff snapshot, merge, remove worktree, review_approved, done', async () => {
      const t = await create('x');
      await force(t.id, TicketStatus.Review, { branchName: 'agent/ticket-1', worktreePath: '/tmp/wt/ticket-1' });
      const r = await svc.approve(t.id);
      expect(r.status).toBe(TicketStatus.Done);
      expect(r.worktreePath).toBeNull();
      expect(git.diff).toHaveBeenCalled();
      expect(git.merge).toHaveBeenCalled();
      expect(git.removeWorktree).toHaveBeenCalledWith(expect.anything(), { deleteBranch: true });
      const approved = (await events.listForTicket(t.id)).find((e) => e.type === TicketEventType.ReviewApproved)!;
      expect(approved.meta).toMatchObject({ diff: { branchName: `agent/ticket-${t.number}` } });
      // done: diff comes from the snapshot, not git
      git.diff.mockClear();
      const d = await svc.diff(t.id);
      expect(d.files[0]!.path).toBe('src/a.ts');
      expect(git.diff).not.toHaveBeenCalled();
    });

    it('approve: merge conflict -> 409, error event, stays in review, worktree kept', async () => {
      const t = await create('x');
      await force(t.id, TicketStatus.Review, { worktreePath: '/tmp/wt/ticket-1' });
      git.merge.mockRejectedValueOnce(new MergeConflictError('agent/ticket-1', ['src/a.ts']));
      await expect(svc.approve(t.id)).rejects.toThrow(/conflicts in src\/a\.ts/);
      const fresh = await svc.findById(t.id);
      expect(fresh.status).toBe(TicketStatus.Review);
      expect(fresh.worktreePath).toBe('/tmp/wt/ticket-1');
      expect(git.removeWorktree).not.toHaveBeenCalled();
      const err = (await events.listForTicket(t.id)).find((e) => e.type === TicketEventType.Error)!;
      expect(err.meta).toEqual({ code: 'merge_conflict', files: ['src/a.ts'] });
    });

    it('approve outside review is 409', async () => {
      const t = await create('x');
      await expect(svc.approve(t.id)).rejects.toBeInstanceOf(ConflictException);
    });

    it('diff: live in review, 409 otherwise', async () => {
      const t = await create('x');
      await expect(svc.diff(t.id)).rejects.toBeInstanceOf(ConflictException);
      await force(t.id, TicketStatus.Review);
      await svc.diff(t.id);
      expect(git.diff).toHaveBeenCalledTimes(1);
    });

    it('startFresh: clears sessionId, optionally resets the worktree, 409 while in_progress', async () => {
      const t = await create('x');
      await force(t.id, TicketStatus.Failed, { sessionId: 'sess', worktreePath: '/tmp/wt/ticket-1' });
      const r = await svc.startFresh(t.id, true);
      expect(r.sessionId).toBeNull();
      expect(r.status).toBe(TicketStatus.Failed);
      expect(git.resetWorktreeToBase).toHaveBeenCalledTimes(1);
      await svc.startFresh(t.id);
      expect(git.resetWorktreeToBase).toHaveBeenCalledTimes(1);
      await force(t.id, TicketStatus.InProgress);
      await expect(svc.startFresh(t.id)).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
