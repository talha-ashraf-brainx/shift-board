import type { LoginInput } from '@agent-board/shared';
import { IsString, MaxLength } from 'class-validator';

export class LoginDto implements LoginInput {
  @IsString()
  @MaxLength(1024)
  token!: string;
}
