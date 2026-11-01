import { Entity, PrimaryKey, Property, Unique, Index } from '@mikro-orm/decorators/legacy';

export type TransactionType = 'OPENING' | 'BET' | 'WIN' | 'LOSS' | 'REFUND' | 'ROLLBACK';
export type TransactionStatus = 'PENDING' | 'PENDING_REFERENCE' | 'PROCESSED' | 'REJECTED' | 'FAILED';

@Entity()
@Unique({ properties: ['providerId', 'idempotencyKey'] })
@Unique({ properties: ['providerId', 'externalTransactionId'] })
@Index({ properties: ['walletId', 'createdAt'] })
export class WagerTransaction {
  @PrimaryKey({ type: 'uuid' })
  id: string = crypto.randomUUID();

  @Property({ type: 'string' }) providerId!: string;
  @Property({ type: 'string' }) idempotencyKey!: string;
  @Property({ type: 'string', length: 64 }) payloadHash!: string;
  @Property({ type: 'string' }) externalTransactionId!: string;
  @Property({ type: 'uuid' }) walletId!: string;
  @Property({ type: 'string' }) playerId!: string;
  @Property({ type: 'string', length: 3 }) currency!: string;
  @Property({ type: 'string' }) type!: TransactionType;
  @Property({ type: 'numeric', precision: 19, scale: 2 }) amount!: string;
  @Property({ type: 'string', default: 'PENDING' }) status: TransactionStatus = 'PENDING';
  @Property({ type: 'string', nullable: true }) roundId?: string;
  @Property({ type: 'string', nullable: true }) gameId?: string;
  @Property({ type: 'string', nullable: true }) referenceExternalTransactionId?: string;
  @Property({ type: 'uuid', nullable: true }) referenceTransactionId?: string;
  @Property({ type: 'string', nullable: true }) failureCode?: string;
  @Property({ type: 'Date', nullable: true }) processedAt?: Date;
  @Property({ type: 'number', default: 0 }) referenceAttempts = 0;
  @Property({ type: 'Date', nullable: true }) referenceNextAttemptAt?: Date;
  @Property({ type: 'Date' }) createdAt = new Date();
}
