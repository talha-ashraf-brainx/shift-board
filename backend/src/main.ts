// Must stay first: loads the repo-root .env before any decorator reads process.env.
import './config/load-env';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './common/app-setup';
import { AppConfig } from './config/app-config';
import { ConfigValidationError, getAppConfig } from './config/env-validation';

async function bootstrap(): Promise<void> {
  // Validate before Nest boots so a bad env fails fast with one readable message.
  let config: AppConfig;
  try {
    config = getAppConfig();
  } catch (e) {
    if (e instanceof ConfigValidationError) {
      console.error(`\n${e.message}\n`);
      process.exit(1);
    }
    throw e;
  }

  const app = await NestFactory.create(AppModule);
  configureApp(app, config);
  await app.listen(config.apiPort);
  new Logger('Bootstrap').log(`Shiftboard API listening on http://localhost:${config.apiPort}/api`);
}

bootstrap().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
