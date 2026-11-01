import { Migration } from '@mikro-orm/migrations';

export class Migration20261101141253 extends Migration {

  override name = 'Migration20261101141253';

  override up(): void | Promise<void> {
    this.addSql(`alter table "wager_transaction" add "external_transaction_id" varchar(255) not null, add "wallet_id" uuid not null;`);
    this.addSql(`alter table "wager_transaction" add constraint "wager_transaction_provider_id_external_transaction_id_unique" unique ("provider_id", "external_transaction_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "wager_transaction" drop constraint "wager_transaction_provider_id_external_transaction_id_unique";`);
    this.addSql(`alter table "wager_transaction" drop column "external_transaction_id", drop column "wallet_id";`);
  }

}
