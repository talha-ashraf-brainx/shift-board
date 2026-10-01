import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectsModule } from '../projects/projects.module';
import { SettingsModule } from '../settings/settings.module';
import { TicketEntity } from '../tickets/ticket.entity';
import { AgentStatusController } from './agent-status.controller';
import { AgentStatusService } from './agent-status.service';

@Module({
  imports: [TypeOrmModule.forFeature([TicketEntity]), SettingsModule, ProjectsModule],
  controllers: [AgentStatusController],
  providers: [AgentStatusService],
  exports: [AgentStatusService],
})
export class StatusModule {}
