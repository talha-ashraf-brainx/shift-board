import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createTempGitRepo, type TempRepo } from '../../test/helpers/test-db';
import { ConfigValidationError, buildAppConfig, parseToolList } from './env-validation';

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
      pollIntervalMs: 3000,
      apiPort: 3000,
      webOrigin: 'http://localhost:5173',
      agentExtraAllowedTools: [],
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('claude'));
  });

  it('never logs the key', () => {
    const warn = jest.fn();
    const c = buildAppConfig({ ...base(), ANTHROPIC_API_KEY: 'sk-ant-secret' }, { warn } as never);
    expect(c.anthropicApiKey).toBe('sk-ant-secret');
    expect(warn).not.toHaveBeenCalled();
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
});
