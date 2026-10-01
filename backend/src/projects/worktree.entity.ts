import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** A shared git worktree of a project. Tickets run in it one at a time, each on its own branch. */
@Entity({ name: 'worktrees' })
export class WorktreeEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @Column({ type: 'varchar', length: 40 })
  name!: string;

  /** Unique per project; names the folder under the project's worktrees directory. */
  @Column({ type: 'varchar', length: 60 })
  slug!: string;

  /** Absolute path of the worktree directory. */
  @Column({ type: 'varchar' })
  path!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
