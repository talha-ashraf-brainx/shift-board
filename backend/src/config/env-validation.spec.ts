import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createTempGitRepo, type TempRepo } from '../../test/helpers/test-db';
import { ConfigValidationError, buildAppConfig, isLoopbackHost, parseToolList } from './env-validation';

const silent = { warn: jest.fn() } as never;

describe('parseToolList', () => {
  it('splits on top-level commas only', () => {
    expect(parseToolList('Bash(npm test:*),Bash(node:*)')).toEqual(['Bash(npm test:*)', 'Bash(node:*)']);
    expect(parseToolList(' Bash(a, b:*) , Read ,, ')).toEqual(['Bash(a, b:*)', 'Read']);
    expect(parseToolList('')).toEqual([]);
    expect(parseToolList(undefined)).toEqual([]);
  });
});

describe('buildAppConfig', () => {
  let repo: TempRepo;
  beforeAll(() => {
    repo = createTempGitRepo();
  });
  afterAll(() => repo.cleanup());

  const base = () => ({
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    TARGET_REPO_PATH: repo.repoPath,
    BASE_BRANCH: 'main',
    WORKTREES_DIR: repo.worktreesDir,
  });

  it('applies defaults; the API key is optional', () => {
    const warn = jest.fn();
    const c = buildAppConfig(base(), { warn } as never);
    expect(c).toMatchObject({
      anthropicApiKey: null,
      baseBranch: 'main',
      agentModel: undefined,
      agentMaxTurns: 60,
      agentConcurrency: 3,
      agentMaxBudgetUsd: null,
      checkTimeoutMs: 600_000,
      agentCheckRetries: 2,
      pollIntervalMs: 3000,
      apiPort: 3000,
      webOrigin: 'http://localhost:5173',
      publicUrl: 'http://localhost:5173',
      agentExtraAllowedTools: [],
      s3: {
        endpoint: 'http://localhost:9000',
        region: 'us-east-1',
        bucket: 'shiftboard-attachments',
        accessKey: 'minioadmin',
        secretKey: 'minioadmin',
        forcePathStyle: true,
      },
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('claude'));
  });

  it('worker limits: concurrency, budget, check timeout and retries', () => {
    const c = buildAppConfig(
      { ...base(), AGENT_CONCURRENCY: '5', AGENT_MAX_BUDGET_USD: '2.5', CHECK_TIMEOUT_MS: '60000', AGENT_CHECK_RETRIES: '0' },
      silent,
    );
    expect(c).toMatchObject({ agentConcurrency: 5, agentMaxBudgetUsd: 2.5, checkTimeoutMs: 60_000, agentCheckRetries: 0 });
    expect(() => buildAppConfig({ ...base(), AGENT_CONCURRENCY: '0' }, silent)).toThrow(/AGENT_CONCURRENCY/);
    expect(() => buildAppConfig({ ...base(), AGENT_CONCURRENCY: '99' }, silent)).toThrow(/AGENT_CONCURRENCY/);
    expect(() => buildAppConfig({ ...base(), AGENT_MAX_BUDGET_USD: '-1' }, silent)).toThrow(/AGENT_MAX_BUDGET_USD/);
    expect(() => buildAppConfig({ ...base(), AGENT_CHECK_RETRIES: 'x' }, silent)).toThrow(/AGENT_CHECK_RETRIES/);
  });

  it('never logs the key', () => {
    const warn = jest.fn();
    const c = buildAppConfig({ ...base(), ANTHROPIC_API_KEY: 'sk-ant-secret' }, { warn } as never);
    expect(c.anthropicApiKey).toBe('sk-ant-secret');
    expect(warn).not.toHaveBeenCalled();
  });

  it('PUBLIC_URL: trims trailing slashes and rejects non-http(s) URLs', () => {
    expect(buildAppConfig({ ...base(), PUBLIC_URL: 'https://board.example.com/' }, silent).publicUrl).toBe(
      'https://board.example.com',
    );
    expect(() => buildAppConfig({ ...base(), PUBLIC_URL: 'ftp://x' }, silent)).toThrow(/PUBLIC_URL/);
    expect(() => buildAppConfig({ ...base(), PUBLIC_URL: 'not a url' }, silent)).toThrow(/PUBLIC_URL/);
  });

  it('collects every problem into one message', () => {
    let err: ConfigValidationError | undefined;
    try {
      buildAppConfig({ TARGET_REPO_PATH: '/definitely/not/here', AGENT_MAX_TURNS: 'abc', API_PORT: '99999' }, silent);
    } catch (e) {
      err = e as ConfigValidationError;
    }
    expect(err).toBeInstanceOf(ConfigValidationError);
    expect(err!.problems).toEqual(
      expect.arrayContaining([
        'DATABASE_URL is required',
        'WORKTREES_DIR is required',
        expect.stringContaining('AGENT_MAX_TURNS'),
        expect.stringContaining('API_PORT'),
      ]),
    );
    expect(err!.message).toContain('DATABASE_URL is required');
  });

  it('TARGET_REPO_PATH/BASE_BRANCH are optional; a bad seed repo only warns', () => {
    const { TARGET_REPO_PATH: _t, BASE_BRANCH: _b, ...rest } = base();
    expect(buildAppConfig(rest, silent)).toMatchObject({ targetRepoPath: null, baseBranch: null });

    const dir = join(repo.worktreesDir, '..', 'plain');
    mkdirSync(dir, { recursive: true });
    const warn = jest.fn();
    expect(buildAppConfig({ ...base(), TARGET_REPO_PATH: dir }, { warn } as never).targetRepoPath).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/not a git repository/));

    const inside = buildAppConfig({ ...base(), WORKTREES_DIR: join(repo.repoPath, 'wt') }, silent);
    expect(inside.targetRepoPath).toBeNull();
  });

  it('rejects a relative WORKTREES_DIR', () => {
    expect(() => buildAppConfig({ ...base(), WORKTREES_DIR: 'rel/wt' }, silent)).toThrow(/absolute/);
  });

  it('parses optional values', () => {
    const c = buildAppConfig(
      {
        ...base(),
        AGENT_MODEL: 'claude-x',
        AGENT_MAX_TURNS: '10',
        AGENT_EXTRA_ALLOWED_TOOLS: 'Bash(npm test:*),Bash(node:*)',
        API_PORT: '4000',
        WEB_ORIGIN: 'http://x',
      },
      silent,
    );
    expect(c).toMatchObject({
      agentModel: 'claude-x',
      agentMaxTurns: 10,
      agentExtraAllowedTools: ['Bash(npm test:*)', 'Bash(node:*)'],
      apiPort: 4000,
      webOrigin: 'http://x',
    });
  });

  it('parses the S3 settings', () => {
    const c = buildAppConfig(
      {
        ...base(),
        S3_ENDPOINT: 'https://s3.example.com',
        S3_REGION: 'eu-west-1',
        S3_BUCKET: 'imgs',
        S3_ACCESS_KEY: 'ak',
        S3_SECRET_KEY: 'sk',
        S3_FORCE_PATH_STYLE: 'false',
      },
      silent,
    );
    expect(c.s3).toEqual({
      endpoint: 'https://s3.example.com',
      region: 'eu-west-1',
      bucket: 'imgs',
      accessKey: 'ak',
      secretKey: 'sk',
      forcePathStyle: false,
    });
  });

  it('rejects a bad S3_ENDPOINT or S3_FORCE_PATH_STYLE', () => {
    let err: ConfigValidationError | undefined;
    try {
      buildAppConfig({ ...base(), S3_ENDPOINT: 'not a url', S3_FORCE_PATH_STYLE: 'maybe' }, silent);
    } catch (e) {
      err = e as ConfigValidationError;
    }
    expect(err!.problems).toEqual([
      expect.stringContaining('S3_ENDPOINT is not a valid URL'),
      expect.stringContaining('S3_FORCE_PATH_STYLE must be true or false'),
    ]);
    expect(() => buildAppConfig({ ...base(), S3_ENDPOINT: 'ftp://x' }, silent)).toThrow(/http\(s\)/);
  });

  it('binds to loopback by default; BOARD_TOKEN is optional', () => {
    expect(buildAppConfig(base(), silent)).toMatchObject({ apiHost: '127.0.0.1', boardToken: null });
    const c = buildAppConfig({ ...base(), API_HOST: '0.0.0.0', BOARD_TOKEN: '  0123456789abcdef  ' }, silent);
    expect(c).toMatchObject({ apiHost: '0.0.0.0', boardToken: '0123456789abcdef' });
  });

  it('rejects a short BOARD_TOKEN without echoing it, and a malformed API_HOST', () => {
    let err: ConfigValidationError | undefined;
    try {
      buildAppConfig({ ...base(), BOARD_TOKEN: 'short-secret', API_HOST: 'http://x' }, silent);
    } catch (e) {
      err = e as ConfigValidationError;
    }
    expect(err!.problems).toEqual([
      expect.stringContaining('API_HOST must be a hostname'),
      expect.stringContaining('BOARD_TOKEN must be at least 16 characters'),
    ]);
    expect(err!.message).not.toContain('short-secret');
  });

  it('warns when the API is exposed beyond loopback without a token', () => {
    const warn = jest.fn();
    buildAppConfig({ ...base(), ANTHROPIC_API_KEY: 'k', API_HOST: '0.0.0.0' }, { warn } as never);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('BOARD_TOKEN is not set'));
    warn.mockClear();
    buildAppConfig({ ...base(), ANTHROPIC_API_KEY: 'k', API_HOST: 'localhost' }, { warn } as never);
    buildAppConfig({ ...base(), ANTHROPIC_API_KEY: 'k', API_HOST: '0.0.0.0', BOARD_TOKEN: 'x'.repeat(16) }, { warn } as never);
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('BOARD_TOKEN'));
  });
});

describe('isLoopbackHost', () => {
  it('recognises loopback addresses only', () => {
    for (const h of ['127.0.0.1', '127.1.2.3', '::1', 'localhost', 'LOCALHOST']) expect(isLoopbackHost(h)).toBe(true);
    for (const h of ['0.0.0.0', '::', '192.168.1.5', 'example.com']) expect(isLoopbackHost(h)).toBe(false);
  });
});
