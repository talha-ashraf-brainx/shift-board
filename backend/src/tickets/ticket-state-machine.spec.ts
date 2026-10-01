import {
  ALL_STATUSES,
  SocketEvents,
  TRANSITIONS,
  TicketEventType,
  TicketStatus,
  TransitionActor,
  isTransitionAllowed,
} from '@agent-board/shared';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { Test, type TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, type Repository } from 'typeorm';
import { resetTestDatabase, testDatabaseUrl, truncateAll } from '../../test/helpers/test-db';
import { CommonModule } from '../common/common.module';
import { WorkerSignal } from '../common/worker-signal.service';
import { buildDataSourceOptions } from '../database/db-options';
import { EventsModule } from '../events/events.module';
import { TicketEventEntity } from '../events/ticket-event.entity';
import { TicketStateMachine } from './ticket-state-machine';
import { TicketEntity } from './ticket.entity';

const ACTORS = Object.values(TransitionActor);

describe('TicketStateMachine (Postgres)', () => {
  let moduleRef: TestingModule;
  let sm: TicketStateMachine;
  let ds: DataSource;
  let tickets: Repository<TicketEntity>;
  let events: Repository<TicketEventEntity>;
  let emitter: EventEmitter2;
  let wake: jest.SpyInstance;

  beforeAll(async () => {
    await resetTestDatabase();
    moduleRef = await Test.createTestingModule({
      imports: [
        EventEmitterModule.forRoot(),
        CommonModule,
        TypeOrmModule.forRoot(buildDataSourceOptions(testDatabaseUrl())),
        TypeOrmModule.forFeature([TicketEntity]),
        EventsModule,
      ],
      providers: [TicketStateMachine],
    }).compile();
    sm = moduleRef.get(TicketStateMachine);
    ds = moduleRef.get(DataSource);
    tickets = ds.getRepository(TicketEntity);
    events = ds.getRepository(TicketEventEntity);
    emitter = moduleRef.get(EventEmitter2);
    wake = jest.spyOn(moduleRef.get(WorkerSignal), 'wake');
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(async () => {
    await truncateAll(ds);
    wake.mockClear();
  });

  async function makeTicket(status: TicketStatus, extra: Partial<TicketEntity> = {}): Promise<TicketEntity> {
    const t = tickets.create({
      title: `t ${status}`,
      description: 'd',
      position: 1,
      status,
      lockedAt: status === TicketStatus.InProgress ? new Date() : null,
      lastError: status === TicketStatus.Failed ? 'boom' : null,
      ...extra,
    });
    return tickets.save(t);
  }

  const allowed = TRANSITIONS.flatMap((r) => r.actors.map((actor) => ({ from: r.from, to: r.to, actor })));

  it.each(allowed)('allows $from -> $to by $actor with side effects', async ({ from, to, actor }) => {
    const t = await makeTicket(from);
    const updated: unknown[] = [];
    const onUpdated = (p: unknown) => updated.push(p);
    emitter.on(SocketEvents.TicketUpdated, onUpdated);
    const emittedEvents: unknown[] = [];
    const onEvent = (p: unknown) => emittedEvents.push(p);
    emitter.on(SocketEvents.TicketEvent, onEvent);
    try {
      const res = await sm.transition(t.id, to, {
        actor,
        note: 'a note',
        patch: { agentSummary: 'patched' },
      });
      expect(res.status).toBe(to);
      expect(res.agentSummary).toBe('patched');

      const fresh = await tickets.findOneByOrFail({ id: t.id });
      expect(fresh.status).toBe(to);
      if (to === TicketStatus.InProgress) {
        expect(fresh.lockedAt).toBeInstanceOf(Date);
        expect(fresh.attemptCount).toBe(1);
      } else {
        expect(fresh.attemptCount).toBe(0);
      }
      if (from === TicketStatus.InProgress) expect(fresh.lockedAt).toBeNull();
      if (from === TicketStatus.Failed && to === TicketStatus.Pending) expect(fresh.lastError).toBeNull();
      if (from === TicketStatus.Failed && to !== TicketStatus.Pending) expect(fresh.lastError).toBe('boom');

      const evs = await events.find({ where: { ticketId: t.id } });
      expect(evs).toHaveLength(1);
      expect(evs[0]!.type).toBe(TicketEventType.StatusChanged);
      expect(evs[0]!.body).toBe(`Status changed from ${from} to ${to}`);
      expect(evs[0]!.meta).toEqual({ from, to, actor, note: 'a note' });

      expect(updated).toHaveLength(1);
      expect(updated[0]).toMatchObject({ id: t.id, status: to });
      expect(emittedEvents).toHaveLength(1);
      expect(wake).toHaveBeenCalledTimes(to === TicketStatus.Pending ? 1 : 0);
    } finally {
      emitter.off(SocketEvents.TicketUpdated, onUpdated);
      emitter.off(SocketEvents.TicketEvent, onEvent);
    }
  });

  const forbidden = ALL_STATUSES.flatMap((from) =>
    ALL_STATUSES.flatMap((to) =>
      ACTORS.filter((actor) => !isTransitionAllowed(from, to, actor)).map((actor) => ({ from, to, actor })),
    ),
  );

  it('covers the full status x status x actor matrix', () => {
    expect(allowed.length + forbidden.length).toBe(ALL_STATUSES.length ** 2 * ACTORS.length);
  });

  it.each(forbidden)('rejects $from -> $to by $actor with 409', async ({ from, to, actor }) => {
    const t = await makeTicket(from);
    await expect(sm.transition(t.id, to, { actor })).rejects.toBeInstanceOf(ConflictException);
    const fresh = await tickets.findOneByOrFail({ id: t.id });
    expect(fresh.status).toBe(from);
    expect(await events.countBy({ ticketId: t.id })).toBe(0);
  });

  it('uses the reason as the event body and merges extra meta', async () => {
    const t = await makeTicket(TicketStatus.Failed);
    await sm.transition(t.id, TicketStatus.Pending, {
      actor: TransitionActor.Human,
      reason: 'Retry requested',
      meta: { previousError: 'boom' },
    });
    const [ev] = await events.find({ where: { ticketId: t.id } });
    expect(ev!.body).toBe('Retry requested');
    expect(ev!.meta).toEqual({ from: 'failed', to: 'pending', actor: 'human', previousError: 'boom' });
  });

  it('keeps priority and position when requeued', async () => {
    const t = await makeTicket(TicketStatus.Review, { position: 7 });
    const res = await sm.transition(t.id, TicketStatus.Pending, { actor: TransitionActor.Human });
    expect(res.position).toBe(7);
    expect(res.priority).toBe(t.priority);
  });

  it('throws 404 for an unknown ticket', async () => {
    await expect(
      sm.transition(randomUUID(), TicketStatus.Cancelled, { actor: TransitionActor.Human }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('serializes concurrent transitions on the same ticket (only one wins)', async () => {
    const t = await makeTicket(TicketStatus.Review);
    const results = await Promise.allSettled([
      sm.transition(t.id, TicketStatus.Done, { actor: TransitionActor.Human }),
      sm.transition(t.id, TicketStatus.Pending, { actor: TransitionActor.Human }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await events.countBy({ ticketId: t.id })).toBe(1);
  });
});
