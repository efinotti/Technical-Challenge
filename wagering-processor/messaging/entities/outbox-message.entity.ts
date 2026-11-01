import { Entity, PrimaryKey, Property, Index } from '@mikro-orm/decorators/legacy';

@Entity()
@Index({ properties: ['nextAttemptAt', 'occurredAt'] })
export class OutboxMessage {
  @PrimaryKey({ type: 'uuid' }) id: string = crypto.randomUUID();
  @Property({ type: 'uuid', unique: true }) eventId: string = crypto.randomUUID();
  @Property({ type: 'uuid' }) aggregateId!: string;
  @Property({ type: 'string', length: 120 }) eventType!: string;
  @Property({ type: 'json' }) payload!: Record<string, unknown>;
  @Property({ type: 'Date' }) occurredAt = new Date();
  @Property({ type: 'number', default: 0 }) attempts = 0;
  @Property({ type: 'Date' }) nextAttemptAt = new Date();
  @Property({ type: 'Date', nullable: true }) lockedUntil?: Date;
  @Property({ type: 'Date', nullable: true }) publishedAt?: Date;
  @Property({ type: 'Date', nullable: true }) deadLetteredAt?: Date;
  @Property({ type: 'string', nullable: true, length: 2000 }) lastError?: string;
}
