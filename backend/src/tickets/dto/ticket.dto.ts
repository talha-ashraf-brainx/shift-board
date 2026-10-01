import {
  TicketPriority,
  TicketStatus,
  type AnswerInput,
  type CreateTicketInput,
  type ListTicketsQuery,
  type QuestionAnswer,
  type RejectInput,
  type RetryInput,
  type UpdateTicketInput,
} from '@agent-board/shared';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateBy,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
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

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(200, { message: 'title must be at most 200 characters' })
  title?: string;

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
  @MaxLength(200, { message: 'title must be at most 200 characters' })
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

export class QuestionAnswerDto implements QuestionAnswer {
  @Trim()
  @IsString()
  @MaxLength(MAX_TEXT)
  question!: string;

  @RuleList()
  @IsArray({ message: 'selected must be an array of strings' })
  @ArrayMaxSize(10)
  @IsString({ each: true, message: 'selected must be an array of strings' })
  @MaxLength(MAX_RULE, { each: true })
  selected!: string[];

  @IsOptional()
  @TrimToNull()
  @IsString()
  @MaxLength(MAX_TEXT)
  other?: string | null;
}

/** True when at least one structured answer picks an option or has typed text. */
export function hasAnswerContent(answers: QuestionAnswer[] | undefined): boolean {
  return (answers ?? []).some(
    (a) => (Array.isArray(a?.selected) && a.selected.length > 0) || (typeof a?.other === 'string' && a.other.trim() !== ''),
  );
}

/**
 * `message` is required unless `answers` carries at least one non-empty answer (then it is the
 * optional extra note). One validator, so a missing message reports a single readable error.
 */
const AnswerMessage = () =>
  ValidateBy({
    name: 'answerMessage',
    validator: {
      validate: (value, args) => {
        if (value === undefined || value === null || value === '') return hasAnswerContent((args?.object as AnswerDto).answers);
        return typeof value === 'string' && value.length <= MAX_TEXT;
      },
      defaultMessage: (args) => {
        const value: unknown = args?.value;
        if (value === undefined || value === null || value === '') return 'message or answers is required';
        return typeof value === 'string' ? `message must be at most ${MAX_TEXT} characters` : 'message must be a string';
      },
    },
  });

export class AnswerDto implements AnswerInput {
  @Trim()
  @AnswerMessage()
  message?: string;

  @IsOptional()
  @IsArray({ message: 'answers must be an array' })
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => QuestionAnswerDto)
  answers?: QuestionAnswerDto[];
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
