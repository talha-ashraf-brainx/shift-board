import type { RunHandle } from '../common/run-registry.service';
import type { AppConfig } from '../config/app-config';
import type { EventsService } from '../events/events.service';
import { AgentRunner, type AgentRunParams } from './agent-runner';
import { createRunState } from './run-state';
import { loadSdk } from './sdk-loader';

jest.mock('./sdk-loader', () => ({ loadSdk: jest.fn() }));

class FakeAbortError extends Error {
  constructor(m = 'aborted') {
    super(m);
    this.name = 'AbortError';
  }
}

function makeSdk(messages: unknown[] | (() => AsyncGenerator<unknown>)) {
  const query = jest.fn(({}: { prompt: string; options: Record<string, unknown> }) =>
    typeof messages === 'function'
      ? messages()
      : (async function* () {
          for (const m of messages) yield m;
        })(),
  );
  return {
    query,
    tool: jest.fn((name: string) => ({ name })),
    createSdkMcpServer: jest.fn((opts: unknown) => ({ type: 'sdk', name: 'board', opts })),
    AbortError: FakeAbortError,
  };
}

const config = {
  anthropicApiKey: null,
  agentModel: undefined,
  agentMaxTurns: 60,
  agentExtraAllowedTools: ['Bash(pnpm test:*)'],
} as unknown as AppConfig;

function makeHandle(): RunHandle {
  const controller = new AbortController();
  return { controller, signal: controller.signal, isCancelRequested: () => false, finish: () => undefined };
}

function params(overrides: Partial<AgentRunParams> = {}): AgentRunParams {
  return {
    ticket: { id: 't1', number: 7, worktreePath: '/wt/ticket-7', sessionId: null },
    prompt: 'do it',
    systemAppend: 'append',
    runState: createRunState(),
    handle: makeHandle(),
    onSessionId: jest.fn(),
    onLog: jest.fn(),
    onResult: jest.fn(),
    ...overrides,
  };
}

const init = { type: 'system', subtype: 'init', session_id: 'sess-1' };
const assistant = (content: unknown[]) => ({ type: 'assistant', message: { content }, parent_tool_use_id: null });
const result = (subtype: string, extra: Record<string, unknown> = {}) => ({
  type: 'result',
  subtype,
  is_error: subtype !== 'success',
  total_cost_usd: 0.12,
  num_turns: 4,
  result: 'done',
  ...(subtype === 'success' ? {} : { errors: [] }),
  ...extra,
});

describe('AgentRunner', () => {
  const events = { append: jest.fn() } as unknown as EventsService;
  const mockedLoad = loadSdk as jest.MockedFunction<typeof loadSdk>;

  it('passes the spec options to query()', async () => {
    const sdk = makeSdk([init, result('success')]);
    mockedLoad.mockResolvedValue(sdk as never);
    const runner = new AgentRunner(config, events);
    const p = params({ ticket: { id: 't1', number: 7, worktreePath: '/wt/ticket-7', sessionId: 'sess-0' } });
    await runner.run(p);

    const { prompt, options } = sdk.query.mock.calls[0]![0];
    expect(prompt).toBe('do it');
    expect(options).toMatchObject({
      cwd: '/wt/ticket-7',
      resume: 'sess-0',
      systemPrompt: { type: 'preset', preset: 'claude_code', append: 'append' },
      settingSources: ['project'],
      permissionMode: 'acceptEdits',
      maxTurns: 60,
      abortController: p.handle.controller,
      disallowedTools: ['WebFetch', 'WebSearch', 'Bash(git push:*)', 'Bash(git checkout:*)'],
    });
    expect(options.allowedTools).toEqual([
      'Read', 'Edit', 'Write', 'Glob', 'Grep',
      'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git add:*)', 'Bash(git commit:*)',
      'Bash(pnpm test:*)',
      'mcp__board__submit_fix', 'mcp__board__request_context', 'mcp__board__give_up', 'mcp__board__add_note',
    ]);
    expect(options).not.toHaveProperty('model');
    expect((options.mcpServers as Record<string, unknown>).board).toBeDefined();
    expect((options.env as Record<string, string | undefined>).ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('sets model and API key only when configured', async () => {
    const sdk = makeSdk([result('success')]);
    mockedLoad.mockResolvedValue(sdk as never);
    const runner = new AgentRunner({ ...config, agentModel: 'claude-x', anthropicApiKey: 'sk-test' } as AppConfig, events);
    await runner.run(params());
    const { options } = sdk.query.mock.calls[0]![0];
    expect(options.model).toBe('claude-x');
    expect((options.env as Record<string, string>).ANTHROPIC_API_KEY).toBe('sk-test');
    expect(options).not.toHaveProperty('resume');
  });

  it('consumes the stream: session id, throttled logs, result', async () => {
    const sdk = makeSdk([
      init,
      assistant([{ type: 'text', text: 'Let me look at the code.' }, { type: 'text', text: 'second text ignored' }]),
      assistant([{ type: 'tool_use', name: 'Read', input: { file_path: '/wt/ticket-7/src/a.ts' } }]),
      assistant([{ type: 'tool_use', name: 'Bash', input: { command: 'git commit -m x' } }]),
      result('success'),
    ]);
    mockedLoad.mockResolvedValue(sdk as never);
    const p = params();
    const out = await new AgentRunner(config, events).run(p);

    expect(out).toEqual({ sessionId: 'sess-1', resultSubtype: 'success', aborted: false });
    expect(p.onSessionId).toHaveBeenCalledWith('sess-1');
    expect(p.onLog).toHaveBeenCalledWith('Let me look at the code.', { kind: 'text', count: 1 });
    expect(p.onLog).toHaveBeenCalledWith('Read src/a.ts\nBash: git commit -m x', { kind: 'tool', count: 2 });
    expect(p.onResult).toHaveBeenCalledWith({ costUsd: 0.12, subtype: 'success', isError: false, numTurns: 4 });
  });

  it('reports a result error subtype', async () => {
    mockedLoad.mockResolvedValue(makeSdk([init, result('error_max_turns')]) as never);
    const out = await new AgentRunner(config, events).run(params());
    expect(out.resultSubtype).toBe('error_max_turns');
    expect(out.resultError).toBe('The agent reached the maximum number of turns (60) without finishing.');
  });

  it('returns aborted instead of throwing on AbortError', async () => {
    const handle = makeHandle();
    mockedLoad.mockResolvedValue(
      makeSdk(async function* () {
        yield init;
        handle.controller.abort();
        throw new FakeAbortError();
      }) as never,
    );
    const out = await new AgentRunner(config, events).run(params({ handle }));
    expect(out).toEqual({ sessionId: 'sess-1', aborted: true });
  });

  it('rethrows other errors', async () => {
    mockedLoad.mockResolvedValue(
      makeSdk(async function* () {
        yield init;
        throw new Error('CLI crashed');
      }) as never,
    );
    await expect(new AgentRunner(config, events).run(params())).rejects.toThrow('CLI crashed');
  });
});
