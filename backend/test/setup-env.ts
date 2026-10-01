import 'reflect-metadata';
import { config } from 'dotenv';
import { resolve } from 'node:path';

// Load the repo-root .env so TEST_DATABASE_URL etc. are available to tests.
config({ path: resolve(__dirname, '../../.env'), quiet: true });

// Auth is opt-in per test (see auth.e2e.test.ts): a BOARD_TOKEN in the developer's .env must not 401 the other suites.
delete process.env.BOARD_TOKEN;
