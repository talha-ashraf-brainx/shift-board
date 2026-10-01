import {
  SocketEvents,
  TicketStatus,
  type ProjectDto,
  type RepoInspectDto,
  type RepoStatusDto,
} from '@agent-board/shared';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { basename, isAbsolute } from 'node:path';
import { In, IsNull, Not, QueryFailedError, type Repository } from 'typeorm';
import { WorkerSignal } from '../common/worker-signal.service';
import { AppConfig } from '../config/app-config';
import { GitServiceFactory } from '../git/git-service.factory';
import {
  branchExists,
  currentBranch,
  inspectRepo,
  isDirectory,
  isInsidePath,
  realpathOr,
  repoToplevel,
} from '../git/repo-inspect';
import { TicketEntity } from '../tickets/ticket.entity';
import type { CreateProjectDto, UpdateProjectDto } from './dto/project.dto';
import { ProjectEntity } from './project.entity';
import { WorktreesService } from './worktrees.service';

/** Internal (backend-only) event: the set of ready/blocked projects changed. */
export const PROJECTS_READINESS_CHANGED = 'projects.readiness';

export interface BlockedProject {
  projectId: string;
  name: string;
  reason: string;
}

export interface Readiness {
  readyIds: string[];
  blocked: BlockedProject[];
}

/** Tickets in these statuses block deleting their project. */
const ACTIVE_STATUSES = [
  TicketStatus.Pending,
  TicketStatus.InProgress,
  TicketStatus.NeedsContext,
  TicketStatus.Review,
];

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function slugify(name: string): string {
  const s = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
    .replace(/-+$/g, '');
  return s || 'project';
}

const iso = (d: Date | string): string => new Date(d).toISOString();

@Injectable()
export class ProjectsService implements OnModuleInit {
  private readonly logger = new Logger(ProjectsService.name);
  /** Last computed repo state per project id (refreshed by the worker loop). */
  private readiness = new Map<string, { name: string; ready: boolean; reason: string | null }>();

  constructor(
    @InjectRepository(ProjectEntity) private readonly repo: Repository<ProjectEntity>,
    @InjectRepository(TicketEntity) private readonly tickets: Repository<TicketEntity>,
    private readonly gitFactory: GitServiceFactory,
    private readonly config: AppConfig,
    private readonly emitter: EventEmitter2,
    private readonly workerSignal: WorkerSignal,
    private readonly worktrees: WorktreesService,
  ) {}

  /** Runs before any onApplicationBootstrap hook, so before crash recovery and the worker. */
  async onModuleInit(): Promise<void> {
    try {
      await this.bootstrap();
    } catch (e) {
      this.logger.error(`Project bootstrap failed: ${errorMessage(e)}`);
    }
  }

  /**
   * Seeds a default project from TARGET_REPO_PATH when there are none, then assigns every
   * legacy ticket (project_id NULL) to the first project.
   */
  async bootstrap(): Promise<void> {
    if ((await this.repo.count()) === 0 && this.config.targetRepoPath) {
      try {
        const root = (await repoToplevel(this.config.targetRepoPath)) ?? this.config.targetRepoPath;
        const baseBranch = this.config.baseBranch ?? (await currentBranch(root)) ?? 'main';
        const name = basename(root).slice(0, 100) || 'project';
        const p = await this.createEntity({ name, repoPath: root, baseBranch });
        this.logger.log(`Created the default project "${p.name}" from TARGET_REPO_PATH (${p.repoPath})`);
      } catch (e) {
        this.logger.warn(`Could not create a default project from TARGET_REPO_PATH: ${errorMessage(e)}`);
      }
    }
    for (const p of await this.findAll()) {
      try {
        await this.worktrees.ensureDefault(p);
      } catch (e) {
        this.logger.warn(`Could not set up the default worktree of "${p.name}": ${errorMessage(e)}`);
      }
    }
    const [first] = await this.repo.find({ order: { createdAt: 'ASC' }, take: 1 });
    if (!first) return;
    const res = await this.tickets.update({ projectId: IsNull() }, { projectId: first.id });
    if (res.affected) this.logger.log(`Assigned ${res.affected} legacy ticket(s) to project "${first.name}"`);
  }

