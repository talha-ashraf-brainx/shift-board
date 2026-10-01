import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { createAuthMiddleware } from '../auth/auth.middleware';
import { AuthService } from '../auth/auth.service';
import type { AppConfig } from '../config/app-config';
import { AllExceptionsFilter } from './all-exceptions.filter';

/** Shared by main.ts and the e2e tests. */
export function configureApp(app: INestApplication, config: AppConfig): void {
  app.setGlobalPrefix('api');
  app.enableCors({ origin: config.webOrigin });
  // Before any route: with BOARD_TOKEN set, every request except /api/auth/* needs the token.
  app.use(createAuthMiddleware(app.get(AuthService)));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
}
