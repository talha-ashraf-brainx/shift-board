import { SocketEvents, type SocketPayloads } from '@agent-board/shared';
import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

/** Read at decoration time; main.ts loads the root .env before importing the app module. */
const WEB_ORIGIN = process.env.WEB_ORIGIN?.trim() || 'http://localhost:5173';

/** Re-broadcasts the internal events to every connected browser (default path /socket.io). */
@WebSocketGateway({ cors: { origin: WEB_ORIGIN } })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  handleConnection(client: Socket): void {
    this.logger.debug(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`Client disconnected: ${client.id}`);
  }

  @OnEvent(SocketEvents.TicketCreated)
  onTicketCreated(payload: SocketPayloads['ticket.created']): void {
    this.server?.emit(SocketEvents.TicketCreated, payload);
  }

  @OnEvent(SocketEvents.TicketUpdated)
  onTicketUpdated(payload: SocketPayloads['ticket.updated']): void {
    this.server?.emit(SocketEvents.TicketUpdated, payload);
  }

  @OnEvent(SocketEvents.TicketEvent)
  onTicketEvent(payload: SocketPayloads['ticket.event']): void {
    this.server?.emit(SocketEvents.TicketEvent, payload);
  }

  @OnEvent(SocketEvents.ProjectCreated)
  onProjectCreated(payload: SocketPayloads['project.created']): void {
    this.server?.emit(SocketEvents.ProjectCreated, payload);
  }

  @OnEvent(SocketEvents.ProjectUpdated)
  onProjectUpdated(payload: SocketPayloads['project.updated']): void {
    this.server?.emit(SocketEvents.ProjectUpdated, payload);
  }

  @OnEvent(SocketEvents.ProjectDeleted)
  onProjectDeleted(payload: SocketPayloads['project.deleted']): void {
    this.server?.emit(SocketEvents.ProjectDeleted, payload);
  }

  @OnEvent(SocketEvents.AgentStatus)
  onAgentStatus(payload: SocketPayloads['agent.status']): void {
    this.server?.emit(SocketEvents.AgentStatus, payload);
  }
}
