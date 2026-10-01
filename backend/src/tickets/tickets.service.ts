import {
  EventAuthor,
  SocketEvents,
  TicketEventType,
  TicketStatus,
  TransitionActor,
  type DiffDto,
  type TicketDto,
  type TicketWithEventsDto,
} from '@agent-board/shared';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { RunRegistry } from '../common/run-registry.service';
import { WorkerSignal } from '../common/worker-signal.service';
import { EventsService } from '../events/events.service';
import { GitServiceFactory } from '../git/git-service.factory';
import { BaseRepoNotReadyError, MergeConflictError, type GitOperations } from '../git/git.types';
import { ProjectEntity } from '../projects/project.entity';
import type { CreateTicketDto, ListTicketsQueryDto, UpdateTicketDto } from './dto/ticket.dto';
import { TicketStateMachine } from './ticket-state-machine';
import { TicketEntity } from './ticket.entity';
import { ticketToDto } from './ticket.mapper';

export type InternalTicketPatch = Partial<
  Pick<TicketEntity, 'sessionId' | 'branchName' | 'worktreePath' | 'agentSummary' | 'lastError' | 'lockedAt'>
>;
const INTERNAL_PATCH_KEYS = [
  'sessionId',
  'branchName',
  'worktreePath',
  'agentSummary',
  'lastError',
  'lockedAt',
] as const;

