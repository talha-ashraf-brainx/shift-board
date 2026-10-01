import type { UpdateSettingsInput } from '@agent-board/shared';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateSettingsDto implements UpdateSettingsInput {
  @IsOptional()
  @IsString()
  @MaxLength(100_000)
  globalRules?: string;

  @IsOptional()
  @IsBoolean()
  workerEnabled?: boolean;
}
