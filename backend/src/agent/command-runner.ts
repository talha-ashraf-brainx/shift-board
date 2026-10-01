import { execFile } from 'node:child_process';

/** Output kept from a setup/check command: the end is where test runners print failures. */
export const COMMAND_OUTPUT_TAIL = 8_000;

export interface CommandResult {
  ok: boolean;
  /** Exit code, or null when the command was killed (timeout) or could not start. */
  exitCode: number | null;
  timedOut: boolean;
  /** stdout and stderr, interleaved in arrival order, trimmed to the last COMMAND_OUTPUT_TAIL characters. */
  output: string;
  durationMs: number;
}

/**
 * Runs a project's setup or check command in the worktree. The command is written by the board
 * owner in the project settings (never by ticket text or the agent), so it goes through `sh -c`
 * to allow `&&`, pipes and env vars.
 */
export function runProjectCommand(
  command: string,
  cwd: string,
  opts: { timeoutMs: number; signal?: AbortSignal },
): Promise<CommandResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    let output = '';
    const child = execFile('/bin/sh', ['-c', command], {
      cwd,
      timeout: opts.timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, CI: 'true', FORCE_COLOR: '0' },
      signal: opts.signal,
      windowsHide: true,
    });
    const append = (chunk: Buffer | string) => {
      output = (output + chunk.toString()).slice(-COMMAND_OUTPUT_TAIL);
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    child.on('error', (err) => {
      append(`\n${err.message}`);
    });
    child.on('close', (code, signal) => {
      const timedOut = code === null && signal === 'SIGTERM' && Date.now() - started >= opts.timeoutMs;
      resolve({
        ok: code === 0,
        exitCode: code,
        timedOut,
        output: output.trim(),
        durationMs: Date.now() - started,
      });
    });
  });
}

/** "pnpm test passed in 12s" / "pnpm test failed (exit 1) after 40s" / "… timed out after 600s". */
export function describeCommandResult(label: string, r: CommandResult): string {
  const secs = `${Math.max(1, Math.round(r.durationMs / 1000))}s`;
  if (r.ok) return `${label} passed in ${secs}`;
  if (r.timedOut) return `${label} timed out after ${secs}`;
  return `${label} failed (exit ${r.exitCode ?? 'killed'}) after ${secs}`;
}
