import type * as ClaudeAgentSdk from '@anthropic-ai/claude-agent-sdk' with { 'resolution-mode': 'import' };

/** The `@anthropic-ai/claude-agent-sdk` module namespace. */
export type ClaudeSdk = typeof ClaudeAgentSdk;

let cached: Promise<ClaudeSdk> | null = null;

/**
 * Loads the ESM-only Agent SDK from this CommonJS backend. With
 * `module: Node16`, TypeScript keeps `import()` as a real dynamic import, so
 * Node loads `sdk.mjs` natively. The module is cached after the first call.
 * Tests replace this file with `jest.mock('./sdk-loader')`.
 */
export function loadSdk(): Promise<ClaudeSdk> {
  if (!cached) {
    cached = import('@anthropic-ai/claude-agent-sdk').catch((err: unknown) => {
      cached = null;
      throw err;
    });
  }
  return cached;
}
