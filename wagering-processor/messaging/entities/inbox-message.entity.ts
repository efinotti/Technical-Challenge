import { Entity, PrimaryKey, Property, Unique, Index } from '@mikro-orm/decorators/legacy';

@Entity()
@Unique({ properties: ['consumerName', 'messageId'] })
@Index({ properties: ['processedAt'] })
export class InboxMessage {
  @PrimaryKey({ type: 'uuid' }) id: string = crypto.randomUUID();
  @Property({ type: 'string', length: 120 }) consumerName!: string;
  @Property({ type: 'string', length: 255 }) messageId!: string;
  @Property({ type: 'string', length: 64 }) payloadHash!: string;
  @Property({ type: 'Date' }) receivedAt = new Date();
  @Property({ type: 'Date', nullable: true }) processedAt?: Date;
}
