import type { UpdateSettingsInput } from '@agent-board/shared';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, IsUrl, MaxLength, ValidateIf } from 'class-validator';

export class UpdateSettingsDto implements UpdateSettingsInput {
  @IsOptional()
  @IsString()
  @MaxLength(100_000)
  globalRules?: string;

  @IsOptional()
  @IsBoolean()
  workerEnabled?: boolean;

  /** null or "" clears it; otherwise an http(s) URL of at most 2000 characters. */
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @ValidateIf((_o, v) => v !== undefined && v !== null && v !== '')
  @IsString()
  @MaxLength(2000)
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true, require_tld: false },
    { message: 'notifyWebhookUrl must be an http:// or https:// URL' },
  )
  notifyWebhookUrl?: string | null;
}