  // ---------------------------------------------------------------- queries

  async findById(id: string): Promise<ProjectEntity> {
    const p = await this.repo.findOneBy({ id });
    if (!p) throw new NotFoundException(`Project ${id} not found`);
    return p;
  }

  findAll(): Promise<ProjectEntity[]> {
    return this.repo.find({ order: { name: 'ASC' } });
  }

  async list(): Promise<ProjectDto[]> {
    const [projects, counts] = await Promise.all([this.findAll(), this.ticketCounts()]);
    return Promise.all(projects.map((p) => this.toDto(p, counts.get(p.id) ?? {})));
  }

  async get(id: string): Promise<ProjectDto> {
    return this.toDto(await this.findById(id));
  }

  async toDto(p: ProjectEntity, counts?: ProjectDto['ticketCounts']): Promise<ProjectDto> {
    const [repoStatus, ticketCounts, worktrees] = await Promise.all([
      this.repoStatus(p),
      counts ? Promise.resolve(counts) : this.ticketCounts(p.id).then((m) => m.get(p.id) ?? {}),
      this.worktrees.toDtos(p),
    ]);
    return {
      id: p.id,
      name: p.name,
      repoPath: p.repoPath,
      baseBranch: p.baseBranch,
      rules: p.rules ?? null,
      extraAllowedTools: p.extraAllowedTools ?? [],
      worktreesDir: this.gitFactory.worktreesDirFor(p.slug),
      worktrees,
      activeWorktreeId: p.activeWorktreeId ?? null,
      repoStatus,
      ticketCounts,
      createdAt: iso(p.createdAt),
      updatedAt: iso(p.updatedAt),
    };
  }

  async repoStatus(p: ProjectEntity): Promise<RepoStatusDto> {
    try {
      return await this.gitFactory.forProject(p).repoStatus();
    } catch (e) {
      return { ready: false, reason: `Could not check the repo: ${errorMessage(e)}`, currentBranch: null };
    }
  }

  private async ticketCounts(projectId?: string): Promise<Map<string, ProjectDto['ticketCounts']>> {
    const rows = (await this.tickets.query(
      `SELECT project_id, status, COUNT(*)::int AS n FROM tickets
        WHERE project_id IS NOT NULL ${projectId ? 'AND project_id = $1' : ''}
        GROUP BY project_id, status`,
      projectId ? [projectId] : [],
    )) as Array<{ project_id: string; status: TicketStatus; n: number }>;
    const out = new Map<string, ProjectDto['ticketCounts']>();
    for (const r of rows) {
      const m = out.get(r.project_id) ?? {};
      m[r.status] = Number(r.n);
      out.set(r.project_id, m);
    }
    return out;
  }

  /** GET /projects/inspect: never throws for a bad path. */
  async inspect(path: string): Promise<RepoInspectDto> {
    const info = await inspectRepo(path);
    const root = info.repoRoot;
    const existing = root ? await this.repo.findOneBy({ repoPath: root }) : null;
    return {
      ...info,
      suggestedName: (basename(root ?? info.path) || 'project').slice(0, 100),
      existingProjectId: existing?.id ?? null,
    };
  }

  // ---------------------------------------------------------------- commands

  async create(input: CreateProjectDto): Promise<ProjectDto> {
    const p = await this.createEntity(input);
    const dto = await this.toDto(p);
    this.emitter.emit(SocketEvents.ProjectCreated, dto);
    this.workerSignal.wake();
    return dto;
  }

