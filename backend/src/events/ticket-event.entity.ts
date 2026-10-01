import { EventAuthor, TicketEventType } from '@agent-board/shared';
import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { TicketEntity } from '../tickets/ticket.entity';

@Entity({ name: 'ticket_events' })
export class TicketEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('IDX_ticket_events_ticket_id')
  @Column({ name: 'ticket_id', type: 'uuid' })
  ticketId!: string;

  @ManyToOne(() => TicketEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ticket_id', foreignKeyConstraintName: 'FK_ticket_events_ticket_id' })
  ticket?: TicketEntity;

  @Column({ type: 'enum', enum: TicketEventType, enumName: 'ticket_event_type' })
  type!: TicketEventType;

  @Column({ type: 'enum', enum: EventAuthor, enumName: 'event_author' })
  author!: EventAuthor;

  @Column({ type: 'text' })
  body!: string;

  @Column({ type: 'jsonb', nullable: true })
  meta!: Record<string, unknown> | null;

  /** clock_timestamp() (not now()) so events written in one transaction keep their order. */
  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'clock_timestamp()' })
  createdAt!: Date;
}