export const RECOVERY_REASON =
  'Recovered after API restart; the previous run was interrupted. The ticket was requeued.';

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  constructor(
    @InjectRepository(TicketEntity) private readonly repo: Repository<TicketEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    private readonly dataSource: DataSource,
    private readonly stateMachine: TicketStateMachine,
    private readonly events: EventsService,
    private readonly emitter: EventEmitter2,
    private readonly workerSignal: WorkerSignal,
    private readonly runs: RunRegistry,
    private readonly gitFactory: GitServiceFactory,
  ) {}

  toDto(t: TicketEntity): TicketDto {
    return ticketToDto(t);
  }

  // ---------------------------------------------------------------- worker-facing

  /**
   * Atomically claims the next pending ticket (priority, position, createdAt) across all
   * projects, but only from `readyProjectIds`, moving it to in_progress with locked_at = now()
   * and attempt_count + 1. Safe under concurrent callers.
   */
  async claimNext(readyProjectIds: string[]): Promise<TicketEntity | null> {
    if (readyProjectIds.length === 0) return null;
    const claimed = await this.dataSource.transaction(async (m) => {
      const rows = (await m.query(
        `WITH claimed AS (
           UPDATE tickets
              SET status = 'in_progress', locked_at = now(), attempt_count = attempt_count + 1, updated_at = now()
            WHERE id = (
              SELECT id FROM tickets
               WHERE status = 'pending' AND locked_at IS NULL AND project_id = ANY($1::uuid[])
               ORDER BY priority, position, created_at
               FOR UPDATE SKIP LOCKED
               LIMIT 1)
           RETURNING id
         )
         SELECT id FROM claimed`,
        [readyProjectIds],
      )) as Array<{ id: string }>;
      const id = rows[0]?.id;
      if (!id) return null;
      const ticket = await m.findOneByOrFail(TicketEntity, { id });
      const event = await this.events.insert(
        {
          ticketId: id,
          type: TicketEventType.StatusChanged,
          author: EventAuthor.Agent,
          body: `Picked up by the worker (attempt ${ticket.attemptCount})`,
          meta: { from: TicketStatus.Pending, to: TicketStatus.InProgress, actor: TransitionActor.Worker },
        },
        m,
      );
      return { ticket, event };
    });
    if (!claimed) return null;
    this.stateMachine.afterCommit(claimed.ticket, claimed.event);
    return claimed.ticket;
  }

  async findById(id: string): Promise<TicketEntity> {
    const t = await this.repo.findOneBy({ id });
    if (!t) throw new NotFoundException(`Ticket ${id} not found`);
    return t;
  }

  /** Saves non-status fields and emits ticket.updated. */
  async patchInternal(id: string, patch: InternalTicketPatch): Promise<TicketEntity> {
    const clean: InternalTicketPatch = {};
    for (const k of INTERNAL_PATCH_KEYS) {
      if (k in patch) (clean as Record<string, unknown>)[k] = patch[k];
    }
    await this.findById(id);
    if (Object.keys(clean).length > 0) await this.repo.update({ id }, clean);
    const t = await this.findById(id);
    this.emitUpdated(t);
    return t;
  }

  /** Atomically adds to totalCostUsd and emits ticket.updated. */
  async addCost(id: string, usd: number): Promise<void> {
    if (!Number.isFinite(usd) || usd === 0) return;
    await this.dataSource.query(
      `UPDATE tickets SET total_cost_usd = total_cost_usd + $1, updated_at = now() WHERE id = $2`,
      [usd, id],
    );
    this.emitUpdated(await this.findById(id));
  }

  countPending(): Promise<number> {
    return this.repo.countBy({ status: TicketStatus.Pending });
  }

  /** Startup: every in_progress ticket -> pending (actor system). Returns how many were recovered. */
  async recoverInterrupted(): Promise<number> {
    const stuck = await this.repo.find({ where: { status: TicketStatus.InProgress }, select: { id: true } });
    let n = 0;
    for (const { id } of stuck) {
      try {
        await this.stateMachine.transition(id, TicketStatus.Pending, {
          actor: TransitionActor.System,
          reason: RECOVERY_REASON,
        });
        n++;
      } catch (e) {
        this.logger.error(`Could not recover ticket ${id}: ${errorMessage(e)}`);
      }
    }
    if (n > 0) this.logger.warn(`Recovered ${n} interrupted ticket(s) back to pending`);
    return n;
  }

  // ---------------------------------------------------------------- human-facing

  async create(input: CreateTicketDto): Promise<TicketEntity> {
    if (!input.projectId) throw new BadRequestException('projectId is required');
    const project = await this.projects.findOneBy({ id: input.projectId });
    if (!project) throw new NotFoundException(`Project ${input.projectId} not found`);
    const priority = input.priority ?? undefined;
    const ticket = await this.dataSource.transaction(async (m) => {
      const repo = m.getRepository(TicketEntity);
      const draft = repo.create({
        projectId: project.id,
        title: input.title,
        description: input.description,
        rules: input.rules ?? [],
        ...(priority ? { priority } : {}),
      });
      const rows = (await m.query(
        `SELECT COALESCE(MAX(position), 0) + 1 AS next FROM tickets WHERE project_id = $1 AND priority = $2`,
        [project.id, draft.priority ?? 'medium'],
      )) as Array<{ next: number | string }>;
      draft.position = Number(rows[0]?.next ?? 1);
      const saved = await repo.save(draft);
      return repo.findOneByOrFail({ id: saved.id });
    });
    await this.events.append({
      ticketId: ticket.id,
      type: TicketEventType.Created,
      author: EventAuthor.Human,
      body: `Ticket #${ticket.number} created`,
      meta: { priority: ticket.priority, projectId: project.id },
    });
    this.emitter.emit(SocketEvents.TicketCreated, ticketToDto(ticket));
    this.workerSignal.wake();
    return ticket;
  }

  /** Queue order: priority (urgent first), position, createdAt. `q` = ILIKE on title. */
  list(query: ListTicketsQueryDto = {}): Promise<TicketEntity[]> {
    const qb = this.repo.createQueryBuilder('t');
    if (query.projectId) qb.andWhere('t.projectId = :projectId', { projectId: query.projectId });
    if (query.status) qb.andWhere('t.status = :status', { status: query.status });
    if (query.priority) qb.andWhere('t.priority = :priority', { priority: query.priority });
    if (query.q) {
      const escaped = query.q.replace(/[\\%_]/g, (c) => `\\${c}`);
      qb.andWhere(`t.title ILIKE :q ESCAPE '\\'`, { q: `%${escaped}%` });
    }
    return qb.orderBy('t.priority', 'ASC').addOrderBy('t.position', 'ASC').addOrderBy('t.createdAt', 'ASC').getMany();
  }

  async get(id: string): Promise<TicketWithEventsDto> {
    const t = await this.findById(id);
    const events = await this.events.listForTicket(id);
    return { ...ticketToDto(t), events: events.map((e) => this.events.toDto(e)) };
  }

  /** Edit fields; 409 while in_progress. A priority change keeps the position. */
  async update(id: string, input: UpdateTicketDto): Promise<TicketEntity> {
    const ticket = await this.dataSource.transaction(async (m) => {
      const t = await m.findOne(TicketEntity, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!t) throw new NotFoundException(`Ticket ${id} not found`);
      if (t.status === TicketStatus.InProgress) {
        throw new ConflictException(`Ticket #${t.number} is in progress and cannot be edited right now`);
      }
      const fields = ['title', 'description', 'rules', 'priority', 'position'] as const;
      for (const f of fields) {
        if (input[f] !== undefined) (t as unknown as Record<string, unknown>)[f] = input[f];
      }
      await m.save(TicketEntity, t);
      return m.findOneByOrFail(TicketEntity, { id });
    });
    this.emitUpdated(ticket);
    return ticket;
  }

  /** needs_context -> pending with a human_answer event. */
  async answer(id: string, message: string): Promise<TicketEntity> {
    const t = await this.requireStatus(id, TicketStatus.NeedsContext, 'answer');
    await this.events.append({
      ticketId: t.id,
      type: TicketEventType.HumanAnswer,
      author: EventAuthor.Human,
      body: message,
    });
    return this.stateMachine.transition(id, TicketStatus.Pending, {
      actor: TransitionActor.Human,
      reason: 'Answered; ticket requeued',
    });
  }

  /** review -> pending with a review_rejected event (feedback required). */
  async reject(id: string, feedback: string): Promise<TicketEntity> {
    const text = feedback?.trim();
    if (!text) throw new BadRequestException('feedback is required');
    const t = await this.requireStatus(id, TicketStatus.Review, 'reject');
    await this.events.append({
      ticketId: t.id,
      type: TicketEventType.ReviewRejected,
      author: EventAuthor.Human,
      body: text,
    });
    return this.stateMachine.transition(id, TicketStatus.Pending, {
      actor: TransitionActor.Human,
      reason: 'Fix rejected; ticket requeued with feedback',
    });
  }

  /** failed -> pending. meta.previousError keeps the old lastError; the state machine clears it. */
  async retry(id: string, note?: string): Promise<TicketEntity> {
    const t = await this.requireStatus(id, TicketStatus.Failed, 'retry');
    const cleanNote = note?.trim() || undefined;
    if (cleanNote) {
      await this.events.append({
        ticketId: t.id,
        type: TicketEventType.HumanAnswer,
        author: EventAuthor.Human,
        body: cleanNote,
        meta: { kind: 'retry_note' },
      });
    }
    return this.stateMachine.transition(id, TicketStatus.Pending, {
      actor: TransitionActor.Human,
      reason: cleanNote ? 'Retry requested with a note' : 'Retry requested',
      note: cleanNote,
      meta: { previousError: t.lastError ?? null },
      patch: { lastError: null },
    });
  }

  /** Any status except done/cancelled -> cancelled. Aborts a running agent first, then removes the worktree. */
  async cancel(id: string): Promise<TicketEntity> {
    const t = await this.findById(id);
    if (t.status === TicketStatus.Done || t.status === TicketStatus.Cancelled) {
      throw new ConflictException(`Ticket #${t.number} is ${t.status} and cannot be cancelled`);
    }
    if (this.runs.isRunning(id)) await this.runs.abort(id);
    let cancelled = await this.stateMachine.transition(id, TicketStatus.Cancelled, {
      actor: TransitionActor.Human,
      reason: 'Cancelled by the board owner',
    });
    // The worker may have claimed it between our check and the transition.
    if (this.runs.isRunning(id)) await this.runs.abort(id);

    if (cancelled.worktreePath || cancelled.branchName) {
      try {
        await (await this.gitFor(cancelled)).removeWorktree(cancelled, { deleteBranch: true });
        cancelled = await this.patchInternal(id, { worktreePath: null });
      } catch (e) {
        await this.events.append({
          ticketId: id,
          type: TicketEventType.Error,
          author: EventAuthor.System,
          body: `Cancelled, but removing the worktree failed: ${errorMessage(e)}`,
          meta: { code: 'worktree_cleanup_failed' },
        });
      }
    }
    return cancelled;
  }

  /** review -> done: snapshot diff, merge (409 on conflict, stays in review), remove worktree. */
  async approve(id: string): Promise<TicketEntity> {
    const t = await this.requireStatus(id, TicketStatus.Review, 'approve');
    const git = await this.gitFor(t);
    const diff = await git.diff(t);

    let mergeOutput: string;
    try {
      ({ output: mergeOutput } = await git.merge(t));
    } catch (e) {
      if (e instanceof MergeConflictError || e instanceof BaseRepoNotReadyError) {
        await this.events.append({
          ticketId: id,
          type: TicketEventType.Error,
          author: EventAuthor.System,
          body: e.message,
          meta:
            e instanceof MergeConflictError
              ? { code: 'merge_conflict', files: e.files }
              : { code: 'base_repo_not_ready' },
        });
        throw new ConflictException(e.message);
      }
      throw e;
    }

    try {
      await git.removeWorktree(t, { deleteBranch: true });
    } catch (e) {
      await this.events.append({
        ticketId: id,
        type: TicketEventType.Error,
        author: EventAuthor.System,
        body: `Merged, but removing the worktree failed: ${errorMessage(e)}`,
        meta: { code: 'worktree_cleanup_failed' },
      });
    }

    await this.events.append({
      ticketId: id,
      type: TicketEventType.ReviewApproved,
      author: EventAuthor.Human,
      body: `Approved and merged ${diff.branchName} into ${diff.baseBranch}`,
      meta: { diff, mergeOutput },
    });
    return this.stateMachine.transition(id, TicketStatus.Done, {
      actor: TransitionActor.Human,
      reason: 'Approved and merged',
      patch: { worktreePath: null },
    });
  }

  /** Clears the agent session (and optionally resets the worktree to base). Rejected while in_progress. */
  async startFresh(id: string, resetWorktree = false): Promise<TicketEntity> {
    const t = await this.findById(id);
    if (t.status === TicketStatus.InProgress) {
      throw new ConflictException(`Ticket #${t.number} is in progress; wait for the run to finish or cancel it`);
    }
    let didReset = false;
    if (resetWorktree && t.worktreePath) {
      await (await this.gitFor(t)).resetWorktreeToBase(t);
      didReset = true;
    }
    const updated = await this.patchInternal(id, { sessionId: null });
    await this.events.append({
      ticketId: id,
      type: TicketEventType.AgentLog,
      author: EventAuthor.Human,
      body: didReset
        ? 'Started fresh: the agent session was cleared and the worktree was reset to the base branch'
        : 'Started fresh: the agent session was cleared',
      meta: { kind: 'note', startFresh: true, resetWorktree: didReset },
    });
    return updated;
  }

  /** review: live diff; done: snapshot from the review_approved event; otherwise 409. */
  async diff(id: string): Promise<DiffDto> {
    const t = await this.findById(id);
    if (t.status === TicketStatus.Review) return (await this.gitFor(t)).diff(t);
    if (t.status === TicketStatus.Done) {
      const approved = await this.events.findLatest(id, TicketEventType.ReviewApproved);
      const snapshot = approved?.meta?.diff as DiffDto | undefined;
      if (!snapshot) throw new ConflictException(`No diff snapshot was stored for ticket #${t.number}`);
      return snapshot;
    }
    throw new ConflictException(`A diff is only available in review or done (ticket #${t.number} is ${t.status})`);
  }

  // ---------------------------------------------------------------- helpers

  /** The GitService of the ticket's project (409 for a legacy ticket with no project). */
  async gitFor(t: TicketEntity): Promise<GitOperations> {
    const project = t.projectId ? await this.projects.findOneBy({ id: t.projectId }) : null;
    if (!project) throw new ConflictException(`Ticket #${t.number} does not belong to a project`);
    return this.gitFactory.forProject(project);
  }

  private async requireStatus(id: string, status: TicketStatus, action: string): Promise<TicketEntity> {
    const t = await this.findById(id);
    if (t.status !== status) {
      throw new ConflictException(`Cannot ${action} ticket #${t.number}: it is ${t.status}, not ${status}`);
    }
    return t;
  }

  private emitUpdated(t: TicketEntity): void {
    this.emitter.emit(SocketEvents.TicketUpdated, ticketToDto(t));
  }
}
