import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppConfig } from '../config/app-config';
import { AgentProcessTracker } from './process-tracker';

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('AgentProcessTracker.killOrphans', () => {
  let dir: string;
  beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'tracker-'))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('kills a recorded claude process and removes its pid file', async () => {
    // The trailing arg makes the command line look like the Claude CLI.
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', 'fake-claude'], { stdio: 'ignore' });
    const exited = new Promise((r) => child.once('exit', r));
    mkdirSync(join(dir, '.agent-pids'));
    writeFileSync(join(dir, '.agent-pids', `ticket-7-${child.pid}.pid`), String(child.pid));

    const tracker = new AgentProcessTracker({ worktreesDir: dir } as AppConfig);
    await expect(tracker.killOrphans()).resolves.toBe(1);
    await exited;
    expect(isAlive(child.pid!)).toBe(false);
    await expect(tracker.killOrphans()).resolves.toBe(0);
  });

  it('never signals a live process that is not the Claude CLI', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    try {
      mkdirSync(join(dir, '.agent-pids'));
      writeFileSync(join(dir, '.agent-pids', `ticket-8-${child.pid}.pid`), String(child.pid));
      const tracker = new AgentProcessTracker({ worktreesDir: dir } as AppConfig);
      await expect(tracker.killOrphans()).resolves.toBe(0);
      expect(isAlive(child.pid!)).toBe(true);
    } finally {
      child.kill('SIGKILL');
    }
  });

  it('returns 0 when there is no pid directory', async () => {
    await expect(new AgentProcessTracker({ worktreesDir: dir } as AppConfig).killOrphans()).resolves.toBe(0);
  });
});
