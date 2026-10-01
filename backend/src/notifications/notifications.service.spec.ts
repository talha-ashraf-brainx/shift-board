import { TicketEventType, TicketStatus, type TicketEventPayload } from '@agent-board/shared';
import { Logger } from '@nestjs/common';
import type { AppConfig } from '../config/app-config';
import type { SettingsService } from '../settings/settings.service';
import { NotificationsService } from './notifications.service';

const ticket = {
  id: 't-1',
  number: 12,
  title: 'Fix login',
  description: 'The login button does nothing',
  project: { name: 'shop' },
};

function statusEvent(to: TicketStatus, type = TicketEventType.StatusChanged): TicketEventPayload {
  return {
    ticketId: ticket.id,
    event: {
      id: 'e-1',
      ticketId: ticket.id,
      type,
      author: 'agent' as never,
      body: '',
      meta: { from: TicketStatus.InProgress, to, actor: 'worker' },
      createdAt: new Date().toISOString(),
    },
  };
}

describe('NotificationsService', () => {
  let fetchMock: jest.Mock;
  let webhook: string | null;
  let service: NotificationsService;
  let warn: jest.SpyInstance;
  const repo = { findOne: jest.fn() };

  beforeEach(() => {
    webhook = 'https://hooks.example.com/abc';
    fetchMock = jest.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;
    repo.findOne.mockReset().mockResolvedValue(ticket);
    const settings = { get: jest.fn(async () => ({ globalRules: '', workerEnabled: true, notifyWebhookUrl: webhook })) };
    const config = { publicUrl: 'http://board.local' } as AppConfig;
    service = new NotificationsService(repo as never, settings as unknown as SettingsService, config);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  const flush = () => new Promise((r) => setTimeout(r, 0));

  it.each([
    [TicketStatus.NeedsContext, 'needs your answer'],
    [TicketStatus.Review, 'is ready for review'],
    [TicketStatus.Failed, 'failed'],
  ])('posts a Slack/Discord message when a ticket enters %s', async (status, phrase) => {
    service.onTicketEvent(statusEvent(status));
    await flush();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://hooks.example.com/abc');
    expect(init.method).toBe('POST');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(init.body as string) as { text: string; content: string };
    expect(body.text).toBe(`Shiftboard: #12 "Fix login" ${phrase} (project shop)\nhttp://board.local/tickets/t-1`);
    expect(body.content).toBe(body.text);
  });

  it.each([TicketStatus.Pending, TicketStatus.InProgress, TicketStatus.Done, TicketStatus.Cancelled])(
    'does not notify for %s',
    async (status) => {
      service.onTicketEvent(statusEvent(status));
      await flush();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('ignores non-status events', async () => {
    service.onTicketEvent(statusEvent(TicketStatus.Review, TicketEventType.AgentLog));
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does nothing when no webhook URL is set', async () => {
    webhook = null;
    await service.notifyTicket(ticket.id, TicketStatus.Review);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await service.sendTest()).toEqual({ ok: false, error: 'No webhook URL is configured' });
  });

  it('swallows network errors and non-2xx responses, logging at warn', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(service.notifyTicket(ticket.id, TicketStatus.Failed)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'));

    fetchMock.mockResolvedValueOnce(new Response('no_service', { status: 404 }));
    await expect(service.notifyTicket(ticket.id, TicketStatus.Failed)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('404'));

    repo.findOne.mockRejectedValueOnce(new Error('db down'));
    await expect(service.notifyTicket(ticket.id, TicketStatus.Failed)).resolves.toBeUndefined();
  });

  it('the event handler returns synchronously (does not block the transition)', () => {
    fetchMock.mockReturnValue(new Promise(() => undefined));
    expect(service.onTicketEvent(statusEvent(TicketStatus.Review))).toBeUndefined();
  });

  it('sendTest reports ok or the error', async () => {
    expect(await service.sendTest()).toEqual({ ok: true });
    fetchMock.mockResolvedValueOnce(new Response('invalid_token', { status: 403 }));
    expect(await service.sendTest()).toEqual({ ok: false, error: 'Webhook responded 403: invalid_token' });
    const timeout = new Error('timed out');
    timeout.name = 'TimeoutError';
    fetchMock.mockRejectedValueOnce(timeout);
    expect(await service.sendTest()).toEqual({ ok: false, error: 'Webhook timed out after 5 s' });
  });
});
