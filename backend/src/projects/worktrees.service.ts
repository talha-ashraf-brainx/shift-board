import { TicketStatus, type WaitingTicketDto, type WorktreeDto } from '@agent-board/shared';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { join } from 'node:path';
import { In, type Repository } from 'typeorm';
import { GitServiceFactory } from '../git/git-service.factory';
import { TicketEntity } from '../tickets/ticket.entity';
import { ProjectEntity } from './project.entity';
import { WorktreeEntity } from './worktree.entity';

/** A ticket in one of these statuses holds its worktree; nobody else runs there until it leaves them. */
export const HOLDING_STATUSES = [TicketStatus.InProgress, TicketStatus.NeedsContext, TicketStatus.Review] as const;

export const DEFAULT_WORKTREE_NAME = 'main';

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function worktreeSlug(name: string): string {
  const s = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/g, '');
  return s || 'worktree';
}

@Injectable()
export class WorktreesService {
  private readonly logger = new Logger(WorktreesService.name);

  constructor(
    @InjectRepository(WorktreeEntity) private readonly repo: Repository<WorktreeEntity>,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(TicketEntity) private readonly tickets: Repository<TicketEntity>,
    private readonly gitFactory: GitServiceFactory,
  ) {}

  async findById(id: string): Promise<WorktreeEntity> {
    const w = await this.repo.findOneBy({ id });
    if (!w) throw new NotFoundException(`Worktree ${id} not found`);
    return w;
  }

  listFor(projectId: string): Promise<WorktreeEntity[]> {
    return this.repo.find({ where: { projectId }, order: { createdAt: 'ASC' } });
  }

  async toDtos(project: ProjectEntity): Promise<WorktreeDto[]> {
    const worktrees = await this.listFor(project.id);
    if (worktrees.length === 0) return [];
    const holders = await this.tickets.find({
      where: { worktreeId: In(worktrees.map((w) => w.id)), status: In([...HOLDING_STATUSES]) },
      select: { id: true, number: true, status: true, worktreeId: true },
    });
    return worktrees.map((w) => {
      const h = holders.find((t) => t.worktreeId === w.id);
      return {
        id: w.id,
        name: w.name,
        path: w.path,
        active: project.activeWorktreeId === w.id,
        heldBy: h ? { ticketId: h.id, number: h.number, status: h.status } : null,
        createdAt: new Date(w.createdAt).toISOString(),
      };
    });
  }

  /** Every project gets one worktree, active, when it has none (new projects and ones created before worktrees). */
  async ensureDefault(project: ProjectEntity): Promise<void> {
    if ((await this.repo.countBy({ projectId: project.id })) > 0) {
      if (!project.activeWorktreeId) {
        const [first] = await this.listFor(project.id);
        if (first) await this.projects.update({ id: project.id }, { activeWorktreeId: first.id });
      }
      return;
    }
    await this.create(project, DEFAULT_WORKTREE_NAME, { activate: true });
  }

  async create(project: ProjectEntity, rawName: string, opts: { activate?: boolean } = {}): Promise<WorktreeEntity> {
    const name = rawName.trim();
    if (!name) throw new BadRequestException('Give the worktree a name');
    const slug = worktreeSlug(name);
    if (await this.repo.existsBy({ projectId: project.id, slug })) {
      throw new ConflictException(`Project "${project.name}" already has a worktree named "${name}"`);
    }
    const path = join(this.gitFactory.worktreesDirFor(project.slug), 'worktrees', slug);
    const saved = await this.repo.save(this.repo.create({ projectId: project.id, name, slug, path }));
    if (opts.activate) await this.projects.update({ id: project.id }, { activeWorktreeId: saved.id });
    // Created eagerly so it shows up in `git worktree list`; the worker re-checks before every run.
    try {
      await this.gitFactory.forProject(project).ensureSharedWorktree(path);
    } catch (e) {
      this.logger.warn(`Worktree "${name}" of "${project.name}" will be created on first use: ${errorMessage(e)}`);
    }
    return saved;
  }

  async activate(project: ProjectEntity, worktreeId: string): Promise<void> {
    const w = await this.findById(worktreeId);
    if (w.projectId !== project.id) throw new NotFoundException(`Worktree ${worktreeId} not found in "${project.name}"`);
    await this.projects.update({ id: project.id }, { activeWorktreeId: w.id });
  }

  /** 409 for the active worktree or one a ticket is holding; tickets that ran there are detached from it. */
  async remove(project: ProjectEntity, worktreeId: string): Promise<void> {
    const w = await this.findById(worktreeId);
    if (w.projectId !== project.id) throw new NotFoundException(`Worktree ${worktreeId} not found in "${project.name}"`);
    if (project.activeWorktreeId === w.id) {
      throw new ConflictException(`"${w.name}" is the active worktree; make another one active first`);
    }
    const holder = await this.tickets.findOneBy({ worktreeId: w.id, status: In([...HOLDING_STATUSES]) });
    if (holder) {
      throw new ConflictException(`Ticket #${holder.number} is using "${w.name}"; finish or cancel it first`);
    }
    // Pending or failed tickets that ran here start over in the active worktree. Their branches
    // survive; the session is dropped because Claude keys sessions by working directory.
    await this.tickets.update(
      { worktreeId: w.id, status: In([TicketStatus.Pending, TicketStatus.Failed]) },
      { worktreeId: null, worktreePath: null, sessionId: null },
    );
    await this.tickets.update({ worktreeId: w.id }, { worktreeId: null, worktreePath: null });
    await this.repo.delete({ id: w.id });
    try {
      await this.gitFactory.forProject(project).removeSharedWorktree(w.path);
    } catch (e) {
      this.logger.warn(`Removed worktree "${w.name}" but could not delete ${w.path}: ${errorMessage(e)}`);
    }
  }

  /** Removes every shared worktree of a project from disk (project deletion; best effort). */
  async removeAllFor(project: ProjectEntity): Promise<void> {
    const git = this.gitFactory.forProject(project);
    for (const w of await this.listFor(project.id)) {
      try {
        await git.removeSharedWorktree(w.path);
      } catch (e) {
        this.logger.warn(`Deleting project "${project.name}": could not remove ${w.path}: ${errorMessage(e)}`);
      }
    }
  }

  /** Pending tickets the worker can't start because their (or the active) worktree is held by another ticket. */
  async waiting(projectIds?: string[]): Promise<WaitingTicketDto[]> {
    const rows = (await this.tickets.query(
      `SELECT t.id, t.number, w.name AS worktree_name, h.number AS held_by
         FROM tickets t
         JOIN projects p ON p.id = t.project_id
         JOIN worktrees w ON w.id = COALESCE(t.worktree_id, CASE WHEN t.worktree_path IS NULL THEN p.active_worktree_id END)
         JOIN LATERAL (
           SELECT o.number FROM tickets o
            WHERE o.worktree_id = w.id AND o.id <> t.id AND o.status::text = ANY($1::text[])
            ORDER BY o.updated_at LIMIT 1
         ) h ON true
        WHERE t.status = 'pending' ${projectIds ? 'AND t.project_id = ANY($2::uuid[])' : ''}
        ORDER BY t.priority, t.position, t.created_at`,
      projectIds ? [[...HOLDING_STATUSES], projectIds] : [[...HOLDING_STATUSES]],
    )) as Array<{ id: string; number: number; worktree_name: string; held_by: number }>;
    return rows.map((r) => ({
      ticketId: r.id,
      ticketNumber: Number(r.number),
      worktreeName: r.worktree_name,
      heldByNumber: Number(r.held_by),
    }));
  }
}
