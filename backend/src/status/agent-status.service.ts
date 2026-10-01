import { SocketEvents, TicketStatus, type AgentStatusDto } from '@agent-board/shared';
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { RunRegistry } from '../common/run-registry.service';
import { PROJECTS_READINESS_CHANGED, ProjectsService } from '../projects/projects.service';
import { SETTINGS_CHANGED, SettingsService } from '../settings/settings.service';
import { TicketEntity } from '../tickets/ticket.entity';

/**
 * Worker status for the header pill. Broadcast (agent.status) after ticket changes and
 * settings changes automatically (coalesced); the worker also calls broadcast() on run start/finish.
 */
@Injectable()
export class AgentStatusService implements OnModuleDestroy {
  private readonly logger = new Logger(AgentStatusService.name);
  private timer: NodeJS.Timeout | null = null;
  private destroyed = false;

  constructor(
    @InjectRepository(TicketEntity) private readonly tickets: Repository<TicketEntity>,
    private readonly settings: SettingsService,
    private readonly projects: ProjectsService,
    private readonly runs: RunRegistry,
    private readonly emitter: EventEmitter2,
  ) {}

  async getStatus(): Promise<AgentStatusDto> {
    const [settings, queueLength] = await Promise.all([
      this.settings.get(),
      this.tickets.countBy({ status: TicketStatus.Pending }),
    ]);
    const current = this.runs.current();
    const state = current ? 'running' : settings.workerEnabled ? 'idle' : 'paused';
    return {
      state,
      ticketId: current?.ticketId ?? null,
      ticketNumber: current?.ticketNumber ?? null,
      queueLength,
      blockedProjects: this.projects.getBlocked(),
    };
  }

  /** Emits agent.status now. */
  async broadcast(): Promise<void> {
    if (this.destroyed) return;
    try {
      const status = await this.getStatus();
      this.emitter.emit(SocketEvents.AgentStatus, status);
    } catch (e) {
      this.logger.warn(`Could not broadcast agent status: ${(e as Error).message}`);
    }
  }

  @OnEvent(SocketEvents.TicketCreated)
  @OnEvent(SocketEvents.TicketUpdated)
  @OnEvent(SETTINGS_CHANGED)
  @OnEvent(PROJECTS_READINESS_CHANGED)
  @OnEvent(SocketEvents.ProjectDeleted)
  scheduleBroadcast(): void {
    if (this.timer || this.destroyed) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.broadcast();
    }, 50);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    this.destroyed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
