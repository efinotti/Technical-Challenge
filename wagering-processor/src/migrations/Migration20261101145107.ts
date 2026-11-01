
import { Migration } from '@mikro-orm/migrations';

export class Migration20261101145107 extends Migration {
  override name = 'Migration20261101145107';

  override async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "ledger_entry"
      RENAME COLUMN "type" TO "direction";
    `);

    this.addSql(`
      UPDATE "ledger_entry"
      SET "direction" = CASE
        WHEN "direction" IN ('WIN', 'CREDIT') THEN 'CREDIT'
        WHEN "direction" = 'BET' THEN 'DEBIT'
        ELSE "direction"
      END;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`
      UPDATE "ledger_entry"
      SET "direction" = CASE
        WHEN "direction" = 'CREDIT' THEN 'WIN'
        WHEN "direction" = 'DEBIT' THEN 'BET'
        ELSE "direction"
      END;
    `);

    this.addSql(`
      ALTER TABLE "ledger_entry"
      RENAME COLUMN "direction" TO "type";
    `);
  }
}
