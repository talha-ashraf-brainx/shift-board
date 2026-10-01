import { execFile } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, isAbsolute } from 'node:path';
import type { DiffDto, DiffFileDto } from '@agent-board/shared';
import {
  BaseRepoNotReadyError,
  GitError,
  GitOperations,
  GitRepoConfig,
  GitTicketRef,
  MergeConflictError,
  RepoCleanCheck,
  RepoStatus,
  WorktreeInfo,
} from './git.types';

const GIT_TIMEOUT_MS = 60_000;
const GIT_MAX_BUFFER = 64 * 1024 * 1024;
const FALLBACK_NAME = 'Shiftboard';
const FALLBACK_EMAIL = 'agent-board@localhost';

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface RegisteredWorktree {
  path: string;
  branch: string | null;
}

/**
 * Wraps the git CLI for one project's repo. Every call goes through execFile with an argv
 * array: no shell is ever involved, so ticket text cannot be interpreted as a command.
 * Get instances from GitServiceFactory.forProject().
 */
export class GitService implements GitOperations {
  constructor(private readonly config: GitRepoConfig) {}

  private get repo(): string {
    return this.config.targetRepoPath;
  }

  private get base(): string {
    return this.config.baseBranch;
  }

  branchNameFor(ticketNumber: number): string {
    return `agent/ticket-${ticketNumber}`;
  }

  worktreePathFor(ticketNumber: number): string {
    return join(this.config.worktreesDir, `ticket-${ticketNumber}`);
  }

  /** The ticket's stored worktree path when set (older layouts), else the computed one. */
  private pathOf(ticket: GitTicketRef): string {
    return ticket.worktreePath || this.worktreePathFor(ticket.number);
  }

  // ---------------------------------------------------------------------------
  // Worktrees

  async createWorktree(ticket: GitTicketRef): Promise<WorktreeInfo> {
    const branchName = this.branchNameFor(ticket.number);
    const worktreePath = this.pathOf(ticket);
    await mkdir(dirname(worktreePath), { recursive: true });

    let registered = await this.listWorktrees();
    const atPath = registered.find((w) => samePath(w.path, worktreePath));

    if (atPath) {
      if (existsSync(worktreePath)) {
        return { branchName, worktreePath };
      }
      // Registered but the directory is gone: drop the stale entry, then re-add.
      await this.run(['worktree', 'prune'], this.repo);
      registered = await this.listWorktrees();
    }

    // The branch may already be checked out in another (existing) worktree.
    const elsewhere = registered.find((w) => w.branch === branchName && existsSync(w.path));
    if (elsewhere) {
      return { branchName, worktreePath: elsewhere.path };
    }

    // An unregistered leftover directory would make `worktree add` fail.
    if (existsSync(worktreePath)) {
      await this.removeLeftoverDir(worktreePath);
    }

    if (await this.branchExists(branchName)) {
      await this.run(['worktree', 'add', worktreePath, branchName], this.repo);
    } else {
      await this.run(['worktree', 'add', '-b', branchName, worktreePath, this.base], this.repo);
    }
    return { branchName, worktreePath };
  }

  async removeWorktree(ticket: GitTicketRef, opts: { deleteBranch: boolean }): Promise<void> {
    const branchName = this.branchNameFor(ticket.number);
    const worktreePath = this.pathOf(ticket);

    const registered = await this.listWorktrees();
    const targets = registered.filter(
      (w) => samePath(w.path, worktreePath) || (w.branch === branchName && !samePath(w.path, this.repo)),
    );
    for (const w of targets) {
      await this.tryRun(['worktree', 'remove', '--force', w.path], this.repo);
    }
    if (existsSync(worktreePath)) {
      await this.removeLeftoverDir(worktreePath);
    }
    await this.tryRun(['worktree', 'prune'], this.repo);

    if (opts.deleteBranch && (await this.branchExists(branchName))) {
      await this.run(['branch', '-D', branchName], this.repo);
    }
    await this.tryRun(['worktree', 'prune'], this.repo);
  }

  async resetWorktreeToBase(ticket: GitTicketRef): Promise<void> {
    const worktreePath = this.pathOf(ticket);
    if (!existsSync(worktreePath)) return;
    await this.run(['reset', '--hard', this.base], worktreePath);
    await this.run(['clean', '-fd'], worktreePath);
  }

  // ---------------------------------------------------------------------------
  // Commits

  async hasNewCommits(ticket: GitTicketRef): Promise<boolean> {
    const branchName = this.branchNameFor(ticket.number);
    if (!(await this.branchExists(branchName))) return false;
    const { stdout } = await this.run(['rev-list', '--count', `${this.base}..${branchName}`], this.repo);
    return Number.parseInt(stdout.trim(), 10) > 0;
  }

