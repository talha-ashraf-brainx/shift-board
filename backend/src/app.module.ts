import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AgentModule } from './agent/agent.module';
import { AttachmentsModule } from './attachments/attachments.module';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { EventsModule } from './events/events.module';
import { FsModule } from './fs/fs.module';
import { NotificationsModule } from './notifications/notifications.module';
import { GitModule } from './git/git.module';
import { ProjectsModule } from './projects/projects.module';
import { RealtimeModule } from './realtime/realtime.module';
import { SettingsModule } from './settings/settings.module';
import { StatusModule } from './status/status.module';
import { TicketsModule } from './tickets/tickets.module';

@Module({
  imports: [
    ConfigModule,
    AuthModule,
    EventEmitterModule.forRoot(),
    CommonModule,
    DatabaseModule,
    EventsModule,
    GitModule,
    ProjectsModule,
    FsModule,
    TicketsModule,
    SettingsModule,
    NotificationsModule,
    StatusModule,
    AttachmentsModule,
    RealtimeModule,
    AgentModule,
  ],
})
export class AppModule {}
