import {
  EventAuthor,
  SocketEvents,
  TicketEventType,
  TicketStatus,
  TransitionActor,
  isTransitionAllowed,
  type StatusChangedMeta,
} from '@agent-board/shared';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { WorkerSignal } from '../common/worker-signal.service';
import { EventsService } from '../events/events.service';
import type { TicketEventEntity } from '../events/ticket-event.entity';
import { TicketEntity } from './ticket.entity';
import { ticketToDto } from './ticket.mapper';

export interface TransitionOptions {
  actor: TransitionActor;
  /** Body of the status_changed event (default: "Status changed from X to Y"). */
  reason?: string;
  /** Stored in the event's meta.note. */
  note?: string;
  /** Extra keys merged into the status_changed event meta (e.g. previousError). */
  meta?: Record<string, unknown>;
  /** Extra fields saved in the same transaction. */
  patch?: Partial<TicketEntity>;
}

export function authorForActor(actor: TransitionActor): EventAuthor {
  switch (actor) {
    case TransitionActor.Human:
      return EventAuthor.Human;
    case TransitionActor.Worker:
      return EventAuthor.Agent;
    default:
      return EventAuthor.System;
  }
}

/** The only place ticket status changes (claimNext uses recordClaim for its atomic SQL). */
@Injectable()
export class TicketStateMachine {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventsService,
    private readonly emitter: EventEmitter2,
    private readonly workerSignal: WorkerSignal,
  ) {}

  async transition(ticketId: string, to: TicketStatus, opts: TransitionOptions): Promise<TicketEntity> {
    const { ticket, event } = await this.dataSource.transaction(async (m) => {
      const t = await m.findOne(TicketEntity, { where: { id: ticketId }, lock: { mode: 'pessimistic_write' } });
      if (!t) throw new NotFoundException(`Ticket ${ticketId} not found`);
      const from = t.status;
      if (!isTransitionAllowed(from, to, opts.actor)) {
        throw new ConflictException(
          `Ticket #${t.number} cannot move from ${from} to ${to} (by ${opts.actor})`,
        );
      }

      if (opts.patch) {
        const { id: _id, number: _n, status: _s, ...patch } = opts.patch;
        Object.assign(t, patch);
      }
      // Side effects of the transition itself win over the patch.
      if (to === TicketStatus.InProgress) {
        t.lockedAt = new Date();
        t.attemptCount += 1;
      }
      if (from === TicketStatus.InProgress) t.lockedAt = null;
      if (from === TicketStatus.Failed && to === TicketStatus.Pending) t.lastError = null;
      t.status = to;
      await m.save(TicketEntity, t);

      const meta: StatusChangedMeta & Record<string, unknown> = {
        ...(opts.meta ?? {}),
        from,
        to,
        actor: opts.actor,
      };
      if (opts.note !== undefined) meta.note = opts.note;
      const ev = await this.events.insert(
        {
          ticketId,
          type: TicketEventType.StatusChanged,
          author: authorForActor(opts.actor),
          body: opts.reason ?? `Status changed from ${from} to ${to}`,
          meta,
        },
        m,
      );
      const fresh = await m.findOneByOrFail(TicketEntity, { id: ticketId });
      return { ticket: fresh, event: ev };
    });

    this.afterCommit(ticket, event);
    return ticket;
  }

  /**
   * Post-commit notifications for a status change made elsewhere atomically
   * (TicketsService.claimNext): emits ticket.event + ticket.updated, wakes the worker on pending.
   */
  afterCommit(ticket: TicketEntity, event: TicketEventEntity | null): void {
    if (event) this.events.emitCreated(event);
    this.emitter.emit(SocketEvents.TicketUpdated, ticketToDto(ticket));
    if (ticket.status === TicketStatus.Pending) this.workerSignal.wake();
  }
}
