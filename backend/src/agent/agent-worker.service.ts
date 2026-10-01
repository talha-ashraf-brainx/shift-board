import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown, Optional } from '@nestjs/common';
import {
  EventAuthor,
  TicketEventType,
  TicketStatus,
  TransitionActor,
  ticketSubject,
  type AgentLogMeta,
} from '@agent-board/shared';
import { RunRegistry, type RunHandle } from '../common/run-registry.service';
import { WorkerSignal } from '../common/worker-signal.service';
import { AppConfig } from '../config/app-config';
import { EventsService } from '../events/events.service';
import { GitServiceFactory } from '../git/git-service.factory';
import type { GitOperations } from '../git/git.types';
import { ProjectsService } from '../projects/projects.service';
import { WorktreesService } from '../projects/worktrees.service';
import { SettingsService } from '../settings/settings.service';
import { AgentStatusService } from '../status/agent-status.service';
import type { TicketEntity } from '../tickets/ticket.entity';
import { TicketStateMachine } from '../tickets/ticket-state-machine';
import { isLegacyWorktree, TicketsService } from '../tickets/tickets.service';
import { AgentRunner, type AgentRunOutcome, type RunResultInfo } from './agent-runner';
import { AgentProcessTracker } from './process-tracker';
import { formatSummaryBody } from './board-tools';
import { buildSystemAppend, FINISH_REMINDER } from './prompt-builder';
import { determineResumePrompt } from './resume-context';
import { createRunState, type RunState } from './run-state';

export const ERROR_BACKOFF_MS = 1000;
export const NO_CHANGES_ERROR = 'The agent reported a fix but made no changes.';
export const NO_FINISH_ERROR =
  'The agent ended its run without calling submit_fix, request_context or give_up, even after a reminder.';
export const NO_SESSION_NO_FINISH_ERROR =
  'The agent ended its run without calling submit_fix, request_context or give_up (no session to resume for a reminder).';

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}

/**
 * The agent worker: claims pending tickets one at a time, runs the agent in the
 * ticket's worktree, and moves the ticket on based on what the board tools recorded.
 */
