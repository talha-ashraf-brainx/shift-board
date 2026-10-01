import type { DiffDto } from '@agent-board/shared';

/** The ticket fields GitService needs. A Ticket entity satisfies this. */
export interface GitTicketRef {
  number: number;
  title: string;
  /**
   * The ticket's stored worktree path, when set. Used instead of the computed
   * <worktreesDir>/ticket-<n> so worktrees created under an older layout keep working.
   */
  worktreePath?: string | null;
}

/** Where a GitService works: one project's repo, base branch and worktrees folder. */
export interface GitRepoConfig {
  targetRepoPath: string;
  baseBranch: string;
  /** <WORKTREES_DIR>/<slug> for a project. */
  worktreesDir: string;
  /** Leftover directories are only deleted inside this folder (default: worktreesDir). */
  cleanupRoot?: string;
}

export interface RepoStatus {
  ready: boolean;
  reason: string | null;
  currentBranch: string | null;
}

export interface WorktreeInfo {
  branchName: string;
  worktreePath: string;
}

export type RepoCleanCheck = { clean: true } | { clean: false; reason: string };

/** Contract implemented by GitService (git/git.service.ts). */
export interface GitOperations {
  branchNameFor(ticketNumber: number): string; // agent/ticket-<n>
  worktreePathFor(ticketNumber: number): string; // <WORKTREES_DIR>/ticket-<n>
  /** Legacy layout: a worktree per ticket. New tickets use the project's shared worktrees below. */
  createWorktree(ticket: GitTicketRef): Promise<WorktreeInfo>;
  /** Adds the shared worktree at `path` (detached at the base branch) unless it already exists. */
  ensureSharedWorktree(path: string): Promise<void>;
  /**
   * Checks out the ticket's branch in the shared worktree, creating it from the base branch when
   * new. Leftover uncommitted work is committed onto the agent branch it belongs to (or dropped
   * when the worktree is not on an agent branch) first.
   */
  checkoutTicketBranch(path: string, ticket: GitTicketRef): Promise<WorktreeInfo>;
  /** Detaches the shared worktree back to the base branch when it holds the ticket's branch. */
  releaseSharedWorktree(path: string, ticket: GitTicketRef, opts: { deleteBranch: boolean }): Promise<void>;
  /** Removes a shared worktree from git and disk. */
  removeSharedWorktree(path: string): Promise<void>;
  /** "Start fresh" for a ticket in a shared worktree: its branch goes back to the base branch. */
  resetTicketBranchToBase(path: string, ticket: GitTicketRef): Promise<void>;
  hasNewCommits(ticket: GitTicketRef): Promise<boolean>;
  hasUncommittedChanges(worktreePath: string): Promise<boolean>;
  commitAll(worktreePath: string, message: string): Promise<void>;
  diff(ticket: GitTicketRef): Promise<DiffDto>;
  /** Throws MergeConflictError (merge aborted) or BaseRepoNotReadyError. */
  merge(ticket: GitTicketRef): Promise<{ output: string }>;
  removeWorktree(ticket: GitTicketRef, opts: { deleteBranch: boolean }): Promise<void>;
  /** Hard-resets the ticket's worktree branch to BASE_BRANCH (used by "Start fresh"). */
  resetWorktreeToBase(ticket: GitTicketRef): Promise<void>;
  checkBaseRepoClean(): Promise<RepoCleanCheck>;
  /** checkBaseRepoClean plus the current branch, in the RepoStatusDto shape. */
  repoStatus(): Promise<RepoStatus>;
}

export class GitError extends Error {
  constructor(
    message: string,
    readonly args: readonly string[],
    readonly exitCode: number | null,
    readonly stderr: string,
  ) {
    super(message);
    this.name = 'GitError';
  }
}

export class MergeConflictError extends Error {
  constructor(
    readonly branchName: string,
    readonly files: string[],
  ) {
    super(
      `Merging ${branchName} hit conflicts${files.length ? ` in ${files.join(', ')}` : ''}. ` +
        'The merge was aborted; resolve the conflict (or reject the ticket) and try again.',
    );
    this.name = 'MergeConflictError';
  }
}

/** The main checkout is not on BASE_BRANCH or has uncommitted changes. */
export class BaseRepoNotReadyError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'BaseRepoNotReadyError';
  }
}
