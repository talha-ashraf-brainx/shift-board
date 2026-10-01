import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventsService } from './events.service';
import { TicketEventEntity } from './ticket-event.entity';

@Module({
  imports: [TypeOrmModule.forFeature([TicketEventEntity])],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
