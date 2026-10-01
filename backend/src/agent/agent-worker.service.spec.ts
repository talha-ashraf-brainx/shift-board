import { Logger } from '@nestjs/common';
import { EventAuthor, TicketEventType, TicketStatus, TransitionActor } from '@agent-board/shared';
import { RunRegistry } from '../common/run-registry.service';
import { WorkerSignal } from '../common/worker-signal.service';
import type { AppConfig } from '../config/app-config';
import type { TicketEntity } from '../tickets/ticket.entity';
import type { AgentRunner, AgentRunOutcome, AgentRunParams } from './agent-runner';
import { AgentWorkerService, NO_CHANGES_ERROR, NO_FINISH_ERROR } from './agent-worker.service';
import { FINISH_REMINDER } from './prompt-builder';

Logger.overrideLogger(false);

type RunScript = (p: AgentRunParams) => Promise<AgentRunOutcome> | AgentRunOutcome;

function makeTicket(overrides: Partial<TicketEntity> = {}): TicketEntity {
  return {
    id: 't1',
    number: 5,
    projectId: 'p1',
    title: 'Fix the total',
    description: 'Total is off by one',
    rules: [],
    priority: 'medium',
    status: TicketStatus.InProgress,
    sessionId: null,
    branchName: null,
    worktreePath: null,
    worktreeId: 'w1',
    agentSummary: null,
    attemptCount: 1,
    lastError: null,
    totalCostUsd: 0,
    lockedAt: new Date(),
    position: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as TicketEntity;
}

function setup(
  scripts: RunScript[],
  gitState: { uncommitted?: boolean; commits?: boolean } = {},
  ticketOverrides: Partial<TicketEntity> = {},
) {
  let ticket = makeTicket(ticketOverrides);
  const tickets = {
    patchInternal: jest.fn(async (_id: string, patch: Partial<TicketEntity>) => {
      ticket = { ...ticket, ...patch } as TicketEntity;
      return ticket;
    }),
    findById: jest.fn(async () => ticket),
    addCost: jest.fn(async () => undefined),
    claimNext: jest.fn(async () => null),
    recoverInterrupted: jest.fn(async () => 0),
  };
  const stateMachine = {
    transition: jest.fn(async (_id: string, to: TicketStatus) => {
      ticket = { ...ticket, status: to } as TicketEntity;
      return ticket;
    }),
  };
  const events = { append: jest.fn(async () => ({})), listForTicket: jest.fn(async () => []) };
  const settings = {
    get: jest.fn(async () => ({ globalRules: 'Be careful', workerEnabled: true })),
  };
  const project = {
    id: 'p1',
    name: 'shop',
    slug: 'shop',
    repoPath: '/repos/shop',
    baseBranch: 'main',
    rules: 'Use pnpm',
    extraAllowedTools: ['Bash(pnpm test:*)'],
  };
  const projects = {
    findById: jest.fn(async () => project),
    refreshReadiness: jest.fn(async () => ({ readyIds: ['p1'], blocked: [] as unknown[] })),
  };
  let committed = false;
  const git = {
    createWorktree: jest.fn(async () => ({ branchName: 'agent/ticket-5', worktreePath: '/wt/legacy/ticket-5' })),
    ensureSharedWorktree: jest.fn(async () => undefined),
    checkoutTicketBranch: jest.fn(async (path: string) => ({ branchName: 'agent/ticket-5', worktreePath: path })),
    hasUncommittedChanges: jest.fn(async () => !!gitState.uncommitted && !committed),
    commitAll: jest.fn(async () => {
      committed = true;
    }),
    hasNewCommits: jest.fn(async () => !!gitState.commits || committed),
    checkBaseRepoClean: jest.fn(async () => ({ clean: true })),
  };
  const status = { broadcast: jest.fn(async () => undefined) };
  const registry = new RunRegistry();
  const signal = new WorkerSignal();
  const calls: AgentRunParams[] = [];
  const runner = {
    run: jest.fn(async (p: AgentRunParams) => {
      calls.push(p);
      const script = scripts[calls.length - 1];
      if (!script) throw new Error('unexpected extra run');
      return script(p);
    }),
  };
  const config = { pollIntervalMs: 10 } as AppConfig;
  const gitFactory = { forProject: jest.fn(() => git) };
  const worktrees = { findById: jest.fn(async () => ({ id: 'w1', path: '/wt/ticket-5' })) };
  const worker = new AgentWorkerService(
    config,
    tickets as never,
    stateMachine as never,
    events as never,
    settings as never,
    gitFactory as never,
    projects as never,
    status as never,
    registry,
    signal,
    runner as unknown as AgentRunner,
    worktrees as never,
  );
  return { worker, worktrees, tickets, stateMachine, events, settings, git, projects, status, registry, runner, calls, getTicket: () => ticket };
}

/** Makes the next registered run report "cancel requested" (as RunRegistry.abort() does), without its 30s timer. */
function cancelledHandle(registry: RunRegistry) {
  const original = registry.register.bind(registry);
  jest.spyOn(registry, 'register').mockImplementationOnce((id, n) => {
    const h = original(id, n);
    return { ...h, signal: h.signal, controller: h.controller, finish: h.finish, isCancelRequested: () => true };
  });
}

/** A run that starts a session, then lets `act` use the run state. */
const run =
  (act: (p: AgentRunParams) => void | Promise<void>, out: Partial<AgentRunOutcome> = {}): RunScript =>
  async (p) => {
    await p.onSessionId('sess-1');
    await act(p);
    await p.onResult({ costUsd: 0.25, subtype: 'success', isError: false });
    return { sessionId: 'sess-1', resultSubtype: 'success', aborted: false, ...out };
  };

const submit = (p: AgentRunParams) => {
  Object.assign(p.runState, { outcome: 'review', summary: 'Fixed it', testing: 'tests pass', finishCalls: 1 });
};
const nothing = () => undefined;

describe('AgentWorkerService.processTicket outcome resolution', () => {
  it('submit_fix with commits → review with agentSummary', async () => {
    const s = setup([run(submit)], { commits: true });
    await s.worker.processTicket(s.getTicket());

    expect(s.git.commitAll).not.toHaveBeenCalled();
    expect(s.stateMachine.transition).toHaveBeenCalledTimes(1);
    expect(s.stateMachine.transition).toHaveBeenCalledWith('t1', TicketStatus.Review, {
      actor: TransitionActor.Worker,
      reason: 'Agent submitted a fix for review',
      patch: { agentSummary: '## Summary\nFixed it\n\n## Testing\ntests pass' },
    });
    // worktree + session saved, cost added, first-run prompt used
    expect(s.tickets.patchInternal).toHaveBeenCalledWith('t1', { branchName: 'agent/ticket-5', worktreePath: '/wt/ticket-5' });
    expect(s.tickets.patchInternal).toHaveBeenCalledWith('t1', { sessionId: 'sess-1' });
    expect(s.tickets.addCost).toHaveBeenCalledWith('t1', 0.25);
    expect(s.calls[0]!.prompt).toMatch(/^Ticket #5 \[medium\]: Fix the total/);
    expect(s.calls[0]!.systemAppend).toContain('branch agent/ticket-5, created from main');
    expect(s.calls[0]!.systemAppend).toContain('Project: shop (/repos/shop)');
    expect(s.calls[0]!.systemAppend).toMatch(/Be careful\n\nProject rules for shop:\nUse pnpm$/);
    expect(s.calls[0]!.extraAllowedTools).toEqual(['Bash(pnpm test:*)']);
    expect(s.calls[0]!.ticket).toMatchObject({ worktreePath: '/wt/ticket-5', sessionId: null });
    // registry released, status broadcast on start and end
    expect(s.registry.size()).toBe(0);
    expect(s.status.broadcast).toHaveBeenCalledTimes(2);
  });

  it('runs in the assigned shared worktree on the ticket branch', async () => {
    const s = setup([run(submit)], { commits: true });
    await s.worker.processTicket(s.getTicket());
    expect(s.worktrees.findById).toHaveBeenCalledWith('w1');
    expect(s.git.ensureSharedWorktree).toHaveBeenCalledWith('/wt/ticket-5');
    expect(s.git.checkoutTicketBranch).toHaveBeenCalledWith('/wt/ticket-5', expect.objectContaining({ number: 5 }));
    expect(s.git.createWorktree).not.toHaveBeenCalled();
  });

  it('a legacy ticket keeps its own per-ticket worktree', async () => {
    const s = setup([run(submit)], { commits: true }, { worktreeId: null, worktreePath: '/wt/legacy/ticket-5' });
    await s.worker.processTicket(s.getTicket());
    expect(s.git.createWorktree).toHaveBeenCalled();
    expect(s.git.checkoutTicketBranch).not.toHaveBeenCalled();
    expect(s.calls[0]!.ticket).toMatchObject({ worktreePath: '/wt/legacy/ticket-5' });
  });

  it('a ticket with no worktree (project has no active one) fails with a clear error', async () => {
    const s = setup([], {}, { worktreeId: null });
    await s.worker.processTicket(s.getTicket());
    expect(s.stateMachine.transition).toHaveBeenCalledWith(
      't1',
      TicketStatus.Failed,
      expect.objectContaining({ reason: expect.stringContaining('no active worktree') }),
    );
  });

  it('submit_fix with uncommitted changes → commitAll then review', async () => {
    const s = setup([run(submit)], { uncommitted: true });
    await s.worker.processTicket(s.getTicket());
    expect(s.git.commitAll).toHaveBeenCalledWith('/wt/ticket-5', 'ticket #5: Fix the total');
    expect(s.stateMachine.transition).toHaveBeenCalledWith('t1', TicketStatus.Review, expect.anything());
  });

  it('submit_fix without changes → failed', async () => {
    const s = setup([run(submit)]);
    await s.worker.processTicket(s.getTicket());
    expect(s.stateMachine.transition).toHaveBeenCalledWith('t1', TicketStatus.Failed, {
      actor: TransitionActor.Worker,
      reason: NO_CHANGES_ERROR,
      patch: { lastError: NO_CHANGES_ERROR },
    });
  });

  it('request_context → needs_context', async () => {
    const s = setup([run((p) => void Object.assign(p.runState, { outcome: 'needs_context', questions: ['Q?'] }))]);
    await s.worker.processTicket(s.getTicket());
    expect(s.stateMachine.transition).toHaveBeenCalledWith('t1', TicketStatus.NeedsContext, {
      actor: TransitionActor.Worker,
      reason: 'Agent needs more context',
    });
  });

  it('give_up → failed with the reason as lastError', async () => {
    const s = setup([run((p) => void Object.assign(p.runState, { outcome: 'failed', reason: 'Cannot reproduce' }))]);
    await s.worker.processTicket(s.getTicket());
    expect(s.stateMachine.transition).toHaveBeenCalledWith('t1', TicketStatus.Failed, {
      actor: TransitionActor.Worker,
      reason: 'Cannot reproduce',
      patch: { lastError: 'Cannot reproduce' },
    });
  });

  it('no finishing call → one reminder run on the same session → failed if still none', async () => {
    const s = setup([run(nothing), run(nothing)]);
    await s.worker.processTicket(s.getTicket());
    expect(s.runner.run).toHaveBeenCalledTimes(2);
    expect(s.calls[1]!.prompt).toBe(FINISH_REMINDER);
    expect(s.calls[1]!.ticket.sessionId).toBe('sess-1');
    expect(s.calls[1]!.runState).toBe(s.calls[0]!.runState);
    expect(s.stateMachine.transition).toHaveBeenCalledWith('t1', TicketStatus.Failed, {
      actor: TransitionActor.Worker,
      reason: NO_FINISH_ERROR,
      patch: { lastError: NO_FINISH_ERROR },
    });
  });

  it('reminder run that then calls submit_fix → review', async () => {
    const s = setup([run(nothing), run(submit)], { commits: true });
    await s.worker.processTicket(s.getTicket());
    expect(s.runner.run).toHaveBeenCalledTimes(2);
    expect(s.stateMachine.transition).toHaveBeenCalledWith('t1', TicketStatus.Review, expect.anything());
  });

  it('result subtype error_max_turns with no finish → failed with that reason, no reminder', async () => {
    const reason = 'The agent reached the maximum number of turns (60) without finishing.';
    const s = setup([run(nothing, { resultSubtype: 'error_max_turns', resultError: reason })]);
    await s.worker.processTicket(s.getTicket());
    expect(s.runner.run).toHaveBeenCalledTimes(1);
    expect(s.stateMachine.transition).toHaveBeenCalledWith('t1', TicketStatus.Failed, {
      actor: TransitionActor.Worker,
      reason,
      patch: { lastError: reason },
    });
  });

  it('a finishing call wins over a result error subtype', async () => {
    const s = setup([run(submit, { resultSubtype: 'error_max_turns', resultError: 'max turns' })], { commits: true });
    await s.worker.processTicket(s.getTicket());
    expect(s.stateMachine.transition).toHaveBeenCalledWith('t1', TicketStatus.Review, expect.anything());
  });

  it('the runner throws → error event + failed', async () => {
    const s = setup([
      () => {
        throw new Error('spawn claude ENOENT');
      },
    ]);
    await s.worker.processTicket(s.getTicket());
    expect(s.events.append).toHaveBeenCalledWith({
      ticketId: 't1',
      type: TicketEventType.Error,
      author: EventAuthor.System,
      body: 'spawn claude ENOENT',
    });
    expect(s.stateMachine.transition).toHaveBeenCalledWith('t1', TicketStatus.Failed, {
      actor: TransitionActor.Worker,
      reason: 'spawn claude ENOENT',
      patch: { lastError: 'spawn claude ENOENT' },
    });
    expect(s.registry.size()).toBe(0);
  });

  it('a failing failed-transition (e.g. cancelled meanwhile) is swallowed', async () => {
    const s = setup([
      () => {
        throw new Error('boom');
      },
    ]);
    s.stateMachine.transition.mockRejectedValueOnce(new Error('409 conflict'));
    await expect(s.worker.processTicket(s.getTicket())).resolves.toBeUndefined();
  });

  it('aborted with cancel requested → no transition', async () => {
    const s = setup([
      async (p) => {
        p.handle.controller.abort();
        expect(p.handle.isCancelRequested()).toBe(true);
        return { aborted: true, sessionId: 'sess-1' };
      },
    ]);
    cancelledHandle(s.registry);
    await s.worker.processTicket(s.getTicket());
    expect(s.stateMachine.transition).not.toHaveBeenCalled();
    expect(s.events.append).not.toHaveBeenCalledWith(expect.objectContaining({ type: TicketEventType.Error }));
    expect(s.registry.size()).toBe(0);
  });

  it('aborted by shutdown → no transition (crash recovery requeues)', async () => {
    const s = setup([
      async (p) => {
        p.handle.controller.abort();
        expect(p.handle.isCancelRequested()).toBe(false);
        return { aborted: true };
      },
    ]);
    await s.worker.processTicket(s.getTicket());
    expect(s.stateMachine.transition).not.toHaveBeenCalled();
  });

  it('keeps an existing session id and resumes with the resume prompt', async () => {
    const s = setup([run(submit)], { commits: true });
    const t = makeTicket({ sessionId: 'sess-old', branchName: 'agent/ticket-5', worktreePath: '/wt/ticket-5' });
    s.tickets.findById.mockResolvedValue(t);
    s.events.listForTicket.mockResolvedValue([
      { type: TicketEventType.ReviewRejected, body: 'Handle zero too', meta: null },
      { type: TicketEventType.StatusChanged, body: '', meta: { from: 'review', to: 'pending', actor: 'human' } },
    ] as never);
    await s.worker.processTicket(t);
    expect(s.calls[0]!.ticket.sessionId).toBe('sess-old');
    expect(s.calls[0]!.prompt).toContain('Handle zero too');
    expect(s.tickets.patchInternal).not.toHaveBeenCalledWith('t1', { sessionId: 'sess-1' });
    expect(s.tickets.patchInternal).not.toHaveBeenCalledWith('t1', expect.objectContaining({ branchName: expect.anything() }));
  });

  it('adds only the cost increase for a resumed session', async () => {
    const s = setup([
      async (p) => {
        await p.onResult({ costUsd: 1.5, subtype: 'success', isError: false });
        submit(p);
        return { aborted: false, sessionId: 'sess-old' };
      },
    ], { commits: true });
    const t = makeTicket({ sessionId: 'sess-old', branchName: 'agent/ticket-5', worktreePath: '/wt/ticket-5' });
    s.events.listForTicket.mockResolvedValue([
      { type: TicketEventType.AgentLog, body: 'Run finished', meta: { kind: 'text', sessionId: 'sess-old', sessionCostUsd: 1.0 } },
    ] as never);
    await s.worker.processTicket(t);
    expect(s.tickets.addCost).toHaveBeenCalledTimes(1);
    expect((s.tickets.addCost.mock.calls[0] as unknown[])[1]).toBeCloseTo(0.5);
  });

  it('clears lockedAt in finally while the ticket is still in progress', async () => {
    const s = setup([async () => ({ aborted: true })]);
    void s.registry; // shutdown-style abort leaves the ticket in progress
    await s.worker.processTicket(s.getTicket());
    expect(s.tickets.patchInternal).toHaveBeenCalledWith('t1', { lockedAt: null });
  });
});

describe('AgentWorkerService bootstrap and loop', () => {
  // RunRegistry.abortAll() keeps a 10s timeout timer alive; nothing is running here anyway.
  beforeEach(() => jest.spyOn(RunRegistry.prototype, 'abortAll').mockResolvedValue(undefined));
  afterEach(() => jest.restoreAllMocks());

  it('recovers, claims only from ready projects, and processes claimed tickets', async () => {
    const s = setup([run(submit)], { commits: true });
    const claimed = s.getTicket();
    s.tickets.claimNext.mockResolvedValueOnce(claimed as never);
    await s.worker.onApplicationBootstrap();
    expect(s.tickets.recoverInterrupted).toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 50));
    expect(s.tickets.claimNext).toHaveBeenCalledWith(['p1']);
    expect(s.runner.run).toHaveBeenCalledTimes(1);
    await s.worker.onApplicationShutdown();
    expect(s.registry.abortAll).toHaveBeenCalled();
  });

  it('does not claim while paused', async () => {
    const s = setup([]);
    s.settings.get.mockResolvedValue({ globalRules: '', workerEnabled: false });
    await s.worker.onApplicationBootstrap();
    await new Promise((r) => setTimeout(r, 40));
    expect(s.tickets.claimNext).not.toHaveBeenCalled();
    await s.worker.onApplicationShutdown();
  });

  it('survives an error in an iteration', async () => {
    const s = setup([]);
    s.tickets.claimNext.mockRejectedValueOnce(new Error('db hiccup'));
    await s.worker.onApplicationBootstrap();
    await new Promise((r) => setTimeout(r, 1200));
    expect(s.tickets.claimNext.mock.calls.length).toBeGreaterThan(1);
    await s.worker.onApplicationShutdown();
  });
});
