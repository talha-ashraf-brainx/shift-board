import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Multi-project support: `projects` table and tickets.project_id (nullable for legacy rows). */
export class Projects1759400000000 implements MigrationInterface {
  name = 'Projects1759400000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "projects" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" character varying(100) NOT NULL,
        "slug" character varying(120) NOT NULL,
        "repo_path" character varying NOT NULL,
        "base_branch" character varying NOT NULL,
        "rules" text,
        "extra_allowed_tools" text array NOT NULL DEFAULT '{}',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_projects_name" UNIQUE ("name"),
        CONSTRAINT "UQ_projects_slug" UNIQUE ("slug"),
        CONSTRAINT "UQ_projects_repo_path" UNIQUE ("repo_path"),
        CONSTRAINT "PK_projects_id" PRIMARY KEY ("id")
      )`);
    await q.query(`ALTER TABLE "tickets" ADD "project_id" uuid`);
    await q.query(
      `ALTER TABLE "tickets" ADD CONSTRAINT "FK_tickets_project_id" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await q.query(`DROP INDEX "public"."IDX_tickets_queue"`);
    await q.query(
      `CREATE INDEX "IDX_tickets_queue" ON "tickets" ("project_id", "status", "priority", "position", "created_at")`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX "public"."IDX_tickets_queue"`);
    await q.query(`CREATE INDEX "IDX_tickets_queue" ON "tickets" ("status", "priority", "position", "created_at")`);
    await q.query(`ALTER TABLE "tickets" DROP CONSTRAINT "FK_tickets_project_id"`);
    await q.query(`ALTER TABLE "tickets" DROP COLUMN "project_id"`);
    await q.query(`DROP TABLE "projects"`);
  }
}
