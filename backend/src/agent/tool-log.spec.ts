import { LogThrottler, SUPPRESSED_MESSAGE, summarizeToolUse } from './tool-log';

describe('summarizeToolUse', () => {
  const cwd = '/wt/ticket-1';
  it.each([
    ['Edit', { file_path: '/wt/ticket-1/src/x.ts' }, 'Edit src/x.ts'],
    ['Read', { file_path: 'src/a.ts' }, 'Read src/a.ts'],
    ['Write', { file_path: '/elsewhere/a.ts' }, 'Write /elsewhere/a.ts'],
    ['Bash', { command: 'git commit -m "fix: off by one"' }, 'Bash: git commit -m "fix: off by one"'],
    ['Grep', { pattern: 'foo' }, 'Grep "foo"'],
    ['Grep', { pattern: 'foo', path: '/wt/ticket-1/src' }, 'Grep "foo" in src'],
    ['Glob', { pattern: '**/*.ts' }, 'Glob **/*.ts'],
    ['TodoWrite', { todos: [] }, 'Update todo list'],
    ['mcp__board__submit_fix', { summary: 's', testing: 't' }, 'submit_fix: submitted the fix for review'],
    ['mcp__board__request_context', { questions: ['a', 'b'], reason: 'r' }, 'request_context: asked 2 questions'],
    ['mcp__board__give_up', { reason: 'cannot' }, 'give_up: cannot'],
    ['mcp__board__add_note', { message: 'progress' }, 'add_note: progress'],
    ['SomethingNew', { query: 'abc' }, 'SomethingNew: abc'],
  ])('%s %j → %s', (name, input, expected) => {
    expect(summarizeToolUse(name, input, cwd)).toBe(expected);
  });

  it('truncates long commands to 120 chars on one line', () => {
    const out = summarizeToolUse('Bash', { command: `echo ${'x'.repeat(300)}\nsecond line` });
    expect(out.length).toBe(120);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toContain('\n');
  });
});

describe('LogThrottler', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('coalesces lines and flushes after 2s', () => {
    const emit = jest.fn();
    const t = new LogThrottler(emit);
    t.push('Read a', { kind: 'tool', tool: 'Read' });
    t.push('Read b', { kind: 'tool', tool: 'Read' });
    expect(emit).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1999);
    expect(emit).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(emit).toHaveBeenCalledWith('Read a\nRead b', { kind: 'tool', tool: 'Read', count: 2 });
  });

  it('flushes immediately at 10 lines and omits tool when mixed', () => {
    const emit = jest.fn();
    const t = new LogThrottler(emit);
    for (let i = 0; i < 10; i++) t.push(`l${i}`, { kind: 'tool', tool: i % 2 ? 'Read' : 'Edit' });
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]![1]).toEqual({ kind: 'tool', count: 10 });
    jest.advanceTimersByTime(5000);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('flushes on a kind change and on flush()', () => {
    const emit = jest.fn();
    const t = new LogThrottler(emit);
    t.push('Read a', { kind: 'tool', tool: 'Read' });
    t.push('Thinking about it', { kind: 'text' });
    expect(emit).toHaveBeenCalledWith('Read a', { kind: 'tool', tool: 'Read', count: 1 });
    t.flush();
    expect(emit).toHaveBeenLastCalledWith('Thinking about it', { kind: 'text', count: 1 });
    t.flush();
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it('caps at 150 events then emits one suppression notice', () => {
    const emit = jest.fn();
    const t = new LogThrottler(emit);
    for (let i = 0; i < 160; i++) {
      t.push(`line ${i}`, { kind: 'tool', tool: 'Read' });
      t.flush();
    }
    expect(emit).toHaveBeenCalledTimes(151);
    expect(emit.mock.calls[150]![0]).toBe(SUPPRESSED_MESSAGE);
    expect(t.eventCount).toBe(151);
  });

  it('swallows emitter errors', () => {
    const t = new LogThrottler(() => Promise.reject(new Error('db')));
    t.push('x', { kind: 'tool' });
    expect(() => t.flush()).not.toThrow();
    const t2 = new LogThrottler(() => {
      throw new Error('sync');
    });
    t2.push('x', { kind: 'tool' });
    expect(() => t2.flush()).not.toThrow();
  });
});