@Injectable()
export class AgentWorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(AgentWorkerService.name);
  private stopping = false;
  private loopPromise: Promise<void> | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly tickets: TicketsService,
    private readonly stateMachine: TicketStateMachine,
    private readonly events: EventsService,
    private readonly settings: SettingsService,
    private readonly gitFactory: GitServiceFactory,
    private readonly projects: ProjectsService,
    private readonly statusService: AgentStatusService,
    private readonly registry: RunRegistry,
    private readonly signal: WorkerSignal,
    private readonly runner: AgentRunner,
    private readonly worktrees: WorktreesService,
    @Optional() private readonly processes?: AgentProcessTracker,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Stop agents orphaned by a hard crash before their tickets are requeued.
    try {
      const killed = (await this.processes?.killOrphans()) ?? 0;
      if (killed > 0) this.logger.warn(`Stopped ${killed} orphaned agent process(es) from a previous run`);
    } catch (err) {
      this.logger.error(`Could not stop orphaned agent processes: ${errorMessage(err)}`);
    }

    try {
      const recovered = await this.tickets.recoverInterrupted();
      if (recovered > 0) this.logger.log(`Recovered ${recovered} interrupted ticket(s) back to pending`);
    } catch (err) {
      this.logger.error(`Crash recovery failed: ${errorMessage(err)}`);
    }

    // Initial readiness so /agent/status reports blocked projects right away.
    try {
      await this.projects.refreshReadiness();
    } catch (err) {
      this.logger.warn(`Could not check the project repos: ${errorMessage(err)}`);
    }

    this.loopPromise = this.loop();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    this.signal.wake();
    // Leave statuses alone: crash recovery requeues an interrupted ticket on the next boot.
    await this.registry.abortAll();
    if (this.loopPromise) {
      await Promise.race([this.loopPromise, new Promise((r) => setTimeout(r, 5000).unref())]);
    }
  }

  private async loop(): Promise<void> {
    while (!this.stopping) {
      try {
        const { workerEnabled } = await this.settings.get();
        // Checked every iteration (cheap): a project whose main checkout is not clean on its
        // base branch is skipped; it never pauses the whole worker.
        const { readyIds } = await this.projects.refreshReadiness();
        if (!workerEnabled) {
          await this.signal.waitForWake(this.config.pollIntervalMs);
          continue;
        }
        const ticket = await this.tickets.claimNext(readyIds);
        if (!ticket) {
          await this.signal.waitForWake(this.config.pollIntervalMs);
          continue;
        }
        await this.processTicket(ticket);
      } catch (err) {
        this.logger.error(`Worker loop error: ${errorMessage(err)}`, err instanceof Error ? err.stack : undefined);
        await new Promise((r) => setTimeout(r, ERROR_BACKOFF_MS).unref());
      }
    }
  }

  /** Runs one claimed (in_progress) ticket to its next status. Never throws for agent/run errors. */
  async processTicket(claimed: TicketEntity): Promise<void> {
    const handle = this.registry.register(claimed.id, claimed.number);
    await this.safeBroadcast();
    try {
      await this.runTicket(claimed, handle);
    } catch (err) {
      if (handle.signal.aborted) {
        // Cancelled (the cancel endpoint transitions) or shutting down (crash recovery): leave it.
        this.logger.log(`Run for ticket #${claimed.number} aborted: ${errorMessage(err)}`);
      } else {
        await this.failAfterError(claimed, err);
      }
    } finally {
      handle.finish();
      await this.releaseLock(claimed.id);
      await this.safeBroadcast();
    }
  }

  private async runTicket(claimed: TicketEntity, handle: RunHandle): Promise<void> {
    let ticket = claimed;
    if (!ticket.projectId) throw new Error(`Ticket #${ticket.number} does not belong to a project`);
    const project = await this.projects.findById(ticket.projectId);
    const git = this.gitFactory.forProject(project);
    const worktree = await this.prepareWorktree(git, ticket);
    if (ticket.branchName !== worktree.branchName || ticket.worktreePath !== worktree.worktreePath) {
      ticket = await this.tickets.patchInternal(ticket.id, {
        branchName: worktree.branchName,
        worktreePath: worktree.worktreePath,
      });
    }

    const events = await this.events.listForTicket(ticket.id);
    const { mode, prompt } = determineResumePrompt({ ...ticket, projectName: project.name }, events);
    const { globalRules } = await this.settings.get();
    const systemAppend = buildSystemAppend({
      branchName: worktree.branchName,
      baseBranch: project.baseBranch,
      globalRules,
      project: { name: project.name, repoPath: project.repoPath, rules: project.rules },
    });
    this.logger.log(`Running ticket #${ticket.number} in project "${project.name}" (${mode} prompt)`);

    const runState = createRunState();
    const session = {
      id: ticket.sessionId ?? undefined,
      costBaseline: ticket.sessionId ? sessionCostBaseline(events, ticket.sessionId) : 0,
    };

    const runOnce = (runPrompt: string): Promise<AgentRunOutcome> =>
      this.runner.run({
        ticket: { id: ticket.id, number: ticket.number, worktreePath: worktree.worktreePath, sessionId: session.id ?? null },
        prompt: runPrompt,
        systemAppend,
        extraAllowedTools: project.extraAllowedTools ?? [],
        runState,
        handle,
        onSessionId: (id) => this.onSessionId(ticket, session, id),
        onLog: (line, meta) => this.appendLog(ticket.id, line, { ...meta }),
        onResult: (result) => this.recordResult(ticket.id, session, result),
      });

    let result = await runOnce(prompt);
    if (result.aborted) return;

    if (!runState.outcome && !result.resultError && session.id) {
      this.logger.log(`Ticket #${ticket.number}: no finishing call, resuming once with a reminder`);
      result = await runOnce(FINISH_REMINDER);
      if (result.aborted) return;
    }

    if (handle.signal.aborted) return;
    await this.resolveOutcome(git, ticket, worktree.worktreePath, runState, result, !session.id);
  }

  /** The claim assigned the ticket a shared worktree (legacy tickets keep their own). */
  private async prepareWorktree(git: GitOperations, ticket: TicketEntity) {
    if (isLegacyWorktree(ticket)) return git.createWorktree(ticket);
    if (!ticket.worktreeId) throw new Error(`Ticket #${ticket.number} has no worktree; the project has no active worktree`);
    const { path } = await this.worktrees.findById(ticket.worktreeId);
    await git.ensureSharedWorktree(path);
    return git.checkoutTicketBranch(path, ticket);
  }

  private async resolveOutcome(
    git: GitOperations,
    ticket: TicketEntity,
    worktreePath: string,
    runState: RunState,
    result: AgentRunOutcome,
    noSession: boolean,
  ): Promise<void> {
    switch (runState.outcome) {
      case 'review': {
        if (await git.hasUncommittedChanges(worktreePath)) {
          await git.commitAll(worktreePath, `ticket ${ticketSubject(ticket)}`);
        }
        if (!(await git.hasNewCommits(ticket))) {
          await this.fail(ticket.id, NO_CHANGES_ERROR);
          return;
        }
        await this.stateMachine.transition(ticket.id, TicketStatus.Review, {
          actor: TransitionActor.Worker,
          reason: 'Agent submitted a fix for review',
          patch: { agentSummary: formatSummaryBody(runState.summary ?? '', runState.testing ?? '') },
        });
        return;
      }
      case 'needs_context':
        await this.stateMachine.transition(ticket.id, TicketStatus.NeedsContext, {
          actor: TransitionActor.Worker,
          reason: 'Agent needs more context',
        });
        return;
      case 'failed':
        await this.fail(ticket.id, runState.reason?.trim() || 'The agent gave up without a reason.');
        return;
      default:
        await this.fail(
          ticket.id,
          result.resultError ?? (noSession ? NO_SESSION_NO_FINISH_ERROR : NO_FINISH_ERROR),
        );
    }
  }

  private async fail(ticketId: string, reason: string): Promise<void> {
    await this.stateMachine.transition(ticketId, TicketStatus.Failed, {
      actor: TransitionActor.Worker,
      reason,
      patch: { lastError: reason },
    });
  }

  private async failAfterError(ticket: TicketEntity, err: unknown): Promise<void> {
    const message = errorMessage(err);
    this.logger.error(`Run for ticket #${ticket.number} failed: ${message}`, err instanceof Error ? err.stack : undefined);
    try {
      await this.events.append({ ticketId: ticket.id, type: TicketEventType.Error, author: EventAuthor.System, body: message });
    } catch (inner) {
      this.logger.warn(`Could not record the error event for ticket #${ticket.number}: ${errorMessage(inner)}`);
    }
    try {
      await this.fail(ticket.id, message);
    } catch (inner) {
      // e.g. the ticket was cancelled meanwhile.
      this.logger.warn(`Could not move ticket #${ticket.number} to failed: ${errorMessage(inner)}`);
    }
  }

  private async onSessionId(ticket: TicketEntity, session: { id?: string }, id: string): Promise<void> {
    if (!session.id) {
      session.id = id;
      await this.tickets.patchInternal(ticket.id, { sessionId: id });
    } else if (session.id !== id) {
      this.logger.log(`Ticket #${ticket.number}: SDK reported session ${id}; keeping ${session.id}`);
    }
  }

  private async appendLog(ticketId: string, line: string, meta: AgentLogMeta & Record<string, unknown>): Promise<void> {
    try {
      await this.events.append({ ticketId, type: TicketEventType.AgentLog, author: EventAuthor.Agent, body: line, meta: { ...meta } });
    } catch (err) {
      this.logger.warn(`Could not write agent log: ${errorMessage(err)}`);
    }
  }

  /**
   * `total_cost_usd` is cumulative per session, and a resumed session can start from the
   * total its transcript saved. So only the increase over what was already counted for this
   * session is added. The running session total is stored in the "run finished" log event.
   */
  private async recordResult(
    ticketId: string,
    session: { id?: string; costBaseline: number },
    result: RunResultInfo,
  ): Promise<void> {
    const total = Number.isFinite(result.costUsd) ? result.costUsd : 0;
    const delta = total >= session.costBaseline ? total - session.costBaseline : total;
    session.costBaseline = total;
    if (delta > 0) await this.tickets.addCost(ticketId, delta);

    const turns = result.numTurns !== undefined ? `, ${result.numTurns} turn${result.numTurns === 1 ? '' : 's'}` : '';
    await this.appendLog(ticketId, `Run finished (${result.subtype}${turns}, $${delta.toFixed(4)})`, {
      kind: 'text',
      sessionId: session.id,
      sessionCostUsd: total,
    });
  }

  private async releaseLock(ticketId: string): Promise<void> {
    try {
      const current = await this.tickets.findById(ticketId);
      if (current.status === TicketStatus.InProgress && current.lockedAt) {
        await this.tickets.patchInternal(ticketId, { lockedAt: null });
      }
    } catch {
      // The ticket may no longer exist; nothing to release.
    }
  }

  private async safeBroadcast(): Promise<void> {
    try {
      await this.statusService.broadcast();
    } catch (err) {
      this.logger.warn(`Could not broadcast agent status: ${errorMessage(err)}`);
    }
  }
}

/** The last recorded cumulative cost of `sessionId`, from earlier "run finished" log events. */
export function sessionCostBaseline(
  events: { type: string; meta?: Record<string, unknown> | null }[],
  sessionId: string,
): number {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type !== TicketEventType.AgentLog || e.meta?.sessionId !== sessionId) continue;
    const cost = e.meta?.sessionCostUsd;
    if (typeof cost === 'number' && Number.isFinite(cost)) return cost;
  }
  return 0;
}
