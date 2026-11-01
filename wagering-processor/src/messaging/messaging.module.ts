import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { WageringModule } from '../wagering/wagering.module.js';
import { InboxMessage } from './entities/inbox-message.entity.js';
import { OutboxMessage } from './entities/outbox-message.entity.js';
import { SqsGateway } from './sqs-gateway.service.js';
import { OutboxPublisher } from './outbox-publisher.service.js';
import { SqsConsumerService } from './sqs-consumer.service.js';

@Module({
  imports: [MikroOrmModule.forFeature([InboxMessage, OutboxMessage]), WageringModule],
  providers: [SqsGateway, OutboxPublisher, SqsConsumerService],
  exports: [SqsGateway, OutboxPublisher],
})
export class MessagingModule {}
