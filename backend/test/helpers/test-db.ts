import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from '../../src/database/db-options';

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL must be set (repo-root .env) to run DB tests');
  return url;
}

/** Drops the public schema of the test DB and runs every migration. */
export async function resetTestDatabase(): Promise<void> {
  const ds = new DataSource(buildDataSourceOptions(testDatabaseUrl()));
  await ds.initialize();
  try {
    await ds.query('DROP SCHEMA IF EXISTS public CASCADE');
    await ds.query('CREATE SCHEMA public');
    await ds.runMigrations({ transaction: 'all' });
  } finally {
    await ds.destroy();
  }
}

/** Empties projects/tickets/events and restores the seeded settings. */
export async function truncateAll(ds: DataSource): Promise<void> {
  await ds.query('TRUNCATE ticket_events, tickets, projects RESTART IDENTITY CASCADE');
  await ds.query(`DELETE FROM settings`);
  await ds.query(
    `INSERT INTO settings (key, value) VALUES ('globalRules', '""'::jsonb), ('workerEnabled', 'true'::jsonb)`,
  );
}

export interface TempRepo {
  repoPath: string;
  worktreesDir: string;
  cleanup(): void;
}

/** A throwaway git repo on `main` with one commit, plus a worktrees dir outside it. */
export function createTempGitRepo(): TempRepo {
  const root = mkdtempSync(join(tmpdir(), 'agent-board-test-'));
  const repoPath = join(root, 'repo');
  const worktreesDir = join(root, 'worktrees');
  execFileSync('git', ['init', '-q', '-b', 'main', repoPath]);
  writeFileSync(join(repoPath, 'README.md'), '# test repo\n');
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd: repoPath });
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  return { repoPath, worktreesDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** Inserts a project row directly (no repo validation). Returns its id. */
export async function insertTestProject(
  ds: DataSource,
  p: { name?: string; slug?: string; repoPath?: string; baseBranch?: string } = {},
): Promise<string> {
  const name = p.name ?? 'test-project';
  const rows = (await ds.query(
    `INSERT INTO projects (name, slug, repo_path, base_branch) VALUES ($1, $2, $3, $4) RETURNING id`,
    [name, p.slug ?? name, p.repoPath ?? `/tmp/${name}`, p.baseBranch ?? 'main'],
  )) as Array<{ id: string }>;
  return rows[0]!.id;
}
