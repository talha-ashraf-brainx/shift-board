import { Global, Module } from '@nestjs/common';
import { AppConfig } from './app-config';
import { getAppConfig } from './env-validation';

/** Provides the validated, typed AppConfig (inject it by class). */
@Global()
@Module({
  providers: [{ provide: AppConfig, useFactory: (): AppConfig => getAppConfig() }],
  exports: [AppConfig],
})
export class ConfigModule {}
