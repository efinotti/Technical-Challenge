import { Migration } from '@mikro-orm/migrations';

export class Migration20261101133240 extends Migration {

  override name = 'Migration20261101133240';

  override up(): void | Promise<void> {
    this.addSql(`create table "wallet" ("id" uuid not null, "player_id" varchar(255) not null, "currency" varchar(3) not null, "balance" numeric(19,4) not null default '0.0000', "version" int not null default 0, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "wallet" add constraint "wallet_player_id_currency_unique" unique ("player_id", "currency");`);
  }

}
