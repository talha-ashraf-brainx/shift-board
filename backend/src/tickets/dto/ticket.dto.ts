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
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { Trim, TrimToNull } from '../../common/transformers';

const MAX_TEXT = 100_000;
const MAX_RULE = 2_000;

/** Trims each rule and drops empty ones and duplicates; non-arrays pass through for the validators. */
const RuleList = () =>
  Transform(({ value }) => {
    if (!Array.isArray(value)) return value;
    const out: unknown[] = [];
    for (const v of value) {
      const t = typeof v === 'string' ? v.trim() : v;
      if (t === '' || out.includes(t)) continue;
      out.push(t);
    }
    return out;
  });

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

  @RuleList()
  @IsOptional()
  @IsArray({ message: 'rules must be an array of strings' })
  @ArrayMaxSize(100)
  @IsString({ each: true, message: 'rules must be an array of strings' })
  @MaxLength(MAX_RULE, { each: true })
  rules?: string[];

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

  @RuleList()
  @IsOptional()
  @IsArray({ message: 'rules must be an array of strings' })
  @ArrayMaxSize(100)
  @IsString({ each: true, message: 'rules must be an array of strings' })
  @MaxLength(MAX_RULE, { each: true })
  rules?: string[];

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
