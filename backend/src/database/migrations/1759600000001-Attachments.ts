import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Image attachments: metadata rows for objects stored in the S3 bucket. */
export class Attachments1759600000001 implements MigrationInterface {
  name = 'Attachments1759600000001';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "attachments" (
        "id" uuid NOT NULL,
        "storage_key" character varying(300) NOT NULL,
        "original_filename" character varying(255) NOT NULL,
        "content_type" character varying(100) NOT NULL,
        "size_bytes" integer NOT NULL,
        "width" integer,
        "height" integer,
        "ticket_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_attachments_storage_key" UNIQUE ("storage_key"),
        CONSTRAINT "PK_attachments_id" PRIMARY KEY ("id")
      )`);
    await q.query(`CREATE INDEX "IDX_attachments_ticket_id" ON "attachments" ("ticket_id")`);
    await q.query(
      `ALTER TABLE "attachments" ADD CONSTRAINT "FK_attachments_ticket_id" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "attachments" DROP CONSTRAINT "FK_attachments_ticket_id"`);
    await q.query(`DROP INDEX "public"."IDX_attachments_ticket_id"`);
    await q.query(`DROP TABLE "attachments"`);
  }
}