  async hasUncommittedChanges(worktreePath: string): Promise<boolean> {
    const { stdout } = await this.run(['status', '--porcelain'], worktreePath);
    return stdout.trim().length > 0;
  }

  async commitAll(worktreePath: string, message: string): Promise<void> {
    await this.run(['add', '-A'], worktreePath);
    const staged = await this.tryRun(['diff', '--cached', '--quiet'], worktreePath);
    if (staged.code === 0) return; // nothing to commit
    const identity = await this.identityArgs(worktreePath);
    await this.run([...identity, 'commit', '--no-verify', '-m', message], worktreePath);
  }

  // ---------------------------------------------------------------------------
  // Diff & merge

  async diff(ticket: GitTicketRef): Promise<DiffDto> {
    const branchName = this.branchNameFor(ticket.number);
    const range = `${this.base}...${branchName}`;
    const [patch, numstat] = await Promise.all([
      this.run(['diff', '--no-color', '--no-ext-diff', '--no-renames', range, '--'], this.repo),
      this.run(['diff', '--numstat', '-z', '--no-renames', range, '--'], this.repo),
    ]);
    return {
      baseBranch: this.base,
      branchName,
      files: parseNumstatZ(numstat.stdout),
      patch: patch.stdout,
    };
  }

  async merge(ticket: GitTicketRef): Promise<{ output: string }> {
    const branchName = this.branchNameFor(ticket.number);

    const check = await this.checkBaseRepoClean();
    if (!check.clean) throw new BaseRepoNotReadyError(check.reason);
    if (!(await this.branchExists(branchName))) {
      throw new BaseRepoNotReadyError(`Branch '${branchName}' does not exist in the target repo`);
    }

    const message = `Merge ticket #${ticket.number}: ${ticket.title}`;
    const identity = await this.identityArgs(this.repo);
    const res = await this.tryRun(
      [...identity, 'merge', '--no-ff', '--no-edit', '-m', message, branchName],
      this.repo,
    );
    if (res.code === 0) {
      return { output: (res.stdout + res.stderr).trim() };
    }

    const conflicted = await this.tryRun(['diff', '--name-only', '--diff-filter=U', '-z'], this.repo);
    const files = conflicted.stdout.split('\0').filter(Boolean);
    const inMerge = (await this.tryRun(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], this.repo)).code === 0;
    await this.tryRun(['merge', '--abort'], this.repo);

