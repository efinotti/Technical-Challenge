import { Migration } from '@mikro-orm/migrations';

/** Adds database-enforced invariants plus durable Inbox/Outbox storage. */
export class Migration20261101170000 extends Migration {
  override name = 'Migration20261101170000';

  override async up(): Promise<void> {
    this.addSql(`UPDATE "wallet" SET "version" = 1 WHERE "version" < 1;`);
    this.addSql(`ALTER TABLE "wallet" ALTER COLUMN "version" SET DEFAULT 1;`);
    this.addSql(`ALTER TABLE "wallet" ADD CONSTRAINT "wallet_balance_nonnegative_check" CHECK ("balance" >= 0);`);
    this.addSql(`ALTER TABLE "wallet" ADD CONSTRAINT "wallet_version_positive_check" CHECK ("version" >= 1);`);

    this.addSql(`ALTER TABLE "wager_transaction"
      ADD COLUMN "round_id" varchar(120) NULL,
      ADD COLUMN "game_id" varchar(120) NULL,
      ADD COLUMN "reference_external_transaction_id" varchar(255) NULL,
      ADD COLUMN "reference_transaction_id" uuid NULL,
      ADD COLUMN "failure_code" varchar(120) NULL,
      ADD COLUMN "processed_at" timestamptz NULL,
      ADD COLUMN "reference_attempts" int NOT NULL DEFAULT 0,
      ADD COLUMN "reference_next_attempt_at" timestamptz NULL;`);
    this.addSql(`ALTER TABLE "wager_transaction" ADD CONSTRAINT "wager_transaction_amount_positive_check" CHECK ("amount" > 0);`);
    this.addSql(`ALTER TABLE "wager_transaction" ADD CONSTRAINT "wager_transaction_type_check" CHECK ("type" IN ('OPENING','BET','WIN','LOSS','REFUND','ROLLBACK'));`);
    this.addSql(`ALTER TABLE "wager_transaction" ADD CONSTRAINT "wager_transaction_status_check" CHECK ("status" IN ('PENDING','PENDING_REFERENCE','PROCESSED','REJECTED','FAILED'));`);
    this.addSql(`ALTER TABLE "wager_transaction" ADD CONSTRAINT "wager_transaction_wallet_fk" FOREIGN KEY ("wallet_id") REFERENCES "wallet" ("id") ON UPDATE CASCADE ON DELETE RESTRICT;`);
    this.addSql(`ALTER TABLE "wager_transaction" ADD CONSTRAINT "wager_transaction_reference_fk" FOREIGN KEY ("reference_transaction_id") REFERENCES "wager_transaction" ("id") ON UPDATE CASCADE ON DELETE RESTRICT;`);
    this.addSql(`CREATE INDEX "wager_transaction_wallet_created_idx" ON "wager_transaction" ("wallet_id", "created_at");`);
    this.addSql(`CREATE INDEX "wager_transaction_pending_reference_idx" ON "wager_transaction" ("reference_next_attempt_at") WHERE "status" = 'PENDING_REFERENCE';`);
    this.addSql(`CREATE UNIQUE INDEX "wager_transaction_one_reversal_per_reference_idx" ON "wager_transaction" ("reference_transaction_id") WHERE "reference_transaction_id" IS NOT NULL AND "type" IN ('REFUND','ROLLBACK');`);

    // Legacy processing could write LOSS rows to the financial ledger even though LOSS has no balance effect.
    // They are removed from the financial ledger; the corresponding WagerTransaction remains as the business audit record.
    this.addSql(`DELETE FROM "ledger_entry" WHERE "direction" = 'LOSS';`);
    this.addSql(`UPDATE "ledger_entry" SET "balance_before" = CASE WHEN "direction" = 'DEBIT' THEN "balance_after" + "amount" ELSE "balance_after" - "amount" END;`);
    // Historical versions were incremented for LOSS. Rebuild version from actual balance-changing ledger movements.
    this.addSql(`UPDATE "wallet" w SET "version" = 1 + (SELECT COUNT(*)::int FROM "ledger_entry" le WHERE le."wallet_id" = w."id");`);
    this.addSql(`ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_amount_positive_check" CHECK ("amount" > 0);`);
    this.addSql(`ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_direction_check" CHECK ("direction" IN ('CREDIT','DEBIT'));`);
    this.addSql(`ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_balance_nonnegative_check" CHECK ("balance_before" >= 0 AND "balance_after" >= 0);`);
    this.addSql(`ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_arithmetic_check" CHECK (("direction" = 'CREDIT' AND "balance_after" = "balance_before" + "amount") OR ("direction" = 'DEBIT' AND "balance_after" = "balance_before" - "amount"));`);
    this.addSql(`ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_wallet_fk" FOREIGN KEY ("wallet_id") REFERENCES "wallet" ("id") ON UPDATE CASCADE ON DELETE RESTRICT;`);
    this.addSql(`ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_transaction_fk" FOREIGN KEY ("transaction_id") REFERENCES "wager_transaction" ("id") ON UPDATE CASCADE ON DELETE RESTRICT;`);

    this.addSql(`CREATE OR REPLACE FUNCTION prevent_ledger_mutation() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'ledger_entry is immutable'; END; $$ LANGUAGE plpgsql;`);
    this.addSql(`CREATE TRIGGER "ledger_entry_immutable_trigger" BEFORE UPDATE OR DELETE ON "ledger_entry" FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();`);
    this.addSql(`CREATE TRIGGER "ledger_entry_immutable_truncate_trigger" BEFORE TRUNCATE ON "ledger_entry" FOR EACH STATEMENT EXECUTE FUNCTION prevent_ledger_mutation();`);

    this.addSql(`CREATE TABLE "inbox_message" (
      "id" uuid NOT NULL,
      "consumer_name" varchar(120) NOT NULL,
      "message_id" varchar(255) NOT NULL,
      "payload_hash" varchar(64) NOT NULL,
      "received_at" timestamptz NOT NULL,
      "processed_at" timestamptz NULL,
      CONSTRAINT "inbox_message_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "inbox_message_consumer_message_unique" UNIQUE ("consumer_name", "message_id")
    );`);
    this.addSql(`CREATE INDEX "inbox_message_processed_at_idx" ON "inbox_message" ("processed_at");`);

    this.addSql(`CREATE TABLE "outbox_message" (
      "id" uuid NOT NULL,
      "event_id" uuid NOT NULL,
      "aggregate_id" uuid NOT NULL,
      "event_type" varchar(120) NOT NULL,
      "payload" jsonb NOT NULL,
      "occurred_at" timestamptz NOT NULL,
      "attempts" int NOT NULL DEFAULT 0,
      "next_attempt_at" timestamptz NOT NULL,
      "locked_until" timestamptz NULL,
      "published_at" timestamptz NULL,
      "dead_lettered_at" timestamptz NULL,
      "last_error" varchar(2000) NULL,
      CONSTRAINT "outbox_message_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "outbox_message_event_id_unique" UNIQUE ("event_id"),
      CONSTRAINT "outbox_message_aggregate_fk" FOREIGN KEY ("aggregate_id") REFERENCES "wallet" ("id") ON UPDATE CASCADE ON DELETE RESTRICT,
      CONSTRAINT "outbox_message_attempts_check" CHECK ("attempts" >= 0)
    );`);
    this.addSql(`CREATE INDEX "outbox_message_pending_idx" ON "outbox_message" ("next_attempt_at", "occurred_at") WHERE "published_at" IS NULL AND "dead_lettered_at" IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "outbox_message";`);
    this.addSql(`DROP TABLE IF EXISTS "inbox_message";`);
    this.addSql(`DROP TRIGGER IF EXISTS "ledger_entry_immutable_truncate_trigger" ON "ledger_entry";`);
    this.addSql(`DROP TRIGGER IF EXISTS "ledger_entry_immutable_trigger" ON "ledger_entry";`);
    this.addSql(`DROP FUNCTION IF EXISTS prevent_ledger_mutation();`);
    this.addSql(`ALTER TABLE "ledger_entry" DROP CONSTRAINT IF EXISTS "ledger_entry_transaction_fk", DROP CONSTRAINT IF EXISTS "ledger_entry_wallet_fk", DROP CONSTRAINT IF EXISTS "ledger_entry_arithmetic_check", DROP CONSTRAINT IF EXISTS "ledger_entry_balance_nonnegative_check", DROP CONSTRAINT IF EXISTS "ledger_entry_direction_check", DROP CONSTRAINT IF EXISTS "ledger_entry_amount_positive_check";`);
    this.addSql(`DROP INDEX IF EXISTS "wager_transaction_wallet_created_idx";`);
    this.addSql(`DROP INDEX IF EXISTS "wager_transaction_pending_reference_idx";`);
    this.addSql(`DROP INDEX IF EXISTS "wager_transaction_one_reversal_per_reference_idx";`);
    this.addSql(`ALTER TABLE "wager_transaction" DROP CONSTRAINT IF EXISTS "wager_transaction_reference_fk", DROP CONSTRAINT IF EXISTS "wager_transaction_wallet_fk", DROP CONSTRAINT IF EXISTS "wager_transaction_status_check", DROP CONSTRAINT IF EXISTS "wager_transaction_type_check", DROP CONSTRAINT IF EXISTS "wager_transaction_amount_positive_check";`);
    this.addSql(`ALTER TABLE "wager_transaction" DROP COLUMN IF EXISTS "round_id", DROP COLUMN IF EXISTS "game_id", DROP COLUMN IF EXISTS "reference_external_transaction_id", DROP COLUMN IF EXISTS "reference_transaction_id", DROP COLUMN IF EXISTS "failure_code", DROP COLUMN IF EXISTS "processed_at", DROP COLUMN IF EXISTS "reference_attempts", DROP COLUMN IF EXISTS "reference_next_attempt_at";`);
    this.addSql(`ALTER TABLE "wallet" DROP CONSTRAINT IF EXISTS "wallet_balance_nonnegative_check", DROP CONSTRAINT IF EXISTS "wallet_version_positive_check";`);
    this.addSql(`ALTER TABLE "wallet" ALTER COLUMN "version" SET DEFAULT 0;`);
  }
}
