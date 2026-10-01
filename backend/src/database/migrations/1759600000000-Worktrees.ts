import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Shared worktrees: each project owns one or more and marks one active; tickets record the
 * worktree they run in. Default worktree rows are created at boot (their paths depend on WORKTREES_DIR).
 */
export class Worktrees1759600000000 implements MigrationInterface {
  name = 'Worktrees1759600000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "worktrees" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL,
        "name" character varying(40) NOT NULL,
        "slug" character varying(60) NOT NULL,
        "path" character varying NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_worktrees_project_slug" UNIQUE ("project_id", "slug"),
        CONSTRAINT "PK_worktrees_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_worktrees_project_id" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE
      )`);
    await q.query(`ALTER TABLE "projects" ADD "active_worktree_id" uuid`);
    await q.query(
      `ALTER TABLE "projects" ADD CONSTRAINT "FK_projects_active_worktree_id" FOREIGN KEY ("active_worktree_id") REFERENCES "worktrees"("id") ON DELETE SET NULL`,
    );
    await q.query(`ALTER TABLE "tickets" ADD "worktree_id" uuid`);
    await q.query(
      `ALTER TABLE "tickets" ADD CONSTRAINT "FK_tickets_worktree_id" FOREIGN KEY ("worktree_id") REFERENCES "worktrees"("id") ON DELETE SET NULL`,
    );
    await q.query(`CREATE INDEX "IDX_tickets_worktree_status" ON "tickets" ("worktree_id", "status")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX "public"."IDX_tickets_worktree_status"`);
    await q.query(`ALTER TABLE "tickets" DROP CONSTRAINT "FK_tickets_worktree_id"`);
    await q.query(`ALTER TABLE "tickets" DROP COLUMN "worktree_id"`);
    await q.query(`ALTER TABLE "projects" DROP CONSTRAINT "FK_projects_active_worktree_id"`);
    await q.query(`ALTER TABLE "projects" DROP COLUMN "active_worktree_id"`);
    await q.query(`DROP TABLE "worktrees"`);
  }
}
