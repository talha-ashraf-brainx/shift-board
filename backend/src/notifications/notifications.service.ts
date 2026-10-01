import {
  SocketEvents,
  TicketEventType,
  TicketStatus,
  ticketTitle,
  type NotifyTestResultDto,
  type StatusChangedMeta,
  type TicketEventPayload,
} from '@agent-board/shared';
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { AppConfig } from '../config/app-config';
import { SettingsService } from '../settings/settings.service';
import { TicketEntity } from '../tickets/ticket.entity';

/** Statuses where the human is needed, with the phrase used in the message. */
export const NOTIFY_STATUSES: Readonly<Partial<Record<TicketStatus, string>>> = {
  [TicketStatus.NeedsContext]: 'needs your answer',
  [TicketStatus.Review]: 'is ready for review',
  [TicketStatus.Failed]: 'failed',
};

export const WEBHOOK_TIMEOUT_MS = 5000;

/**
 * Posts a Slack/Discord-compatible message to the configured webhook when a ticket enters
 * needs_context, review or failed. Listens to the `ticket.event` emitted after the status
 * change commits; runs in the background and never throws into the emitter.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(TicketEntity) private readonly tickets: Repository<TicketEntity>,
    private readonly settings: SettingsService,
    private readonly config: AppConfig,
  ) {}

  @OnEvent(SocketEvents.TicketEvent)
  onTicketEvent(payload: TicketEventPayload): void {
    if (payload.event.type !== TicketEventType.StatusChanged) return;
    const to = (payload.event.meta as Partial<StatusChangedMeta> | null)?.to;
    if (!to || !NOTIFY_STATUSES[to]) return;
    void this.notifyTicket(payload.ticketId, to);
  }

  /** Resolves once the webhook was called (or skipped); never rejects. */
  async notifyTicket(ticketId: string, status: TicketStatus): Promise<void> {
    try {
      const phrase = NOTIFY_STATUSES[status];
      if (!phrase) return;
      const { notifyWebhookUrl } = await this.settings.get();
      if (!notifyWebhookUrl) return;
      const ticket = await this.tickets.findOne({ where: { id: ticketId }, relations: { project: true } });
      if (!ticket) return;
      const title = ticketTitle(ticket);
      const project = ticket.project ? ` (project ${ticket.project.name})` : '';
      const link = `${this.config.publicUrl}/tickets/${ticket.id}`;
      const text = `Shiftboard: #${ticket.number}${title ? ` "${title}"` : ''} ${phrase}${project}\n${link}`;
      const result = await this.post(notifyWebhookUrl, text);
      if (!result.ok) this.logger.warn(`Webhook notification for #${ticket.number} failed: ${result.error}`);
    } catch (e) {
      this.logger.warn(`Webhook notification failed: ${(e as Error).message}`);
    }
  }

  /** Sends a test message to the configured webhook. */
  async sendTest(): Promise<NotifyTestResultDto> {
    const { notifyWebhookUrl } = await this.settings.get();
    if (!notifyWebhookUrl) return { ok: false, error: 'No webhook URL is configured' };
    return this.post(
      notifyWebhookUrl,
      `Shiftboard: test notification. Webhook notifications are working.\n${this.config.publicUrl}`,
    );
  }

  /** POSTs `{ text, content }` (Slack reads `text`, Discord reads `content`). Never throws. */
  private async post(url: string, text: string): Promise<NotifyTestResultDto> {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, content: text }),
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      });
      if (!res.ok) {
        const body = (await res.text().catch(() => '')).slice(0, 200).trim();
        return { ok: false, error: `Webhook responded ${res.status}${body ? `: ${body}` : ''}` };
      }
      return { ok: true };
    } catch (e) {
      const err = e as Error;
      const error = err.name === 'TimeoutError' ? `Webhook timed out after ${WEBHOOK_TIMEOUT_MS / 1000} s` : err.message;
      return { ok: false, error };
    }
  }
}
