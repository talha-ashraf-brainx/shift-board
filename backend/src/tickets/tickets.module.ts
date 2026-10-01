import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventsModule } from '../events/events.module';
import { GitModule } from '../git/git.module';
import { ProjectEntity } from '../projects/project.entity';
import { TicketStateMachine } from './ticket-state-machine';
import { TicketEntity } from './ticket.entity';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

@Module({
  imports: [TypeOrmModule.forFeature([TicketEntity, ProjectEntity]), EventsModule, GitModule],
  controllers: [TicketsController],
  providers: [TicketsService, TicketStateMachine],
  exports: [TicketsService, TicketStateMachine],
})
export class TicketsModule {}
