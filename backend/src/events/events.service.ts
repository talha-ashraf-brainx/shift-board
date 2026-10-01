import {
  SocketEvents,
  type EventAuthor,
  type TicketEventDto,
  type TicketEventPayload,
  type TicketEventType,
} from '@agent-board/shared';
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import type { EntityManager, Repository } from 'typeorm';
import { TicketEventEntity } from './ticket-event.entity';

export interface AppendEventInput {
  ticketId: string;
  type: TicketEventType;
  author: EventAuthor;
  body: string;
  meta?: Record<string, unknown> | null;
}

@Injectable()
export class EventsService {
  constructor(
    @InjectRepository(TicketEventEntity) private readonly repo: Repository<TicketEventEntity>,
    private readonly emitter: EventEmitter2,
  ) {}

  /** Saves the event and emits `ticket.event`. */
  async append(input: AppendEventInput): Promise<TicketEventEntity> {
    const saved = await this.insert(input);
    this.emitCreated(saved);
    return saved;
  }

  /**
   * Saves without emitting, optionally inside a transaction. Call `emitCreated()`
   * after the transaction commits.
   */
  async insert(input: AppendEventInput, manager?: EntityManager): Promise<TicketEventEntity> {
    const repo = manager ? manager.getRepository(TicketEventEntity) : this.repo;
    const entity = repo.create({
      ticketId: input.ticketId,
      type: input.type,
      author: input.author,
      body: input.body,
      meta: input.meta ?? null,
    });
    const saved = await repo.save(entity);
    // Reload so createdAt (DB default) is populated.
    return (await repo.findOneByOrFail({ id: saved.id })) as TicketEventEntity;
  }

  emitCreated(e: TicketEventEntity): void {
    const payload: TicketEventPayload = { ticketId: e.ticketId, event: this.toDto(e) };
    this.emitter.emit(SocketEvents.TicketEvent, payload);
  }

  /** Oldest first. */
  listForTicket(ticketId: string): Promise<TicketEventEntity[]> {
    return this.repo.find({ where: { ticketId }, order: { createdAt: 'ASC' } });
  }

  /** Most recent event of a type, or null. */
  findLatest(ticketId: string, type: TicketEventType): Promise<TicketEventEntity | null> {
    return this.repo.findOne({ where: { ticketId, type }, order: { createdAt: 'DESC' } });
  }

  toDto(e: TicketEventEntity): TicketEventDto {
    return {
      id: e.id,
      ticketId: e.ticketId,
      type: e.type,
      author: e.author,
      body: e.body,
      meta: e.meta ?? null,
      createdAt: new Date(e.createdAt).toISOString(),
    };
  }
}
