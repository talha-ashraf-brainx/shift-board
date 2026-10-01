/**
 * Typed, validated configuration. Provided by ConfigModule (see config.module.ts),
 * built once at startup from the environment. Inject it by class:
 *   constructor(private readonly config: AppConfig) {}
 *
 * Never log `anthropicApiKey`.
 */
export abstract class AppConfig {
  abstract readonly databaseUrl: string;
  /** null when not set: the Agent SDK then uses the local `claude` CLI login. */
  abstract readonly anthropicApiKey: string | null;
  /**
   * Optional seed for the first project (TARGET_REPO_PATH): used only on bootstrap when no
   * projects exist yet. null when unset or invalid (a warning is logged).
   */
  abstract readonly targetRepoPath: string | null;
  /** Optional base branch for the seeded project (BASE_BRANCH); null = the repo's current branch. */
  abstract readonly baseBranch: string | null;
  /** Absolute root folder for all worktrees (WORKTREES_DIR). Each project uses <root>/<slug>. Created at startup if missing. */
  abstract readonly worktreesDir: string;
  /** undefined = SDK default model. */
  abstract readonly agentModel: string | undefined;
  abstract readonly agentMaxTurns: number;
  abstract readonly agentExtraAllowedTools: string[];
  abstract readonly pollIntervalMs: number;
  abstract readonly apiPort: number;
  abstract readonly webOrigin: string;
}
