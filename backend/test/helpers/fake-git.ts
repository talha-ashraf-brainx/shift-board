import type { DiffDto } from '@agent-board/shared';
import type { GitOperations, GitTicketRef } from '../../src/git/git.types';

export const SAMPLE_DIFF = (n: number): DiffDto => ({
  baseBranch: 'main',
  branchName: `agent/ticket-${n}`,
  files: [{ path: 'src/a.ts', additions: 2, deletions: 1, binary: false }],
  patch: 'diff --git a/src/a.ts b/src/a.ts\n',
});

/** jest.fn()-backed GitOperations for service tests. */
export function createFakeGit(): jest.Mocked<GitOperations> {
  const fake = {
    branchNameFor: jest.fn((n: number) => `agent/ticket-${n}`),
    worktreePathFor: jest.fn((n: number) => `/tmp/wt/ticket-${n}`),
    createWorktree: jest.fn(async (t: GitTicketRef) => ({
      branchName: `agent/ticket-${t.number}`,
      worktreePath: `/tmp/wt/ticket-${t.number}`,
    })),
    ensureSharedWorktree: jest.fn(async () => undefined),
    checkoutTicketBranch: jest.fn(async (path: string, t: GitTicketRef) => ({
      branchName: `agent/ticket-${t.number}`,
      worktreePath: path,
    })),
    releaseSharedWorktree: jest.fn(async () => undefined),
    removeSharedWorktree: jest.fn(async () => undefined),
    resetTicketBranchToBase: jest.fn(async () => undefined),
    hasNewCommits: jest.fn(async () => true),
    hasUncommittedChanges: jest.fn(async () => false),
    commitAll: jest.fn(async () => undefined),
    diff: jest.fn(async (t: GitTicketRef) => SAMPLE_DIFF(t.number)),
    merge: jest.fn(async () => ({ output: 'Merge made by the ort strategy.' })),
    removeWorktree: jest.fn(async () => undefined),
    resetWorktreeToBase: jest.fn(async () => undefined),
    checkBaseRepoClean: jest.fn(async () => ({ clean: true as const })),
    repoStatus: jest.fn(async () => ({ ready: true, reason: null, currentBranch: 'main' })),
  };
  return fake as unknown as jest.Mocked<GitOperations>;
}

/** A GitServiceFactory stand-in that returns `git` for every project. */
export function fakeGitFactory(git: GitOperations) {
  return {
    forProject: jest.fn(() => git),
    forget: jest.fn(),
    worktreesRoot: '/tmp/wt',
    worktreesDirFor: (slug: string) => `/tmp/wt/${slug}`,
  };
}
