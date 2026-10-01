import { Module } from '@nestjs/common';
import { AgentProcessTracker } from './process-tracker';
import { AttachmentsModule } from '../attachments/attachments.module';
import { EventsModule } from '../events/events.module';
import { GitModule } from '../git/git.module';
import { ProjectsModule } from '../projects/projects.module';
import { SettingsModule } from '../settings/settings.module';
import { StatusModule } from '../status/status.module';
import { TicketsModule } from '../tickets/tickets.module';
import { AgentRunner } from './agent-runner';
import { AgentWorkerService } from './agent-worker.service';

@Module({
  imports: [TicketsModule, EventsModule, SettingsModule, GitModule, StatusModule, ProjectsModule, AttachmentsModule],
  providers: [AgentRunner, AgentWorkerService, AgentProcessTracker],
})
export class AgentModule {}
