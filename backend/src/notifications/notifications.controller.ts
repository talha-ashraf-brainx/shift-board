import type { NotifyTestResultDto } from '@agent-board/shared';
import { Controller, HttpCode, Post } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

@Controller('settings')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** Sends a test message to the configured webhook; 200 with ok/error either way. */
  @Post('notify-test')
  @HttpCode(200)
  test(): Promise<NotifyTestResultDto> {
    return this.notifications.sendTest();
  }
}
