import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Message } from '@aws-sdk/client-sqs';
import { WageringService } from '../wagering/wagering.service.js';
import { SqsGateway } from './sqs-gateway.service.js';
import { OutboxPublisher } from './outbox-publisher.service.js';

@Injectable()
export class SqsConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SqsConsumerService.name);
  private timer?: ReturnType<typeof setInterval>;
  private polling = false;
  private shuttingDown = false;
  private currentPoll?: Promise<void>;
  private readonly active = new Set<Promise<void>>();

  constructor(private readonly sqs: SqsGateway, private readonly wagering: WageringService, private readonly outbox: OutboxPublisher) {}

  onModuleInit(): void {
    if (!this.sqs.enabled) this.logger.warn('SQS desabilitado; publicação/consumo pausados. O retry de referências continua ativo.');
    this.timer = setInterval(() => this.triggerPoll(), 1000);
    this.triggerPoll();
  }

  private triggerPoll(): void {
    if (this.polling || this.shuttingDown) return;
    const poll = this.poll();
    this.currentPoll = poll;
    void poll.finally(() => { if (this.currentPoll === poll) this.currentPoll = undefined; });
  }

  private async poll(): Promise<void> {
    if (this.polling || this.shuttingDown) return;
    this.polling = true;
    try {
      if (this.sqs.enabled) {
        const messages = await this.sqs.receiveRequests();
        for (const message of messages) {
          const task = this.handle(message);
          this.active.add(task);
          void task.finally(() => this.active.delete(task));
        }
        await this.outbox.publishBatch();
      }
    } catch (error) {
      this.logger.error('Falha no ciclo de polling do SQS.', error instanceof Error ? error.stack : undefined);
    } finally {
      try { await this.wagering.retryPendingReferences(); }
      catch (error) { this.logger.warn(`Falha ao reprocessar referências pendentes: ${error instanceof Error ? error.message : 'erro'}`); }
      this.polling = false;
    }
  }

  private async handle(message: Message): Promise<void> {
    try {
      const parsed = JSON.parse(message.Body ?? '') as { messageId?: string; type?: string; data?: unknown };
      await this.wagering.consumeQueueRequest({ ...parsed, messageId: parsed.messageId ?? message.MessageId ?? '' } as never);
      // Ack only after the Inbox and financial transaction have committed.
      await this.sqs.acknowledge(message);
    } catch (error) {
      this.logger.warn(`Mensagem SQS não confirmada; ficará disponível para retry: ${error instanceof Error ? error.message : 'erro desconhecido'}`);
      try { await this.sqs.retryLater(message); } catch (visibilityError) {
        this.logger.error('Não foi possível ajustar o visibility timeout.', visibilityError instanceof Error ? visibilityError.stack : undefined);
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    if (this.timer) clearInterval(this.timer);
    await this.currentPoll;
    while (this.active.size > 0) {
      await Promise.allSettled([...this.active]);
    }
  }
}
