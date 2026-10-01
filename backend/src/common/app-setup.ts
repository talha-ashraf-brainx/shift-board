import { ValidationPipe, type INestApplication } from '@nestjs/common';
import type { AppConfig } from '../config/app-config';
import { AllExceptionsFilter } from './all-exceptions.filter';

/** Shared by main.ts and the e2e tests. */
export function configureApp(app: INestApplication, config: AppConfig): void {
  app.setGlobalPrefix('api');
  app.enableCors({ origin: config.webOrigin });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
}
