import { EventAuthor, TicketEventType } from '@agent-board/shared';
import { z } from 'zod';
import {
  buildBoardServer,
  createBoardToolHandlers,
  requestContextShape,
  type BoardEventsSink,
} from './board-tools';
import { createRunState, type RunState } from './run-state';

function setup() {
  const append = jest.fn().mockResolvedValue({});
  const events: BoardEventsSink = { append };
  const runState: RunState = createRunState();
  const h = createBoardToolHandlers({ ticketId: 't1', runState, events });
  return { append, runState, h };
}

describe('board tools', () => {
  it('submit_fix records review and an agent_summary event', async () => {
    const { append, runState, h } = setup();
    const res = await h.submit_fix({ summary: 'Fixed the off-by-one.', testing: 'pnpm test: 3 passed' });
    expect(res.isError).toBeUndefined();
    expect(runState).toMatchObject({
      outcome: 'review',
      summary: 'Fixed the off-by-one.',
      testing: 'pnpm test: 3 passed',
      finishCalls: 1,
      finishedWith: 'submit_fix',
    });
    expect(append).toHaveBeenCalledWith({
      ticketId: 't1',
      type: TicketEventType.AgentSummary,
      author: EventAuthor.Agent,
      body: '## Summary\nFixed the off-by-one.\n\n## Testing\npnpm test: 3 passed',
      meta: { summary: 'Fixed the off-by-one.', testing: 'pnpm test: 3 passed' },
    });
  });

  it('request_context records needs_context and one agent_question event', async () => {
    const { append, runState, h } = setup();
    await h.request_context({ questions: ['Which file?', 'Keep the API?'], reason: 'Ambiguous' });
    expect(runState).toMatchObject({
      outcome: 'needs_context',
      questions: ['Which file?', 'Keep the API?'],
      reason: 'Ambiguous',
      finishCalls: 1,
    });
    expect(append).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledWith({
      ticketId: 't1',
      type: TicketEventType.AgentQuestion,
      author: EventAuthor.Agent,
      body: '1. Which file?\n2. Keep the API?\n\nReason: Ambiguous',
      meta: { questions: ['Which file?', 'Keep the API?'], reason: 'Ambiguous' },
    });
  });

  it('give_up records failed with the reason and writes no event', async () => {
    const { append, runState, h } = setup();
    await h.give_up({ reason: 'Needs a database migration I cannot run' });
    expect(runState).toMatchObject({ outcome: 'failed', reason: 'Needs a database migration I cannot run', finishCalls: 1 });
    expect(append).not.toHaveBeenCalled();
  });

  it('add_note writes an agent_log note and does not finish', async () => {
    const { append, runState, h } = setup();
    await h.add_note({ message: 'Found the bug in utils.ts' });
    expect(runState).toEqual({ finishCalls: 0 });
    expect(append).toHaveBeenCalledWith({
      ticketId: 't1',
      type: TicketEventType.AgentLog,
      author: EventAuthor.Agent,
      body: 'Found the bug in utils.ts',
      meta: { kind: 'note' },
    });
  });

  it('rejects a second finishing call', async () => {
    const { append, runState, h } = setup();
    await h.request_context({ questions: ['Q?'], reason: 'r' });
    const second = await h.submit_fix({ summary: 's', testing: 't' });
    expect(second).toEqual({
      content: [{ type: 'text', text: 'You already finished this run with request_context.' }],
      isError: true,
    });
    const third = await h.give_up({ reason: 'x' });
    expect(third.content[0]!.text).toBe('You already finished this run with request_context.');
    expect(runState.outcome).toBe('needs_context');
    expect(runState.finishCalls).toBe(1);
    expect(append).toHaveBeenCalledTimes(1);
  });

  it('does not record the outcome when the event cannot be written', async () => {
    const { append, runState, h } = setup();
    append.mockRejectedValueOnce(new Error('db down'));
    const res = await h.submit_fix({ summary: 's', testing: 't' });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain('db down');
    expect(runState.outcome).toBeUndefined();
    // and the agent can try again
    await h.submit_fix({ summary: 's', testing: 't' });
    expect(runState.outcome).toBe('review');
  });

  describe('request_context validation (1-5 questions)', () => {
    const schema = z.object(requestContextShape);
    it.each([
      [[], false],
      [['a'], true],
      [['a', 'b', 'c', 'd', 'e'], true],
      [['a', 'b', 'c', 'd', 'e', 'f'], false],
      [[''], false],
    ])('questions %j valid=%s', (questions, valid) => {
      expect(schema.safeParse({ questions, reason: 'r' }).success).toBe(valid);
    });

    it('the handler also rejects invalid input defensively', async () => {
      const { runState, h } = setup();
      const res = await h.request_context({ questions: [], reason: 'r' });
      expect(res.isError).toBe(true);
      expect(runState.outcome).toBeUndefined();
    });
  });

  it('buildBoardServer registers the four tools on a "board" server', async () => {
    const tool = jest.fn((name: string, _d: string, _s: unknown, handler: unknown) => ({ name, handler }));
    const createSdkMcpServer = jest.fn((opts: unknown) => ({ type: 'sdk', opts }));
    const runState = createRunState();
    buildBoardServer({ tool, createSdkMcpServer } as never, {
      ticketId: 't1',
      runState,
      events: { append: jest.fn().mockResolvedValue({}) },
    });
    expect(tool.mock.calls.map((c) => c[0])).toEqual(['submit_fix', 'request_context', 'give_up', 'add_note']);
    const opts = createSdkMcpServer.mock.calls[0]![0] as { name: string; version: string; tools: { handler: Function }[] };
    expect(opts.name).toBe('board');
    expect(opts.version).toBe('1.0.0');
    await opts.tools[2]!.handler({ reason: 'nope' });
    expect(runState.outcome).toBe('failed');
  });
});
