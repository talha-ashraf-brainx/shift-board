import { EventAuthor, TicketEventType } from '@agent-board/shared';
import { z } from 'zod';
import {
  buildBoardServer,
  createBoardToolHandlers,
  formatQuestionsBody,
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
    const questions = [
      { question: 'Which file?', options: [] },
      {
        question: ' Keep the API? ',
        header: ' API ',
        options: [{ label: 'Keep it', description: ' Recommended: no breaking change ' }, { label: 'Drop it', description: ' ' }],
      },
      { question: 'Which browsers?', options: [{ label: 'Chrome' }, { label: 'Safari' }], multiSelect: true },
    ];
    const stored = [
      { question: 'Which file?', options: [] },
      {
        question: 'Keep the API?',
        header: 'API',
        options: [{ label: 'Keep it', description: 'Recommended: no breaking change' }, { label: 'Drop it' }],
      },
      { question: 'Which browsers?', options: [{ label: 'Chrome' }, { label: 'Safari' }], multiSelect: true },
    ];
    await h.request_context({ questions, reason: 'Ambiguous' });
    expect(runState).toMatchObject({ outcome: 'needs_context', questions: stored, reason: 'Ambiguous', finishCalls: 1 });
    expect(append).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledWith({
      ticketId: 't1',
      type: TicketEventType.AgentQuestion,
      author: EventAuthor.Agent,
      body: [
        '1. Which file?',
        '2. **API:** Keep the API?',
        '   - Keep it: Recommended: no breaking change',
        '   - Drop it',
        '3. Which browsers? (pick any)',
        '   - Chrome',
        '   - Safari',
        '',
        'Reason: Ambiguous',
      ].join('\n'),
      meta: { questions: stored, reason: 'Ambiguous' },
    });
  });

  it('formatQuestionsBody ignores multiSelect on a free-text question', () => {
    expect(formatQuestionsBody([{ question: 'Why?', options: [], multiSelect: true }], 'r')).toBe('1. Why?\n\nReason: r');
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
    await h.request_context({ questions: [{ question: 'Q?', options: [] }], reason: 'r' });
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
    const q = (question: string, extra: Record<string, unknown> = {}) => ({ question, options: [], ...extra });
    const opts = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `Option ${i + 1}` }));
    it.each([
      [[], false],
      [[q('a')], true],
      [['a', 'b', 'c', 'd', 'e'].map((x) => q(x)), true],
      [['a', 'b', 'c', 'd', 'e', 'f'].map((x) => q(x)), false],
      [[q('')], false],
      [['a'], false],
      [[q('a', { options: opts(4), multiSelect: true })], true],
      [[q('a', { options: opts(5) })], false],
      [[q('a', { options: [{ label: '' }] })], false],
      [[q('a', { header: '12 chars max' })], true],
      [[q('a', { header: 'thirteen char' })], false],
      [[{ question: 'a' }], false],
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
