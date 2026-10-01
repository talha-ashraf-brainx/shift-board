import { TicketPriority, TicketStatus } from '@agent-board/shared';
import {
  Column,
  CreateDateColumn,
  Entity,
  Generated,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  type ValueTransformer,
} from 'typeorm';
import { ProjectEntity } from '../projects/project.entity';

/** numeric comes back from pg as a string; expose it as a number. */
export const numericTransformer: ValueTransformer = {
  to: (v: number | null | undefined) => v,
  from: (v: string | number | null) => (v === null || v === undefined ? 0 : Number(v)),
};

@Entity({ name: 'tickets' })
@Index('IDX_tickets_queue', ['projectId', 'status', 'priority', 'position', 'createdAt'])
export class TicketEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Human-friendly #42; serial with a unique constraint. */
  @Column({ type: 'int', unique: true })
  @Generated('increment')
  number!: number;

  /** null only for legacy rows created before projects; required (and immutable) via the API. */
  @Column({ name: 'project_id', type: 'uuid', nullable: true })
  projectId!: string | null;

  @ManyToOne(() => ProjectEntity, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'project_id', foreignKeyConstraintName: 'FK_tickets_project_id' })
  project?: ProjectEntity | null;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'text' })
  description!: string;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  rules!: string[];

  @Column({ type: 'enum', enum: TicketPriority, enumName: 'ticket_priority', default: TicketPriority.Medium })
  priority!: TicketPriority;

  @Column({ type: 'enum', enum: TicketStatus, enumName: 'ticket_status', default: TicketStatus.Pending })
  status!: TicketStatus;

  @Column({ name: 'session_id', type: 'varchar', nullable: true })
  sessionId!: string | null;

  @Column({ name: 'branch_name', type: 'varchar', nullable: true })
  branchName!: string | null;

  @Column({ name: 'worktree_path', type: 'varchar', nullable: true })
  worktreePath!: string | null;

  /**
   * The shared worktree the ticket runs in, assigned when the worker first claims it. null with a
   * worktreePath is a legacy ticket that has its own per-ticket worktree.
   */
  @Column({ name: 'worktree_id', type: 'uuid', nullable: true })
  worktreeId!: string | null;

  @Column({ name: 'agent_summary', type: 'text', nullable: true })
  agentSummary!: string | null;

  @Column({ name: 'attempt_count', type: 'int', default: 0 })
  attemptCount!: number;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @Column({
    name: 'total_cost_usd',
    type: 'numeric',
    precision: 10,
    scale: 4,
    default: 0,
    transformer: numericTransformer,
  })
  totalCostUsd!: number;

  @Column({ name: 'locked_at', type: 'timestamptz', nullable: true })
  lockedAt!: Date | null;

  @Column({ type: 'int' })
  position!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