  private async createEntity(input: CreateProjectDto): Promise<ProjectEntity> {
    const name = input.name.trim();
    const repoPath = await this.validateRepoRoot(input.repoPath);
    if (await this.repo.findOneBy({ repoPath })) {
      throw new ConflictException(`A project for ${repoPath} already exists`);
    }
    await this.assertNameFree(name);
    const baseBranch = input.baseBranch.trim();
    if (!(await branchExists(repoPath, baseBranch))) {
      throw new BadRequestException(`Branch '${baseBranch}' does not exist in ${repoPath}`);
    }
    const slug = await this.uniqueSlug(name);
    const worktreesDir = this.gitFactory.worktreesDirFor(slug);
    if (isInsidePath(repoPath, realpathOr(worktreesDir))) {
      throw new BadRequestException(`The worktrees folder (${worktreesDir}) must be outside the repo`);
    }
    try {
      const saved = await this.repo.save(
        this.repo.create({
          name,
          slug,
          repoPath,
          baseBranch,
          rules: input.rules ?? null,
          extraAllowedTools: input.extraAllowedTools ?? [],
        }),
      );
      await this.worktrees.ensureDefault(saved);
      return this.findById(saved.id);
    } catch (e) {
      throw this.uniqueViolation(e) ?? e;
    }
  }

  async update(id: string, input: UpdateProjectDto): Promise<ProjectDto> {
    const p = await this.findById(id);
    if (input.name !== undefined && input.name.trim() !== p.name) {
      await this.assertNameFree(input.name.trim(), p.id);
      p.name = input.name.trim();
    }
    if (input.baseBranch !== undefined && input.baseBranch.trim() !== p.baseBranch) {
      const b = input.baseBranch.trim();
      if (!(await branchExists(p.repoPath, b))) {
        throw new BadRequestException(`Branch '${b}' does not exist in ${p.repoPath}`);
      }
      p.baseBranch = b;
    }
    if (input.rules !== undefined) p.rules = input.rules ?? null;
    if (input.extraAllowedTools !== undefined) p.extraAllowedTools = input.extraAllowedTools;
    try {
      await this.repo.save(p);
    } catch (e) {
      throw this.uniqueViolation(e) ?? e;
    }
    const dto = await this.toDto(await this.findById(id));
    this.emitter.emit(SocketEvents.ProjectUpdated, dto);
    this.workerSignal.wake();
    return dto;
  }

  /** 409 while it has active tickets; otherwise cleans up worktrees/branches (best effort) and deletes. */
  async remove(id: string): Promise<{ id: string }> {
    const p = await this.findById(id);
    const active = await this.tickets.countBy({ projectId: id, status: In(ACTIVE_STATUSES) });
    if (active > 0) {
      throw new ConflictException(
        `Project "${p.name}" has ${active} active ticket(s) (pending, in progress, needs context or review); cancel or finish them first`,
      );
    }
    const leftovers = await this.tickets.find({
      where: [
        { projectId: id, worktreePath: Not(IsNull()) },
        { projectId: id, branchName: Not(IsNull()), status: Not(In([TicketStatus.Done, TicketStatus.Cancelled])) },
      ],
    });
    const git = this.gitFactory.forProject(p);
    for (const t of leftovers) {
      try {
        await git.removeWorktree(t, { deleteBranch: true });
      } catch (e) {
        this.logger.warn(`Deleting project "${p.name}": could not clean up ticket #${t.number}: ${errorMessage(e)}`);
      }
    }
    await this.worktrees.removeAllFor(p);
    await this.repo.delete({ id });
    this.gitFactory.forget(id);
    if (this.readiness.delete(id)) this.emitter.emit(PROJECTS_READINESS_CHANGED);
    this.emitter.emit(SocketEvents.ProjectDeleted, { id });
    this.logger.log(`Deleted project "${p.name}"`);
    return { id };
  }

  // ---------------------------------------------------------------- worktrees

  async addWorktree(projectId: string, name: string): Promise<ProjectDto> {
    await this.worktrees.create(await this.findById(projectId), name);
    return this.emitChanged(projectId);
  }

  async activateWorktree(projectId: string, worktreeId: string): Promise<ProjectDto> {
    await this.worktrees.activate(await this.findById(projectId), worktreeId);
    this.workerSignal.wake();
    return this.emitChanged(projectId);
  }

  async removeWorktree(projectId: string, worktreeId: string): Promise<ProjectDto> {
    await this.worktrees.remove(await this.findById(projectId), worktreeId);
    return this.emitChanged(projectId);
  }

