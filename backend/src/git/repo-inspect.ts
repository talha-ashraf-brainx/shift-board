import { execFile } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

/** Standalone git helpers for repos that are not (yet) projects: inspection, branch lists. */

interface Out {
  code: number;
  stdout: string;
}

function git(args: string[], cwd: string): Promise<Out> {
  return new Promise((done) => {
    execFile(
      'git',
      args,
      { cwd, timeout: 15_000, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, windowsHide: true },
      (err, stdout) => {
        if (!err) return done({ code: 0, stdout });
        const code = (err as NodeJS.ErrnoException & { code?: number | string }).code;
        done({ code: typeof code === 'number' ? code : -1, stdout: stdout ?? '' });
      },
    );
  });
}

export function realpathOr(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

/** true when `child` is `parent` or inside it. */
export function isInsidePath(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Local branch names, sorted. */
export async function listBranches(repoPath: string): Promise<string[]> {
  const res = await git(['for-each-ref', '--format=%(refname:short)', 'refs/heads/'], repoPath);
  if (res.code !== 0) return [];
  return res.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

export async function currentBranch(repoPath: string): Promise<string | null> {
  const res = await git(['symbolic-ref', '--short', '-q', 'HEAD'], repoPath);
  return res.code === 0 ? res.stdout.trim() || null : null;
}

export async function branchExists(repoPath: string, branch: string): Promise<boolean> {
  if (!branch || branch.startsWith('-')) return false;
  return (await git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], repoPath)).code === 0;
}

/** `git rev-parse --show-toplevel` (realpath), or null when `path` is not inside a work tree. */
export async function repoToplevel(path: string): Promise<string | null> {
  const res = await git(['rev-parse', '--show-toplevel'], path);
  if (res.code !== 0) return null;
  const top = res.stdout.trim();
  return top ? realpathOr(top) : null;
}

export interface RepoInspection {
  path: string;
  isGitRepo: boolean;
  error: string | null;
  repoRoot: string | null;
  branches: string[];
  currentBranch: string | null;
}

/** Never throws: problems are reported in `error`. */
export async function inspectRepo(path: string): Promise<RepoInspection> {
  const base: RepoInspection = { path, isGitRepo: false, error: null, repoRoot: null, branches: [], currentBranch: null };
  if (!path || !isAbsolute(path)) return { ...base, error: 'Path must be absolute' };
  if (!isDirectory(path)) return { ...base, error: 'Path does not exist or is not a directory' };
  const real = realpathOr(path);
  const top = await repoToplevel(real);
  if (!top) return { ...base, path: real, error: 'Not a git repository' };
  const [branches, current] = await Promise.all([listBranches(top), currentBranch(top)]);
  const info: RepoInspection = { ...base, path: real, isGitRepo: true, repoRoot: top, branches, currentBranch: current };
  if (top !== real) {
    info.error = `This folder is inside the git repository at ${top}; select the repository root instead`;
  }
  return info;
}
