import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { AppConfig } from './app-config';

export class ConfigValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(
      `Invalid configuration (check the repo-root .env):\n${problems.map((p) => `  - ${p}`).join('\n')}`,
    );
    this.name = 'ConfigValidationError';
  }
}

/** Default values for optional variables (poc.md). */
export const CONFIG_DEFAULTS = {
  agentMaxTurns: 60,
  pollIntervalMs: 3000,
  apiPort: 3000,
  webOrigin: 'http://localhost:5173',
} as const;

/**
 * Splits a comma-separated tool list, ignoring commas inside parentheses:
 * "Bash(npm test:*),Bash(node:*)" -> ["Bash(npm test:*)", "Bash(node:*)"].
 */
export function parseToolList(raw: string | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of raw) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out.map((s) => s.trim()).filter((s) => s.length > 0);
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function realpathOrResolve(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

type Env = Record<string, string | undefined>;

/**
 * Validates the environment and builds the AppConfig. Collects every problem
 * and throws one ConfigValidationError listing them all. Never logs the API key.
 */
export function buildAppConfig(env: Env = process.env, logger = new Logger('Config')): AppConfig {
  const problems: string[] = [];
  const str = (name: string): string | undefined => {
    const v = env[name]?.trim();
    return v ? v : undefined;
  };
  const required = (name: string): string => {
    const v = str(name);
    if (!v) problems.push(`${name} is required`);
    return v ?? '';
  };
  const positiveInt = (name: string, def: number, max = Number.MAX_SAFE_INTEGER): number => {
    const v = str(name);
    if (v === undefined) return def;
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0 || n > max) {
      problems.push(`${name} must be a positive integer${max < Number.MAX_SAFE_INTEGER ? ` <= ${max}` : ''} (got "${v}")`);
      return def;
    }
    return n;
  };

  const databaseUrl = required('DATABASE_URL');
  if (databaseUrl) {
    try {
      const u = new URL(databaseUrl);
      if (!/^postgres(ql)?:$/.test(u.protocol)) problems.push('DATABASE_URL must be a postgres:// URL');
    } catch {
      problems.push('DATABASE_URL is not a valid URL');
    }
  }

  const baseBranch = str('BASE_BRANCH') ?? null;

  // TARGET_REPO_PATH only seeds a default project, so problems with it are warnings, not errors.
  const seedWarnings: string[] = [];
  let targetRepoPath: string | null = str('TARGET_REPO_PATH') ?? null;
  if (targetRepoPath) {
    if (!isAbsolute(targetRepoPath)) {
      seedWarnings.push(`TARGET_REPO_PATH must be an absolute path (got "${targetRepoPath}")`);
      targetRepoPath = null;
    } else if (!existsSync(targetRepoPath) || !statSync(targetRepoPath).isDirectory()) {
      seedWarnings.push(`TARGET_REPO_PATH does not exist or is not a directory: ${targetRepoPath}`);
      targetRepoPath = null;
    } else {
      try {
        const out = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
          cwd: targetRepoPath,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        }).trim();
        if (out !== 'true') throw new Error('not a work tree');
        targetRepoPath = realpathSync(targetRepoPath);
      } catch {
        seedWarnings.push(`TARGET_REPO_PATH is not a git repository: ${targetRepoPath}`);
        targetRepoPath = null;
      }
    }
  }

  let worktreesDir = required('WORKTREES_DIR');
  if (worktreesDir) {
    if (!isAbsolute(worktreesDir)) {
      problems.push(`WORKTREES_DIR must be an absolute path (got "${worktreesDir}")`);
    } else {
      try {
        mkdirSync(worktreesDir, { recursive: true });
        worktreesDir = realpathSync(worktreesDir);
      } catch (e) {
        problems.push(`WORKTREES_DIR could not be created: ${(e as Error).message}`);
      }
      if (targetRepoPath && isInside(targetRepoPath, realpathOrResolve(worktreesDir))) {
        seedWarnings.push(`WORKTREES_DIR must be outside TARGET_REPO_PATH (got ${worktreesDir})`);
        targetRepoPath = null;
      }
    }
  }

  const agentMaxTurns = positiveInt('AGENT_MAX_TURNS', CONFIG_DEFAULTS.agentMaxTurns);
  const pollIntervalMs = positiveInt('POLL_INTERVAL_MS', CONFIG_DEFAULTS.pollIntervalMs);
  const apiPort = positiveInt('API_PORT', CONFIG_DEFAULTS.apiPort, 65535);
  const webOrigin = str('WEB_ORIGIN') ?? CONFIG_DEFAULTS.webOrigin;
  const agentModel = str('AGENT_MODEL');
  const agentExtraAllowedTools = parseToolList(env.AGENT_EXTRA_ALLOWED_TOOLS);
  const anthropicApiKey = str('ANTHROPIC_API_KEY') ?? null;

  if (problems.length > 0) throw new ConfigValidationError(problems);

  for (const w of seedWarnings) logger.warn(`${w}; no default project will be seeded from it.`);
  if (!anthropicApiKey) {
    logger.warn(
      'ANTHROPIC_API_KEY is not set: the Agent SDK will use the local `claude` CLI login (documented deviation from the spec).',
    );
  }

  const values = {
    databaseUrl,
    anthropicApiKey,
    targetRepoPath,
    baseBranch,
    worktreesDir,
    agentModel,
    agentMaxTurns,
    agentExtraAllowedTools,
    pollIntervalMs,
    apiPort,
    webOrigin,
  };
  return Object.freeze(Object.assign(Object.create(AppConfig.prototype) as AppConfig, values));
}

let cached: AppConfig | null = null;

/** Validated config for this process, built once (main.ts calls it before Nest boots). */
export function getAppConfig(): AppConfig {
  if (!cached) cached = buildAppConfig(process.env);
  return cached;
}

/** Tests only: forget the cached config so the next getAppConfig() re-reads process.env. */
export function resetAppConfigCache(): void {
  cached = null;
}