  private async emitChanged(projectId: string): Promise<ProjectDto> {
    const dto = await this.toDto(await this.findById(projectId));
    this.emitter.emit(SocketEvents.ProjectUpdated, dto);
    return dto;
  }

  // ---------------------------------------------------------------- readiness (worker)

  /**
   * Checks every project's main checkout. Emits project.updated for each project whose ready
   * state flipped, and PROJECTS_READINESS_CHANGED when the blocked set changed.
   */
  async refreshReadiness(): Promise<Readiness> {
    const projects = await this.findAll();
    const statuses = await Promise.all(projects.map((p) => this.repoStatus(p)));
    const next = new Map<string, { name: string; ready: boolean; reason: string | null }>();
    const flipped: ProjectEntity[] = [];
    let changed = projects.length !== this.readiness.size;
    projects.forEach((p, i) => {
      const s = statuses[i]!;
      const prev = this.readiness.get(p.id);
      next.set(p.id, { name: p.name, ready: s.ready, reason: s.reason });
      if (!prev || prev.ready !== s.ready || prev.reason !== s.reason || prev.name !== p.name) changed = true;
      if (prev && prev.ready !== s.ready) flipped.push(p);
    });
    this.readiness = next;
    if (changed) this.emitter.emit(PROJECTS_READINESS_CHANGED);
    for (const p of flipped) {
      try {
        this.emitter.emit(SocketEvents.ProjectUpdated, await this.toDto(p));
      } catch (e) {
        this.logger.warn(`Could not emit project.updated for "${p.name}": ${errorMessage(e)}`);
      }
    }
    return { readyIds: projects.filter((_, i) => statuses[i]!.ready).map((p) => p.id), blocked: this.getBlocked() };
  }

  /** Not-ready projects as of the last refreshReadiness(). */
  getBlocked(): BlockedProject[] {
    const out: BlockedProject[] = [];
    for (const [projectId, r] of this.readiness) {
      if (!r.ready) out.push({ projectId, name: r.name, reason: r.reason ?? 'Repo is not ready' });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  // ---------------------------------------------------------------- helpers

  /** Absolute, existing directory that is the root of a git work tree; returns its realpath. */
  private async validateRepoRoot(path: string): Promise<string> {
    const raw = path.trim();
    if (!isAbsolute(raw)) throw new BadRequestException('repoPath must be an absolute path');
    if (!isDirectory(raw)) throw new BadRequestException(`repoPath does not exist or is not a directory: ${raw}`);
    const real = realpathOr(raw);
    const top = await repoToplevel(real);
    if (!top) throw new BadRequestException(`Not a git repository: ${raw}`);
    if (top !== real) {
      throw new BadRequestException(`${raw} is inside the git repository at ${top}; use the repository root`);
    }
    if (isInsidePath(real, realpathOr(this.gitFactory.worktreesRoot))) {
      throw new BadRequestException(`WORKTREES_DIR (${this.gitFactory.worktreesRoot}) must be outside the repo`);
    }
    return real;
  }

  private async assertNameFree(name: string, exceptId?: string): Promise<void> {
    const qb = this.repo.createQueryBuilder('p').where('lower(p.name) = lower(:name)', { name });
    if (exceptId) qb.andWhere('p.id <> :id', { id: exceptId });
    if (await qb.getExists()) throw new ConflictException(`A project named "${name}" already exists`);
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base = slugify(name);
    const taken = new Set(
      (
        await this.repo
          .createQueryBuilder('p')
          .select('p.slug', 'slug')
          .where('p.slug = :base OR p.slug LIKE :like', { base, like: `${base}-%` })
          .getRawMany<{ slug: string }>()
      ).map((r) => r.slug),
    );
    if (!taken.has(base)) return base;
    for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
  }

  private uniqueViolation(e: unknown): ConflictException | null {
    if (e instanceof QueryFailedError && (e.driverError as { code?: string } | undefined)?.code === '23505') {
      return new ConflictException('A project with this name or repo path already exists');
    }
    return null;
  }
}
