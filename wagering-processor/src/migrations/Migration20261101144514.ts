import { Migration } from '@mikro-orm/migrations';

export class Migration20261101144514 extends Migration {

  override name = 'Migration20261101144514';

  
override up(): void | Promise<void> {
  this.addSql(`
    alter table "ledger_entry"
    add column "balance_before" numeric(19,4);
  `);

  this.addSql(`
    update "ledger_entry"
    set "balance_before" = "balance_after" - "amount";
  `);

  this.addSql(`
    alter table "ledger_entry"
    alter column "balance_before" set not null;
  `);

  this.addSql(`
    alter table "ledger_entry"
    add constraint "ledger_entry_transaction_id_unique"
    unique ("transaction_id");
  `);
}


  override down(): void | Promise<void> {
    this.addSql(`alter table "ledger_entry" drop constraint "ledger_entry_transaction_id_unique";`);
    this.addSql(`alter table "ledger_entry" drop column "balance_before";`);
  }

}
