import type { MigrationInterface, QueryRunner } from 'typeorm';

export class Init1759300000000 implements MigrationInterface {
  name = 'Init1759300000000';

  public async up(q: QueryRunner): Promise<void> {
    // Enum value order matters: Postgres sorts enums in declaration order (urgent first).
    await q.query(`CREATE TYPE "public"."ticket_priority" AS ENUM('urgent', 'high', 'medium', 'low')`);
    await q.query(
      `CREATE TYPE "public"."ticket_status" AS ENUM('pending', 'in_progress', 'needs_context', 'review', 'done', 'failed', 'cancelled')`,
    );
    await q.query(
      `CREATE TYPE "public"."ticket_event_type" AS ENUM('created', 'status_changed', 'agent_question', 'human_answer', 'agent_summary', 'review_rejected', 'review_approved', 'agent_log', 'error')`,
    );
    await q.query(`CREATE TYPE "public"."event_author" AS ENUM('human', 'agent', 'system')`);

    await q.query(`
      CREATE TABLE "tickets" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "number" SERIAL NOT NULL,
        "title" character varying(200) NOT NULL,
        "description" text NOT NULL,
        "context" text,
        "rules" text,
        "priority" "public"."ticket_priority" NOT NULL DEFAULT 'medium',
        "status" "public"."ticket_status" NOT NULL DEFAULT 'pending',
        "session_id" character varying,
        "branch_name" character varying,
        "worktree_path" character varying,
        "agent_summary" text,
        "attempt_count" integer NOT NULL DEFAULT '0',
        "last_error" text,
        "total_cost_usd" numeric(10,4) NOT NULL DEFAULT '0',
        "locked_at" TIMESTAMP WITH TIME ZONE,
        "position" integer NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_tickets_number" UNIQUE ("number"),
        CONSTRAINT "PK_tickets_id" PRIMARY KEY ("id")
      )`);
    await q.query(
      `CREATE INDEX "IDX_tickets_queue" ON "tickets" ("status", "priority", "position", "created_at")`,
    );

    await q.query(`
      CREATE TABLE "ticket_events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "ticket_id" uuid NOT NULL,
        "type" "public"."ticket_event_type" NOT NULL,
        "author" "public"."event_author" NOT NULL,
        "body" text NOT NULL,
        "meta" jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(),
        CONSTRAINT "PK_ticket_events_id" PRIMARY KEY ("id")
      )`);
    await q.query(`CREATE INDEX "IDX_ticket_events_ticket_id" ON "ticket_events" ("ticket_id")`);
    await q.query(
      `ALTER TABLE "ticket_events" ADD CONSTRAINT "FK_ticket_events_ticket_id" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await q.query(`
      CREATE TABLE "settings" (
        "key" character varying(100) NOT NULL,
        "value" jsonb NOT NULL,
        CONSTRAINT "PK_settings_key" PRIMARY KEY ("key")
      )`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "settings"`);
    await q.query(`ALTER TABLE "ticket_events" DROP CONSTRAINT "FK_ticket_events_ticket_id"`);
    await q.query(`DROP INDEX "public"."IDX_ticket_events_ticket_id"`);
    await q.query(`DROP TABLE "ticket_events"`);
    await q.query(`DROP INDEX "public"."IDX_tickets_queue"`);
    await q.query(`DROP TABLE "tickets"`);
    await q.query(`DROP TYPE "public"."event_author"`);
    await q.query(`DROP TYPE "public"."ticket_event_type"`);
    await q.query(`DROP TYPE "public"."ticket_status"`);
    await q.query(`DROP TYPE "public"."ticket_priority"`);
  }
}
