import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Per-project setup/check commands and spending limits (project default, ticket override). */
export class WorkerLimits1759700000000 implements MigrationInterface {
  name = 'WorkerLimits1759700000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "projects" ADD "setup_command" text`);
    await q.query(`ALTER TABLE "projects" ADD "check_command" text`);
    await q.query(`ALTER TABLE "projects" ADD "max_budget_usd" numeric(10,2)`);
    await q.query(`ALTER TABLE "tickets" ADD "max_budget_usd" numeric(10,2)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "tickets" DROP COLUMN "max_budget_usd"`);
    await q.query(`ALTER TABLE "projects" DROP COLUMN "max_budget_usd"`);
    await q.query(`ALTER TABLE "projects" DROP COLUMN "check_command"`);
    await q.query(`ALTER TABLE "projects" DROP COLUMN "setup_command"`);
  }
}
