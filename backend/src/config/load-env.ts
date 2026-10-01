import { config } from 'dotenv';
import { resolve } from 'node:path';

/** Repo root (one level above backend/). Works from src/config and dist/config. */
export const REPO_ROOT = resolve(__dirname, '../../..');

/**
 * Loads the repo-root .env into process.env (existing variables win).
 * Imported for its side effect as the first import of main.ts, so values are
 * available at decorator-evaluation time (e.g. the gateway's CORS origin).
 */
export function loadRootEnv(): void {
  config({ path: resolve(REPO_ROOT, '.env'), quiet: true });
}

loadRootEnv();
