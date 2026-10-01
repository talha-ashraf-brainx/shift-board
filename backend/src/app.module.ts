import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AgentModule } from './agent/agent.module';
import { CommonModule } from './common/common.module';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { EventsModule } from './events/events.module';
import { FsModule } from './fs/fs.module';
import { GitModule } from './git/git.module';
import { ProjectsModule } from './projects/projects.module';
import { RealtimeModule } from './realtime/realtime.module';
import { SettingsModule } from './settings/settings.module';
import { StatusModule } from './status/status.module';
import { TicketsModule } from './tickets/tickets.module';

@Module({
  imports: [
    ConfigModule,
    EventEmitterModule.forRoot(),
    CommonModule,
    DatabaseModule,
    EventsModule,
    GitModule,
    ProjectsModule,
    FsModule,
    TicketsModule,
    SettingsModule,
    StatusModule,
    RealtimeModule,
    AgentModule,
  ],
})
export class AppModule {}
