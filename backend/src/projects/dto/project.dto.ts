import type { CreateProjectInput, CreateWorktreeInput, UpdateProjectInput } from '@agent-board/shared';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, Length, Max, MaxLength } from 'class-validator';
import { Trim, TrimToNull } from '../../common/transformers';

const MAX_TEXT = 100_000;

/** Trims each tool, drops empty entries and duplicates. */
const ToolList = () =>
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

export class CreateProjectDto implements CreateProjectInput {
  @Trim()
  @IsString()
  @Length(1, 100, { message: 'name must be between 1 and 100 characters' })
  name!: string;

  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'repoPath is required' })
  @MaxLength(4096)
  repoPath!: string;

  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'baseBranch is required' })
  @MaxLength(255)
  baseBranch!: string;

  @TrimToNull()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TEXT)
  rules?: string | null;

  @ToolList()
  @IsOptional()
  @IsArray({ message: 'extraAllowedTools must be an array of strings' })
  @ArrayMaxSize(100)
  @IsString({ each: true, message: 'extraAllowedTools must be an array of strings' })
  @MaxLength(500, { each: true })
  extraAllowedTools?: string[];

  @TrimToNull()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  setupCommand?: string | null;

  @TrimToNull()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  checkCommand?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'maxBudgetUsd must be a dollar amount' })
  @IsPositive({ message: 'maxBudgetUsd must be more than 0' })
  @Max(10_000)
  maxBudgetUsd?: number | null;
}

export class UpdateProjectDto implements UpdateProjectInput {
  @IsOptional()
  @Trim()
  @IsString()
  @Length(1, 100, { message: 'name must be between 1 and 100 characters' })
  name?: string;

  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'baseBranch must not be empty' })
  @MaxLength(255)
  baseBranch?: string;

  @TrimToNull()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TEXT)
  rules?: string | null;

  @ToolList()
  @IsOptional()
  @IsArray({ message: 'extraAllowedTools must be an array of strings' })
  @ArrayMaxSize(100)
  @IsString({ each: true, message: 'extraAllowedTools must be an array of strings' })
  @MaxLength(500, { each: true })
  extraAllowedTools?: string[];

  @TrimToNull()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  setupCommand?: string | null;

  @TrimToNull()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  checkCommand?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'maxBudgetUsd must be a dollar amount' })
  @IsPositive({ message: 'maxBudgetUsd must be more than 0' })
  @Max(10_000)
  maxBudgetUsd?: number | null;
}

export class CreateWorktreeDto implements CreateWorktreeInput {
  @Trim()
  @IsString()
  @Length(1, 40, { message: 'name must be between 1 and 40 characters' })
  name!: string;
}

export class InspectQueryDto {
  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'path is required' })
  @MaxLength(4096)
  path!: string;
}
