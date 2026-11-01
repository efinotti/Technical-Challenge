
import { Migration } from '@mikro-orm/migrations';

export class Migration20261101145659 extends Migration {
  override name = 'Migration20261101145659';

  override async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "wager_transaction"
      ADD COLUMN "payload_hash" varchar(64);
    `);

    this.addSql(`
      UPDATE "wager_transaction"
      SET "payload_hash" =
        md5("id"::text) || md5('legacy:' || "id"::text)
      WHERE "payload_hash" IS NULL;
    `);

    this.addSql(`
      ALTER TABLE "wager_transaction"
      ALTER COLUMN "payload_hash" SET NOT NULL;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`
      ALTER TABLE "wager_transaction"
      DROP COLUMN "payload_hash";
    `);
  }
}