    if (files.length > 0 || inMerge) {
      throw new MergeConflictError(branchName, files);
    }
    throw new GitError(
      `git merge failed: ${res.stderr.trim() || res.stdout.trim()}`,
      ['merge', '--no-ff', '-m', message, branchName],
      res.code,
      res.stderr,
    );
  }

  async checkBaseRepoClean(): Promise<RepoCleanCheck> {
    const s = await this.repoStatus();
    return s.ready ? { clean: true } : { clean: false, reason: s.reason ?? 'Repo is not ready' };
  }

  async repoStatus(): Promise<RepoStatus> {
    const notReady = (reason: string, currentBranch: string | null = null): RepoStatus => ({
      ready: false,
      reason,
      currentBranch,
    });
    if (!existsSync(this.repo)) return notReady(`Repo path does not exist: ${this.repo}`);
    const inside = await this.tryRun(['rev-parse', '--is-inside-work-tree'], this.repo);
    if (inside.code !== 0 || inside.stdout.trim() !== 'true') {
      return notReady(`Repo path is not a git repository: ${this.repo}`);
    }

    const head = await this.tryRun(['symbolic-ref', '--short', '-q', 'HEAD'], this.repo);
    const branch = head.code === 0 ? head.stdout.trim() : null;
    if (branch !== this.base) {
      return notReady(
        branch
          ? `Repo is on branch '${branch}', expected '${this.base}'`
          : `Repo has a detached HEAD, expected branch '${this.base}'`,
        branch,
      );
    }

    const status = await this.run(['status', '--porcelain', '-z'], this.repo);
    const paths = parsePorcelainZ(status.stdout);
    if (paths.length > 0) {
      const shown = paths.slice(0, 5).join(', ');
      const more = paths.length > 5 ? ` (and ${paths.length - 5} more)` : '';
      return notReady(`Repo has uncommitted changes: ${shown}${more}`, branch);
    }
    return { ready: true, reason: null, currentBranch: branch };
  }

  // ---------------------------------------------------------------------------
  // Helpers

  private async branchExists(branchName: string): Promise<boolean> {
    const res = await this.tryRun(['rev-parse', '--verify', '--quiet', `refs/heads/${branchName}`], this.repo);
    return res.code === 0;
  }

  private async listWorktrees(): Promise<RegisteredWorktree[]> {
    const { stdout } = await this.run(['worktree', 'list', '--porcelain'], this.repo);
    const out: RegisteredWorktree[] = [];
    let current: RegisteredWorktree | null = null;
    for (const line of stdout.split('\n')) {
      if (line.startsWith('worktree ')) {
        current = { path: line.slice('worktree '.length), branch: null };
        out.push(current);
      } else if (current && line.startsWith('branch ')) {
        current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
      }
    }
    return out;
  }

  /** Deletes a directory, but only when it lives inside WORKTREES_DIR. */
  private async removeLeftoverDir(dir: string): Promise<void> {
    const rel = relative(resolve(this.config.cleanupRoot ?? this.config.worktreesDir), resolve(dir));
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
      throw new GitError(`Refusing to delete ${dir}: outside WORKTREES_DIR`, [], null, '');
    }
    await rm(dir, { recursive: true, force: true });
  }

  /** `-c user.name/-c user.email` only when the repo has no identity configured. */
  private async identityArgs(cwd: string): Promise<string[]> {
    const args: string[] = [];
    const name = await this.tryRun(['config', '--get', 'user.name'], cwd);
    if (name.code !== 0 || !name.stdout.trim()) args.push('-c', `user.name=${FALLBACK_NAME}`);
    const email = await this.tryRun(['config', '--get', 'user.email'], cwd);
    if (email.code !== 0 || !email.stdout.trim()) args.push('-c', `user.email=${FALLBACK_EMAIL}`);
    return args;
  }

  /** Runs git and throws GitError on a non-zero exit. */
  private async run(args: string[], cwd: string): Promise<RunResult> {
    const res = await this.tryRun(args, cwd);
    if (res.code !== 0) {
      throw new GitError(
        `git ${args.join(' ')} failed (exit ${res.code}): ${res.stderr.trim() || res.stdout.trim()}`,
        args,
        res.code,
        res.stderr,
      );
    }
    return res;
  }

  /** Runs git and resolves with the exit code; throws only if git could not be run at all. */
  private tryRun(args: string[], cwd: string): Promise<RunResult> {
    return new Promise((resolvePromise, reject) => {
      execFile(
        'git',
        args,
        {
          cwd,
          timeout: GIT_TIMEOUT_MS,
          maxBuffer: GIT_MAX_BUFFER,
          encoding: 'utf8',
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
          windowsHide: true,
        },
        (err, stdout, stderr) => {
          if (!err) {
            resolvePromise({ code: 0, stdout, stderr });
            return;
          }
          const e = err as NodeJS.ErrnoException & { code?: number | string; killed?: boolean; signal?: string };
          if (typeof e.code === 'number') {
            resolvePromise({ code: e.code, stdout, stderr });
            return;
          }
          const why = e.killed ? `timed out or was killed (${e.signal ?? 'signal'})` : e.message;
          reject(new GitError(`git ${args.join(' ')} ${why}`, args, null, stderr ?? ''));
        },
      );
    });
  }
}

/** Parses `git diff --numstat -z --no-renames`: "<add>\t<del>\t<path>\0" per file. */
export function parseNumstatZ(out: string): DiffFileDto[] {
  const files: DiffFileDto[] = [];
  for (const rec of out.split('\0')) {
    if (!rec) continue;
    const [add = '', del = '', ...rest] = rec.split('\t');
    const path = rest.join('\t');
    if (!path) continue;
    const binary = add === '-' || del === '-';
    files.push({
      path,
      additions: add === '-' ? 0 : Number.parseInt(add, 10) || 0,
      deletions: del === '-' ? 0 : Number.parseInt(del, 10) || 0,
      binary,
    });
  }
  return files;
}

/** Paths from `git status --porcelain -z` (renames carry an extra source-path record). */
function parsePorcelainZ(out: string): string[] {
  const recs = out.split('\0');
  const paths: string[] = [];
  for (let i = 0; i < recs.length; i++) {
    const rec = recs[i] ?? '';
    if (rec.length < 4) continue;
    const xy = rec.slice(0, 2);
    paths.push(rec.slice(3));
    if (xy.includes('R') || xy.includes('C')) i++; // skip the original path
  }
  return paths;
}

/** Compares paths after resolving symlinks (e.g. macOS /var -> /private/var). */
function samePath(a: string, b: string): boolean {
  return canonical(a) === canonical(b);
}

function canonical(p: string): string {
  const abs = resolve(p);
  try {
    return realpathSync(abs);
  } catch {
    // Missing path: canonicalize the nearest existing parent.
    const parent = dirname(abs);
    if (parent === abs) return abs;
    return join(canonical(parent), basename(abs));
  }
}
