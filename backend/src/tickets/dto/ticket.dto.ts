import {
  TicketPriority,
  TicketStatus,
  type AnswerInput,
  type CreateTicketInput,
  type ListTicketsQuery,
  type RejectInput,
  type RetryInput,
  type UpdateTicketInput,
} from '@agent-board/shared';
import { IsBoolean, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';
import { Trim, TrimToNull } from '../../common/transformers';

const MAX_TEXT = 100_000;

export class CreateTicketDto implements CreateTicketInput {
  @IsNotEmpty({ message: 'projectId is required' })
  @IsUUID('all', { message: 'projectId must be a UUID' })
  projectId!: string;

  @Trim()
  @IsString()
  @Length(1, 200, { message: 'title must be between 1 and 200 characters' })
  title!: string;

  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'description is required' })
  @MaxLength(MAX_TEXT)
  description!: string;

  @TrimToNull()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TEXT)
  context?: string | null;

  @TrimToNull()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TEXT)
  rules?: string | null;

  @IsOptional()
  @IsEnum(TicketPriority, { message: `priority must be one of: ${Object.values(TicketPriority).join(', ')}` })
  priority?: TicketPriority;
}

export class UpdateTicketDto implements UpdateTicketInput {
  @IsOptional()
  @Trim()
  @IsString()
  @Length(1, 200, { message: 'title must be between 1 and 200 characters' })
  title?: string;

  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'description must not be empty' })
  @MaxLength(MAX_TEXT)
  description?: string;

  @TrimToNull()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TEXT)
  context?: string | null;

  @TrimToNull()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TEXT)
  rules?: string | null;

  @IsOptional()
  @IsEnum(TicketPriority, { message: `priority must be one of: ${Object.values(TicketPriority).join(', ')}` })
  priority?: TicketPriority;

  @IsOptional()
  @IsInt()
  position?: number;
}

export class ListTicketsQueryDto implements ListTicketsQuery {
  @IsOptional()
  @IsUUID('all', { message: 'projectId must be a UUID' })
  projectId?: string;

  @IsOptional()
  @IsEnum(TicketStatus, { message: `status must be one of: ${Object.values(TicketStatus).join(', ')}` })
  status?: TicketStatus;

  @IsOptional()
  @IsEnum(TicketPriority, { message: `priority must be one of: ${Object.values(TicketPriority).join(', ')}` })
  priority?: TicketPriority;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(200)
  q?: string;
}

export class AnswerDto implements AnswerInput {
  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'message is required' })
  @MaxLength(MAX_TEXT)
  message!: string;
}

export class RejectDto implements RejectInput {
  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'feedback is required' })
  @MaxLength(MAX_TEXT)
  feedback!: string;
}

export class RetryDto implements RetryInput {
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(MAX_TEXT)
  note?: string;
}

export class StartFreshDto {
  @IsOptional()
  @IsBoolean()
  resetWorktree?: boolean;
}
