import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitService } from './git.service';
import { BaseRepoNotReadyError, GitTicketRef, MergeConflictError } from './git.types';

const ID = ['-c', 'user.name=Test User', '-c', 'user.email=test@example.com'];

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', [...ID, ...args], { cwd, encoding: 'utf8' });
}

describe('GitService', () => {
  let root: string;
  let repo: string;
  let worktreesDir: string;
  let svc: GitService;

  const ticket = (number: number, title = `Ticket ${number}`): GitTicketRef => ({ number, title });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'agent-board-git-'));
    repo = join(root, 'repo');
    worktreesDir = join(root, 'worktrees');
    execFileSync('git', ['init', '-q', '-b', 'main', repo]);
    writeFileSync(join(repo, 'a.txt'), 'line 1\nline 2\nline 3\n');
    writeFileSync(join(repo, 'config.js'), 'module.exports = { value: 1 };\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'initial');
    svc = new GitService({ targetRepoPath: repo, baseBranch: 'main', worktreesDir });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('builds branch names and worktree paths', () => {
    expect(svc.branchNameFor(7)).toBe('agent/ticket-7');
    expect(svc.worktreePathFor(7)).toBe(join(worktreesDir, 'ticket-7'));
  });

  it('creates a worktree, then reuses it', async () => {
    const info = await svc.createWorktree(ticket(1));
    expect(info).toEqual({ branchName: 'agent/ticket-1', worktreePath: join(worktreesDir, 'ticket-1') });
    expect(existsSync(join(info.worktreePath, 'a.txt'))).toBe(true);
    expect(git(info.worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('agent/ticket-1');

    writeFileSync(join(info.worktreePath, 'scratch.txt'), 'keep me');
    const again = await svc.createWorktree(ticket(1));
    expect(again).toEqual(info);
    expect(readFileSync(join(info.worktreePath, 'scratch.txt'), 'utf8')).toBe('keep me');
  });

  it('recreates a worktree for an existing branch (without -b)', async () => {
    const info = await svc.createWorktree(ticket(2));
    writeFileSync(join(info.worktreePath, 'a.txt'), 'changed\n');
    await svc.commitAll(info.worktreePath, 'work');
    await svc.removeWorktree(ticket(2), { deleteBranch: false });
    expect(existsSync(info.worktreePath)).toBe(false);

    const again = await svc.createWorktree(ticket(2));
    expect(readFileSync(join(again.worktreePath, 'a.txt'), 'utf8')).toBe('changed\n');
    expect(await svc.hasNewCommits(ticket(2))).toBe(true);
  });

  it('re-adds a worktree whose directory vanished (stale registration)', async () => {
    const info = await svc.createWorktree(ticket(3));
    rmSync(info.worktreePath, { recursive: true, force: true });
    const again = await svc.createWorktree(ticket(3));
    expect(again).toEqual(info);
    expect(existsSync(join(info.worktreePath, 'a.txt'))).toBe(true);
  });

  it('detects changes, commits them, and diffs against base', async () => {
    const t = ticket(4);
    const { worktreePath } = await svc.createWorktree(t);
    expect(await svc.hasNewCommits(t)).toBe(false);
    expect(await svc.hasUncommittedChanges(worktreePath)).toBe(false);

    writeFileSync(join(worktreePath, 'a.txt'), 'line 1\nline TWO\nline 3\nline 4\n');
    writeFileSync(join(worktreePath, 'new.txt'), 'hello\n');
    writeFileSync(join(worktreePath, 'blob.bin'), Buffer.from([0, 1, 2, 3, 0, 255]));
    expect(await svc.hasUncommittedChanges(worktreePath)).toBe(true);

    await svc.commitAll(worktreePath, 'ticket #4: change things');
    expect(await svc.hasUncommittedChanges(worktreePath)).toBe(false);
    expect(await svc.hasNewCommits(t)).toBe(true);
    // commitAll with nothing to commit is a no-op
    await expect(svc.commitAll(worktreePath, 'nothing')).resolves.toBeUndefined();

    const d = await svc.diff(t);
    expect(d.baseBranch).toBe('main');
    expect(d.branchName).toBe('agent/ticket-4');
    const byPath = Object.fromEntries(d.files.map((f) => [f.path, f]));
    expect(byPath['a.txt']).toEqual({ path: 'a.txt', additions: 2, deletions: 1, binary: false });
    expect(byPath['new.txt']).toEqual({ path: 'new.txt', additions: 1, deletions: 0, binary: false });
    expect(byPath['blob.bin']).toEqual({ path: 'blob.bin', additions: 0, deletions: 0, binary: true });
    expect(d.patch).toContain('+line TWO');
    expect(d.patch).toContain('-line 2');
    expect(d.patch).toContain('+hello');
  });

  it('diff ignores commits made on base after the branch point (three-dot)', async () => {
    const t = ticket(5);
    const { worktreePath } = await svc.createWorktree(t);
    writeFileSync(join(worktreePath, 'feature.txt'), 'f\n');
    await svc.commitAll(worktreePath, 'feature');
    writeFileSync(join(repo, 'base-only.txt'), 'b\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'base moves on');

    const d = await svc.diff(t);
    expect(d.files.map((f) => f.path)).toEqual(['feature.txt']);
  });

  it('merges cleanly into base, then removes worktree and branch', async () => {
    const t = ticket(6, 'Fix the thing');
    const { worktreePath } = await svc.createWorktree(t);
    writeFileSync(join(worktreePath, 'a.txt'), 'fixed\n');
    await svc.commitAll(worktreePath, 'ticket #6: fix');

    const res = await svc.merge(t);
    expect(typeof res.output).toBe('string');
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('fixed\n');
    expect(git(repo, 'log', '-1', '--format=%s').trim()).toBe('Merge ticket #6: Fix the thing');
    expect(git(repo, 'rev-list', '--parents', '-n', '1', 'HEAD').trim().split(' ')).toHaveLength(3); // --no-ff

    await svc.removeWorktree(t, { deleteBranch: true });
    expect(existsSync(worktreePath)).toBe(false);
    expect(git(repo, 'branch', '--list', 'agent/ticket-6').trim()).toBe('');
    expect(git(repo, 'worktree', 'list')).not.toContain('ticket-6');
    expect(await svc.checkBaseRepoClean()).toEqual({ clean: true });
  });

  it('aborts a conflicting merge, lists the files, and leaves base clean', async () => {
    const t = ticket(7);
    const { worktreePath } = await svc.createWorktree(t);
    writeFileSync(join(worktreePath, 'config.js'), 'module.exports = { value: 2 };\n');
    await svc.commitAll(worktreePath, 'branch edit');
    writeFileSync(join(repo, 'config.js'), 'module.exports = { value: 3 };\n');
    git(repo, 'commit', '-q', '-am', 'base edit');
    const headBefore = git(repo, 'rev-parse', 'HEAD').trim();

    const err = await svc.merge(t).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MergeConflictError);
    expect((err as MergeConflictError).files).toEqual(['config.js']);
    expect((err as MergeConflictError).branchName).toBe('agent/ticket-7');
    expect((err as Error).message).toContain('config.js');

    expect(existsSync(join(repo, '.git', 'MERGE_HEAD'))).toBe(false);
    expect(git(repo, 'status', '--porcelain')).toBe('');
    expect(git(repo, 'rev-parse', 'HEAD').trim()).toBe(headBefore);
    expect(await svc.checkBaseRepoClean()).toEqual({ clean: true });
  });

  it('refuses to merge when the base has uncommitted changes', async () => {
    const t = ticket(8);
    const { worktreePath } = await svc.createWorktree(t);
    writeFileSync(join(worktreePath, 'x.txt'), 'x\n');
    await svc.commitAll(worktreePath, 'x');
    writeFileSync(join(repo, 'a.txt'), 'dirty\n');
    writeFileSync(join(repo, 'untracked.txt'), 'u\n');

    const check = await svc.checkBaseRepoClean();
    expect(check.clean).toBe(false);
    if (!check.clean) {
      expect(check.reason).toMatch(/^Repo has uncommitted changes: /);
      expect(check.reason).toContain('a.txt');
      expect(check.reason).toContain('untracked.txt');
    }
    await expect(svc.merge(t)).rejects.toBeInstanceOf(BaseRepoNotReadyError);
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('dirty\n');
  });

  it('refuses to merge when the base is on the wrong branch', async () => {
    const t = ticket(9);
    const { worktreePath } = await svc.createWorktree(t);
    writeFileSync(join(worktreePath, 'x.txt'), 'x\n');
    await svc.commitAll(worktreePath, 'x');
    git(repo, 'checkout', '-q', '-b', 'other');

    expect(await svc.checkBaseRepoClean()).toEqual({
      clean: false,
      reason: "Repo is on branch 'other', expected 'main'",
    });
    await expect(svc.merge(t)).rejects.toThrow("Repo is on branch 'other', expected 'main'");
  });

  it('removeWorktree is idempotent and tolerates missing worktrees/branches', async () => {
    await expect(svc.removeWorktree(ticket(10), { deleteBranch: true })).resolves.toBeUndefined();
    await svc.createWorktree(ticket(10));
    await svc.removeWorktree(ticket(10), { deleteBranch: true });
    await expect(svc.removeWorktree(ticket(10), { deleteBranch: true })).resolves.toBeUndefined();
    expect(git(repo, 'branch', '--list', 'agent/ticket-10').trim()).toBe('');
  });

  it('handles shell metacharacters in titles safely and verbatim', async () => {
    const pwned = '/tmp/pwned';
    const hadPwned = existsSync(pwned);
    const title = '"; rm -rf / $(touch /tmp/pwned) `';
    const t = ticket(11, title);
    const { worktreePath } = await svc.createWorktree(t);
    writeFileSync(join(worktreePath, 'a.txt'), 'meta\n');
    const commitMsg = `ticket #11: ${title}`;
    await svc.commitAll(worktreePath, commitMsg);
    expect(git(worktreePath, 'log', '-1', '--format=%B').trim()).toBe(commitMsg);

    await svc.merge(t);
    expect(git(repo, 'log', '-1', '--format=%B').trim()).toBe(`Merge ticket #11: ${title}`);
    expect(existsSync(join(repo, 'a.txt'))).toBe(true);
    if (!hadPwned) expect(existsSync(pwned)).toBe(false);
  });

  it('resetWorktreeToBase discards commits and untracked files; no-op when missing', async () => {
    await expect(svc.resetWorktreeToBase(ticket(12))).resolves.toBeUndefined();
    const t = ticket(12);
    const { worktreePath } = await svc.createWorktree(t);
    writeFileSync(join(worktreePath, 'a.txt'), 'changed\n');
    await svc.commitAll(worktreePath, 'work');
    writeFileSync(join(worktreePath, 'untracked.txt'), 'u\n');
    writeFileSync(join(worktreePath, 'config.js'), 'edited\n');

    await svc.resetWorktreeToBase(t);
    expect(await svc.hasNewCommits(t)).toBe(false);
    expect(await svc.hasUncommittedChanges(worktreePath)).toBe(false);
    expect(existsSync(join(worktreePath, 'untracked.txt'))).toBe(false);
    expect(readFileSync(join(worktreePath, 'a.txt'), 'utf8')).toBe('line 1\nline 2\nline 3\n');
  });

  it('falls back to a default identity when none is configured', async () => {
    const saved = { g: process.env.GIT_CONFIG_GLOBAL, s: process.env.GIT_CONFIG_NOSYSTEM };
    const emptyCfg = join(root, 'empty-gitconfig');
    writeFileSync(emptyCfg, '');
    process.env.GIT_CONFIG_GLOBAL = emptyCfg;
    process.env.GIT_CONFIG_NOSYSTEM = '1';
    try {
      const t = ticket(13, 'No identity');
      const { worktreePath } = await svc.createWorktree(t);
      writeFileSync(join(worktreePath, 'a.txt'), 'anon\n');
      await svc.commitAll(worktreePath, 'anon commit');
      expect(git(worktreePath, 'log', '-1', '--format=%an <%ae>').trim()).toBe('Shiftboard <agent-board@localhost>');
      await svc.merge(t);
      expect(git(repo, 'log', '-1', '--format=%an|%s').trim()).toBe('Shiftboard|Merge ticket #13: No identity');
    } finally {
      if (saved.g === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = saved.g;
      if (saved.s === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
      else process.env.GIT_CONFIG_NOSYSTEM = saved.s;
    }
  });
});
