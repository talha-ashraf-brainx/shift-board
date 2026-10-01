import type { AgentStatusDto, ProjectDto, TicketDto, TicketEventDto } from './dto';

/**
 * Event names. Used both for the backend's internal event emitter
 * (@nestjs/event-emitter) and for the Socket.IO events sent to the browser.
 */
export const SocketEvents = {
  TicketCreated: 'ticket.created',
  TicketUpdated: 'ticket.updated',
  TicketEvent: 'ticket.event',
  AgentStatus: 'agent.status',
  ProjectCreated: 'project.created',
  ProjectUpdated: 'project.updated',
  ProjectDeleted: 'project.deleted',
} as const;

export type SocketEventName = (typeof SocketEvents)[keyof typeof SocketEvents];

export interface TicketEventPayload {
  ticketId: string;
  event: TicketEventDto;
}

export interface SocketPayloads {
  'ticket.created': TicketDto;
  'ticket.updated': TicketDto;
  'ticket.event': TicketEventPayload;
  'agent.status': AgentStatusDto;
  'project.created': ProjectDto;
  'project.updated': ProjectDto;
  'project.deleted': { id: string };
}

/** Internal-only (backend) signal names; never sent to the browser. */
export const InternalEvents = {
  /** Wake the worker loop now (ticket created/requeued, settings changed). */
  WorkerWake: 'worker.wake',
} as const;
