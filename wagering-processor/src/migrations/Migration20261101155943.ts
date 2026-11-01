import { Migration } from '@mikro-orm/migrations';

export class Migration20261101155943 extends Migration {

  override name = 'Migration20261101155943';

  override up(): void | Promise<void> {
    this.addSql(`alter table "ledger_entry" alter column "amount" type numeric(19,2) using ("amount"::numeric(19,2));`);
    this.addSql(`alter table "ledger_entry" alter column "balance_after" type numeric(19,2) using ("balance_after"::numeric(19,2));`);
    this.addSql(`alter table "ledger_entry" alter column "balance_before" type numeric(19,2) using ("balance_before"::numeric(19,2));`);

    this.addSql(`alter table "wager_transaction" alter column "amount" type numeric(19,2) using ("amount"::numeric(19,2));`);

    this.addSql(`alter table "wallet" alter column "balance" type numeric(19,2) using ("balance"::numeric(19,2));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "ledger_entry" alter column "amount" type numeric(19,4) using ("amount"::numeric(19,4));`);
    this.addSql(`alter table "ledger_entry" alter column "balance_before" type numeric(19,4) using ("balance_before"::numeric(19,4));`);
    this.addSql(`alter table "ledger_entry" alter column "balance_after" type numeric(19,4) using ("balance_after"::numeric(19,4));`);

    this.addSql(`alter table "wager_transaction" alter column "amount" type numeric(19,4) using ("amount"::numeric(19,4));`);

    this.addSql(`alter table "wallet" alter column "balance" type numeric(19,4) using ("balance"::numeric(19,4));`);
  }

}
