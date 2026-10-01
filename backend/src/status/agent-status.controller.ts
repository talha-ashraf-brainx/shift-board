import type { AgentStatusDto } from '@agent-board/shared';
import { Controller, Get } from '@nestjs/common';
import { AgentStatusService } from './agent-status.service';

@Controller('agent')
export class AgentStatusController {
  constructor(private readonly status: AgentStatusService) {}

  @Get('status')
  get(): Promise<AgentStatusDto> {
    return this.status.getStatus();
  }
}
