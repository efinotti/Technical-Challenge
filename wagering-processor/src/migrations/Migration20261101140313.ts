import { Migration } from '@mikro-orm/migrations';

export class Migration20261101140313 extends Migration {

  override name = 'Migration20261101140313';

  override up(): void | Promise<void> {
    this.addSql(`create table "ledger_entry" ("id" uuid not null, "wallet_id" uuid not null, "transaction_id" uuid not null, "type" varchar(255) not null, "amount" numeric(19,4) not null, "balance_after" numeric(19,4) not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "ledger_entry_wallet_id_created_at_index" on "ledger_entry" ("wallet_id", "created_at");`);

    this.addSql(`create table "wager_transaction" ("id" uuid not null, "provider_id" varchar(255) not null, "idempotency_key" varchar(255) not null, "player_id" varchar(255) not null, "currency" varchar(3) not null, "type" varchar(255) not null, "amount" numeric(19,4) not null, "status" varchar(255) not null default 'PENDING', "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "wager_transaction" add constraint "wager_transaction_provider_id_idempotency_key_unique" unique ("provider_id", "idempotency_key");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "ledger_entry" cascade;`);
    this.addSql(`drop table if exists "wager_transaction" cascade;`);
  }

}
