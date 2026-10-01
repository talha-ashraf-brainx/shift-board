import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn, type ValueTransformer } from 'typeorm';

/** numeric comes back from pg as a string; null stays null. */
export const optionalNumber: ValueTransformer = {
  to: (v: number | null | undefined) => v,
  from: (v: string | number | null) => (v === null || v === undefined ? null : Number(v)),
};

@Entity({ name: 'projects' })
export class ProjectEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  name!: string;

  /** Derived from the name at creation ([a-z0-9-], deduped with -2, -3…); names the worktrees folder. */
  @Column({ type: 'varchar', length: 120, unique: true })
  slug!: string;

  /** Absolute repo root (realpath). Immutable. */
  @Column({ name: 'repo_path', type: 'varchar', unique: true })
  repoPath!: string;

  @Column({ name: 'base_branch', type: 'varchar' })
  baseBranch!: string;

  @Column({ type: 'text', nullable: true })
  rules!: string | null;

  @Column({ name: 'extra_allowed_tools', type: 'text', array: true, default: () => "'{}'" })
  extraAllowedTools!: string[];

  /** Runs in the worktree before every agent run, e.g. `pnpm install`. */
  @Column({ name: 'setup_command', type: 'text', nullable: true })
  setupCommand!: string | null;

  /** Must pass before a fix reaches Review, e.g. `pnpm lint && pnpm test`. */
  @Column({ name: 'check_command', type: 'text', nullable: true })
  checkCommand!: string | null;

  /** Spending limit per ticket in USD; null = AGENT_MAX_BUDGET_USD. */
  @Column({ name: 'max_budget_usd', type: 'numeric', precision: 10, scale: 2, nullable: true, transformer: optionalNumber })
  maxBudgetUsd!: number | null;

  /** The worktree new tickets run in. */
  @Column({ name: 'active_worktree_id', type: 'uuid', nullable: true })
  activeWorktreeId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
