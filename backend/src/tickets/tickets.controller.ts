import type { DiffDto, TicketDto, TicketWithEventsDto } from '@agent-board/shared';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  AnswerDto,
  CreateTicketDto,
  ListTicketsQueryDto,
  RejectDto,
  RetryDto,
  StartFreshDto,
  UpdateTicketDto,
} from './dto/ticket.dto';
import { TicketsService } from './tickets.service';

const Id = () => Param('id', new ParseUUIDPipe({ version: undefined }));

@Controller('tickets')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get()
  async list(@Query() query: ListTicketsQueryDto): Promise<TicketDto[]> {
    return (await this.tickets.list(query)).map((t) => this.tickets.toDto(t));
  }

  @Get(':id')
  get(@Id() id: string): Promise<TicketWithEventsDto> {
    return this.tickets.get(id);
  }

  @Post()
  async create(@Body() body: CreateTicketDto): Promise<TicketDto> {
    return this.tickets.toDto(await this.tickets.create(body));
  }

  @Patch(':id')
  async update(@Id() id: string, @Body() body: UpdateTicketDto): Promise<TicketDto> {
    return this.tickets.toDto(await this.tickets.update(id, body));
  }

  @Post(':id/answer')
  @HttpCode(200)
  async answer(@Id() id: string, @Body() body: AnswerDto): Promise<TicketDto> {
    return this.tickets.toDto(await this.tickets.answer(id, body.message));
  }

  @Post(':id/approve')
  @HttpCode(200)
  async approve(@Id() id: string): Promise<TicketDto> {
    return this.tickets.toDto(await this.tickets.approve(id));
  }

  @Post(':id/reject')
  @HttpCode(200)
  async reject(@Id() id: string, @Body() body: RejectDto): Promise<TicketDto> {
    return this.tickets.toDto(await this.tickets.reject(id, body.feedback));
  }

  @Post(':id/retry')
  @HttpCode(200)
  async retry(@Id() id: string, @Body() body: RetryDto): Promise<TicketDto> {
    return this.tickets.toDto(await this.tickets.retry(id, body.note));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(@Id() id: string): Promise<TicketDto> {
    return this.tickets.toDto(await this.tickets.cancel(id));
  }

  @Post(':id/start-fresh')
  @HttpCode(200)
  async startFresh(@Id() id: string, @Body() body: StartFreshDto): Promise<TicketDto> {
    return this.tickets.toDto(await this.tickets.startFresh(id, body.resetWorktree ?? false));
  }

  @Get(':id/diff')
  diff(@Id() id: string): Promise<DiffDto> {
    return this.tickets.diff(id);
  }
}
