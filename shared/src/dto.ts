import type { EventAuthor, TicketEventType, TicketPriority, TicketStatus } from './enums';

/** Dates travel as ISO-8601 strings. */
export interface TicketDto {
  id: string;
  number: number;
  /** null only for legacy tickets created before projects existed and never assigned. */
  projectId: string | null;
  title: string;
  description: string;
  /** Ticket-specific rules, one entry each; empty when only global and project rules apply. */
  rules: string[];
  priority: TicketPriority;
  status: TicketStatus;
  sessionId: string | null;
  branchName: string | null;
  worktreePath: string | null;
  agentSummary: string | null;
  attemptCount: number;
  lastError: string | null;
  totalCostUsd: number;
  lockedAt: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
}

// ---- Event meta shapes (TicketEventDto.meta) ----

export interface StatusChangedMeta {
  from: TicketStatus;
  to: TicketStatus;
  actor: 'worker' | 'human' | 'system';
  /** Optional free-text note, e.g. the retry note. */
  note?: string;
}

export interface AgentQuestionMeta {
  questions: string[];
  reason: string;
}

export interface AgentSummaryMeta {
  summary: string;
  testing: string;
}

export interface AgentLogMeta {
  /** 'tool' = tool call summary, 'note' = add_note, 'text' = assistant prose excerpt */
  kind: 'tool' | 'note' | 'text';
  tool?: string;
  /** Number of log lines coalesced into this event. */
  count?: number;
}

export interface ReviewApprovedMeta {
  /** Snapshot of the diff at approval time; served for done tickets. */
  diff: DiffDto;
  mergeOutput?: string;
}

export interface ErrorMeta {
  code?: string;
  files?: string[];
}

export interface TicketEventDto {
  id: string;
  ticketId: string;
  type: TicketEventType;
  author: EventAuthor;
  body: string;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

export interface TicketWithEventsDto extends TicketDto {
  /** Oldest first. */
  events: TicketEventDto[];
}

// ---- Requests ----

export interface CreateTicketInput {
  projectId: string;
  title: string;
  description: string;
  rules?: string[];
  priority?: TicketPriority;
}

export interface UpdateTicketInput {
  title?: string;
  description?: string;
  rules?: string[];
  priority?: TicketPriority;
  position?: number;
}

export interface ListTicketsQuery {
  projectId?: string;
  status?: TicketStatus;
  priority?: TicketPriority;
  q?: string;
}

export interface AnswerInput {
  message: string;
}

export interface RejectInput {
  feedback: string;
}

export interface RetryInput {
  note?: string;
}

export interface UpdateSettingsInput {
  globalRules?: string;
  workerEnabled?: boolean;
}

// ---- Responses ----

export interface SettingsDto {
  /** Applied to every ticket in every project. */
  globalRules: string;
  workerEnabled: boolean;
  /** Read-only, from env: root folder under which each project's worktrees live. */
  worktreesRoot: string;
}

export type AgentState = 'idle' | 'running' | 'paused';

export interface AgentStatusDto {
  state: AgentState;
  ticketId: string | null;
  ticketNumber: number | null;
  queueLength: number;
  /** Projects the worker is currently skipping (repo not on its base branch, dirty, or missing). */
  blockedProjects: { projectId: string; name: string; reason: string }[];
}

export interface DiffFileDto {
  path: string;
  additions: number;
  deletions: number;
  binary: boolean;
}

export interface DiffDto {
  baseBranch: string;
  branchName: string;
  files: DiffFileDto[];
  /** Unified diff text (`git diff base...branch`). */
  patch: string;
}

// ---- Projects ----

export interface RepoStatusDto {
  /** true when the main checkout is on baseBranch with a clean working tree. */
  ready: boolean;
  /** Human-readable reason when not ready. */
  reason: string | null;
  currentBranch: string | null;
}

export interface ProjectDto {
  id: string;
  name: string;
  /** Absolute path of the repo's main checkout. Immutable after creation. */
  repoPath: string;
  baseBranch: string;
  /** Project rules for the agent; sit between global rules and ticket rules. */
  rules: string | null;
  /** Extra allowed tools for this project, e.g. ["Bash(npm test:*)"]. Added to AGENT_EXTRA_ALLOWED_TOOLS. */
  extraAllowedTools: string[];
  /** <worktreesRoot>/<slug>; read-only. */
  worktreesDir: string;
  repoStatus: RepoStatusDto;
  /** Tickets per status (only statuses with at least one ticket are present). */
  ticketCounts: Partial<Record<TicketStatus, number>>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  name: string;
  repoPath: string;
  baseBranch: string;
  rules?: string | null;
  extraAllowedTools?: string[];
}

export interface UpdateProjectInput {
  name?: string;
  baseBranch?: string;
  rules?: string | null;
  extraAllowedTools?: string[];
}

/** GET /api/projects/inspect?path=… — validate a folder before adding it as a project. */
export interface RepoInspectDto {
  path: string;
  isGitRepo: boolean;
  /** Set when the path is inside a repo but not its root, or not a repo at all. */
  error: string | null;
  /** Repo root (git rev-parse --show-toplevel); use this as repoPath. */
  repoRoot: string | null;
  branches: string[];
  currentBranch: string | null;
  /** Suggested project name (folder name). */
  suggestedName: string;
  /** Id of an existing project with this repoPath, if any. */
  existingProjectId: string | null;
}

/** GET /api/fs/browse?path=…&showHidden=… — directories only. Defaults to the home folder. */
export interface BrowseEntryDto {
  name: string;
  path: string;
  isGitRepo: boolean;
}

export interface BrowseDto {
  path: string;
  /** null at filesystem root. */
  parent: string | null;
  home: string;
  isGitRepo: boolean;
  entries: BrowseEntryDto[];
}

export interface ApiError {
  statusCode: number;
  message: string;
}
