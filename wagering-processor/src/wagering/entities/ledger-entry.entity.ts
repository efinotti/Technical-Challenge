import { Entity, PrimaryKey, Property, Index, Unique } from '@mikro-orm/decorators/legacy';

@Entity()
@Index({ properties: ['walletId', 'createdAt'] })
@Unique({ properties: ['transactionId'] })
export class LedgerEntry {
  @PrimaryKey({ type: 'uuid' }) id: string = crypto.randomUUID();
  @Property({ type: 'uuid' }) walletId!: string;
  @Property({ type: 'uuid' }) transactionId!: string;
  @Property({ type: 'string' }) direction!: 'CREDIT' | 'DEBIT';
  @Property({ type: 'numeric', precision: 19, scale: 2 }) amount!: string;
  @Property({ type: 'numeric', precision: 19, scale: 2 }) balanceBefore!: string;
  @Property({ type: 'numeric', precision: 19, scale: 2 }) balanceAfter!: string;
  @Property({ type: 'Date' }) createdAt = new Date();
}
