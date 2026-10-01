import type { ApiError } from '@agent-board/shared';
import { ArgumentsHost, Catch, HttpException, HttpStatus, Logger, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { EntityNotFoundError } from 'typeorm';
import { BaseRepoNotReadyError, MergeConflictError } from '../git/git.types';

function messageFromHttpResponse(res: string | object, fallback: string): string {
  if (typeof res === 'string') return res;
  const m = (res as { message?: unknown }).message;
  if (Array.isArray(m)) return m.map(String).join('; ');
  if (typeof m === 'string' && m) return m;
  return fallback;
}

/** Every error leaves the API as `{ statusCode, message }` with a string message. */
export function toApiError(exception: unknown): ApiError {
  if (exception instanceof HttpException) {
    return {
      statusCode: exception.getStatus(),
      message: messageFromHttpResponse(exception.getResponse(), exception.message),
    };
  }
  if (exception instanceof MergeConflictError || exception instanceof BaseRepoNotReadyError) {
    return { statusCode: HttpStatus.CONFLICT, message: exception.message };
  }
  if (exception instanceof EntityNotFoundError) {
    return { statusCode: HttpStatus.NOT_FOUND, message: 'Not found' };
  }
  return { statusCode: HttpStatus.INTERNAL_SERVER_ERROR, message: 'Internal server error' };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') return;
    const body = toApiError(exception);
    if (body.statusCode >= 500) {
      this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    }
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) return;
    res.status(body.statusCode).json(body);
  }
}
