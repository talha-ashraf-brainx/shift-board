import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tickets drop the free-form `context` field (any existing text is appended to the description)
 * and `rules` becomes a list of separate entries.
 */
export class TicketRulesList1759500000000 implements MigrationInterface {
  name = 'TicketRulesList1759500000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      UPDATE "tickets" SET "description" = "description" || E'\\n\\n## Context\\n' || btrim("context")
      WHERE "context" IS NOT NULL AND btrim("context") <> ''`);
    await q.query(`ALTER TABLE "tickets" DROP COLUMN "context"`);
    await q.query(`
      ALTER TABLE "tickets" ALTER COLUMN "rules" TYPE text array
      USING CASE WHEN "rules" IS NULL OR btrim("rules") = '' THEN '{}'::text[] ELSE ARRAY[btrim("rules")] END`);
    await q.query(`ALTER TABLE "tickets" ALTER COLUMN "rules" SET DEFAULT '{}'`);
    await q.query(`ALTER TABLE "tickets" ALTER COLUMN "rules" SET NOT NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "tickets" ALTER COLUMN "rules" DROP NOT NULL`);
    await q.query(`ALTER TABLE "tickets" ALTER COLUMN "rules" DROP DEFAULT`);
    await q.query(`
      ALTER TABLE "tickets" ALTER COLUMN "rules" TYPE text
      USING CASE WHEN cardinality("rules") = 0 THEN NULL ELSE array_to_string("rules", E'\\n') END`);
    await q.query(`ALTER TABLE "tickets" ADD "context" text`);
  }
}
