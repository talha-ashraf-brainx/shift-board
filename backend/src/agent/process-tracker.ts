import { Injectable, Logger } from '@nestjs/common';
import { execFile, spawn } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { SpawnOptions, SpawnedProcess } from '@anthropic-ai/claude-agent-sdk' with { 'resolution-mode': 'import' };
import { AppConfig } from '../config/app-config';

const execFileAsync = promisify(execFile);

/**
 * Spawns the Claude Code CLI for each agent run and records its PID on disk.
 *
 * If the API dies hard (SIGKILL, crash), the CLI child is orphaned and keeps
 * editing the worktree. On the next boot, `killOrphans()` stops any recorded
 * process that is still alive *before* crash recovery requeues its ticket, so
 * two agents never work in the same worktree.
 */
@Injectable()
export class AgentProcessTracker {
  private readonly logger = new Logger(AgentProcessTracker.name);
  private readonly pidDir: string;

  constructor(config: AppConfig) {
    this.pidDir = join(config.worktreesDir, '.agent-pids');
  }

  /** A `spawnClaudeCodeProcess` implementation that tracks the child's PID. */
  spawnFor(ticketNumber: number, onStderr?: (data: string) => void): (options: SpawnOptions) => SpawnedProcess {
    return (options) => {
      const child = spawn(options.command, options.args, {
        cwd: options.cwd,
        env: options.env as NodeJS.ProcessEnv,
        signal: options.signal,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      if (onStderr) child.stderr.on('data', (chunk: Buffer) => onStderr(chunk.toString()));
      else child.stderr.resume();

      const pidFile = join(this.pidDir, `ticket-${ticketNumber}-${child.pid ?? 'unknown'}.pid`);
      if (child.pid) {
        try {
          mkdirSync(this.pidDir, { recursive: true });
          writeFileSync(pidFile, String(child.pid));
        } catch (err) {
          this.logger.warn(`Could not record agent PID: ${(err as Error).message}`);
        }
      }
      child.once('exit', () => rmSync(pidFile, { force: true }));
      return child as unknown as SpawnedProcess;
    };
  }

  /** Kills agent processes left over from a previous API process. Returns how many were stopped. */
  async killOrphans(): Promise<number> {
    let files: string[];
    try {
      files = readdirSync(this.pidDir).filter((f) => f.endsWith('.pid'));
    } catch {
      return 0;
    }
    let killed = 0;
    for (const file of files) {
      const path = join(this.pidDir, file);
      const pid = Number.parseInt(readFileSync(path, 'utf8'), 10);
      rmSync(path, { force: true });
      if (!Number.isInteger(pid) || pid <= 1 || !(await this.isClaudeProcess(pid))) continue;
      this.logger.warn(`Stopping orphaned agent process ${pid} (${file})`);
      try {
        process.kill(pid, 'SIGTERM');
        await waitForExit(pid, 3000);
        if (isAlive(pid)) process.kill(pid, 'SIGKILL');
        killed++;
      } catch {
        // Already gone.
      }
    }
    return killed;
  }

  /** Guards against PID reuse: only signal a live process that looks like the Claude Code CLI. */
  private async isClaudeProcess(pid: number): Promise<boolean> {
    if (!isAlive(pid)) return false;
    try {
      const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'command=']);
      return /claude/i.test(stdout);
    } catch {
      return false;
    }
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (isAlive(pid) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
}
