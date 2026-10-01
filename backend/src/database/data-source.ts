import 'reflect-metadata';
import '../config/load-env';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from './db-options';

/** TypeORM CLI data source (`pnpm db:migrate`). Reads DATABASE_URL from the repo-root .env. */
const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL is not set (expected in the repo-root .env)');
}

export default new DataSource(buildDataSourceOptions(url));
