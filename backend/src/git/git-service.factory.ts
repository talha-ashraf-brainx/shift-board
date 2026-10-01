import { Injectable } from '@nestjs/common';
import { join } from 'node:path';
import { AppConfig } from '../config/app-config';
import { GitService } from './git.service';

/** The project fields a GitService needs. A ProjectEntity satisfies this. */
export interface GitProjectRef {
  id: string;
  slug: string;
  repoPath: string;
  baseBranch: string;
  updatedAt: Date | string;
}

/** Hands out one GitService per project (cached by id + updatedAt). */
@Injectable()
export class GitServiceFactory {
  private readonly cache = new Map<string, { key: string; git: GitService }>();

  constructor(private readonly config: AppConfig) {}

  /** Root folder of all worktrees (WORKTREES_DIR). */
  get worktreesRoot(): string {
    return this.config.worktreesDir;
  }

  worktreesDirFor(slug: string): string {
    return join(this.config.worktreesDir, slug);
  }

  forProject(project: GitProjectRef): GitService {
    const key = `${project.repoPath}|${project.baseBranch}|${project.slug}|${new Date(project.updatedAt).getTime()}`;
    const hit = this.cache.get(project.id);
    if (hit && hit.key === key) return hit.git;
    const git = new GitService({
      targetRepoPath: project.repoPath,
      baseBranch: project.baseBranch,
      worktreesDir: this.worktreesDirFor(project.slug),
      // Legacy tickets keep worktrees directly under the root; allow cleaning those up too.
      cleanupRoot: this.config.worktreesDir,
    });
    this.cache.set(project.id, { key, git });
    return git;
  }

  forget(projectId: string): void {
    this.cache.delete(projectId);
  }
}
