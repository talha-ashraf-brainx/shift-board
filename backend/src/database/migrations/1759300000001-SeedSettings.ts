import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedSettings1759300000001 implements MigrationInterface {
  name = 'SeedSettings1759300000001';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `INSERT INTO "settings" ("key", "value") VALUES ('globalRules', '""'::jsonb), ('workerEnabled', 'true'::jsonb)
       ON CONFLICT ("key") DO NOTHING`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM "settings" WHERE "key" IN ('globalRules', 'workerEnabled')`);
  }
}
