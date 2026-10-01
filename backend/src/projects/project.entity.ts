import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

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

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
