import type { EventAuthor, TicketEventType, TicketPriority, TicketStatus } from './enums';

/** Dates travel as ISO-8601 strings. */
export interface TicketDto {
  id: string;
  number: number;
  /** null only for legacy tickets created before projects existed and never assigned. */
  projectId: string | null;
  /** Empty string when the ticket is untitled; display it with `ticketTitle`. */
  title: string;
  description: string;
  /** Ticket-specific rules, one entry each; empty when only global and project rules apply. */
  rules: string[];
  priority: TicketPriority;
  status: TicketStatus;
  sessionId: string | null;
  branchName: string | null;
  worktreePath: string | null;
  /** The project worktree the ticket runs in; set when the worker first picks it up. */
  worktreeId: string | null;
  /** Spending limit for this ticket in USD; null = the project's limit. */
  maxBudgetUsd: number | null;
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

/** One choice the agent offers for a question. */
export interface QuestionOption {
  label: string;
  description?: string;
}

/** A structured request_context question. No options means a free-text answer. */
export interface AgentQuestion {
  question: string;
  /** Short chip label (at most 12 characters). */
  header?: string;
  options: QuestionOption[];
  multiSelect?: boolean;
}

export interface AgentQuestionMeta {
  /** Structured questions; events recorded before structured questions hold plain strings. */
  questions: (AgentQuestion | string)[];
  reason: string;
}

/** The human's answer to one question: the chosen option labels and/or a typed answer. */
export interface QuestionAnswer {
  question: string;
  selected: string[];
  other?: string | null;
}

export interface HumanAnswerMeta {
  answers: QuestionAnswer[];
  /** The optional extra note sent with the answers. */
  note?: string;
}

export interface AgentSummaryMeta {
  summary: string;
  testing: string;
}

export interface AgentLogMeta {
  /**
   * 'tool' = tool call summary, 'note' = add_note, 'text' = assistant prose excerpt,
   * 'setup' / 'checks' = result of the project's setup or check command (CommandLogMeta).
   */
  kind: 'tool' | 'note' | 'text' | 'setup' | 'checks';
  tool?: string;
  /** Number of log lines coalesced into this event. */
  count?: number;
}

/** meta of an agent_log event with kind 'setup' or 'checks'. */
export interface CommandLogMeta extends AgentLogMeta {
  kind: 'setup' | 'checks';
  command: string;
  passed: boolean;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  /** The end of stdout/stderr. */
  output: string;
  /** Checks only: 1 for the first run after submit_fix, then 2, 3… after each fix attempt. */
  attempt?: number;
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
  /** Optional; omitted or blank means untitled. */
  title?: string;
  description: string;
  rules?: string[];
  priority?: TicketPriority;
  maxBudgetUsd?: number | null;
}

export interface UpdateTicketInput {
  title?: string;
  description?: string;
  rules?: string[];
  priority?: TicketPriority;
  position?: number;
  maxBudgetUsd?: number | null;
}

export interface ListTicketsQuery {
  projectId?: string;
  status?: TicketStatus;
  priority?: TicketPriority;
  q?: string;
}

export interface AnswerInput {
  /** Free-text answer, or the extra note when `answers` is given. Required without `answers`. */
  message?: string;
  /** One answer per question, in question order. */
  answers?: QuestionAnswer[];
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
  /** http(s) URL (<= 2000 chars) for Slack/Discord-style notifications; null or "" clears it. */
  notifyWebhookUrl?: string | null;
}

// ---- Responses ----

export interface SettingsDto {
  /** Applied to every ticket in every project. */
  globalRules: string;
  workerEnabled: boolean;
  /** Read-only, from env: root folder under which each project's worktrees live. */
  worktreesRoot: string;
  /** Incoming-webhook URL POSTed when a ticket needs the human; null = off. */
  notifyWebhookUrl: string | null;
}

export interface NotifyTestResultDto {
  ok: boolean;
  /** Error message when ok is false. */
  error?: string;
}

export type AgentState = 'idle' | 'running' | 'paused';

export interface AgentStatusDto {
  state: AgentState;
  /** The first running ticket (kept for older clients); see `running` for all of them. */
  ticketId: string | null;
  ticketNumber: number | null;
  /** Every ticket an agent is working on right now (AGENT_CONCURRENCY at most). */
  running: { ticketId: string; ticketNumber: number }[];
  queueLength: number;
  /** Projects the worker is currently skipping (repo not on its base branch, dirty, or missing). */
  blockedProjects: { projectId: string; name: string; reason: string }[];
  /** Pending tickets held back because their worktree is busy with another ticket. */
  waiting: WaitingTicketDto[];
}

export interface WaitingTicketDto {
  ticketId: string;
  ticketNumber: number;
  worktreeName: string;
  /** The ticket currently holding the worktree. */
  heldByNumber: number;
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
  /** Runs in the worktree before every agent run, e.g. `pnpm install`. */
  setupCommand: string | null;
  /** Must pass before a fix reaches Review, e.g. `pnpm lint && pnpm test`. */
  checkCommand: string | null;
  /** Spending limit per ticket in USD; null = the server default (AGENT_MAX_BUDGET_USD), if any. */
  maxBudgetUsd: number | null;
  /** <worktreesRoot>/<slug>; read-only. */
  worktreesDir: string;
  worktrees: WorktreeDto[];
  /** Where new tickets run. */
  activeWorktreeId: string | null;
  repoStatus: RepoStatusDto;
  /** Tickets per status (only statuses with at least one ticket are present). */
  ticketCounts: Partial<Record<TicketStatus, number>>;
  createdAt: string;
  updatedAt: string;
}

/**
 * A shared git worktree of a project. Tickets run in it one at a time, each on its own
 * agent/ticket-<n> branch; it stays held while that ticket is in progress, needs context or is in review.
 */
export interface WorktreeDto {
  id: string;
  name: string;
  path: string;
  active: boolean;
  heldBy: { ticketId: string; number: number; status: TicketStatus } | null;
  createdAt: string;
}

export interface CreateWorktreeInput {
  name: string;
}

export interface CreateProjectInput {
  name: string;
  repoPath: string;
  baseBranch: string;
  rules?: string | null;
  extraAllowedTools?: string[];
  setupCommand?: string | null;
  checkCommand?: string | null;
  maxBudgetUsd?: number | null;
}

export interface UpdateProjectInput {
  name?: string;
  baseBranch?: string;
  rules?: string | null;
  extraAllowedTools?: string[];
  setupCommand?: string | null;
  checkCommand?: string | null;
  maxBudgetUsd?: number | null;
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

/**
 * POST /api/attachments (multipart, field `file`) — an uploaded image. Reference it from
 * markdown as `![filename](url)`; `url` is `/api/attachments/<id>`.
 */
export interface AttachmentDto {
  id: string;
  url: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
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
