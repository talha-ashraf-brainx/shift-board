import 'reflect-metadata';
import { config } from 'dotenv';
import { resolve } from 'node:path';

// Load the repo-root .env so TEST_DATABASE_URL etc. are available to tests.
config({ path: resolve(__dirname, '../../.env'), quiet: true });
