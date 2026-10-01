import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfig } from '../config/app-config';
import { buildDataSourceOptions } from './db-options';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => buildDataSourceOptions(config.databaseUrl),
    }),
  ],
})
export class DatabaseModule {}
