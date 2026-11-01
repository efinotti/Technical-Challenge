import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SQSClient, GetQueueAttributesCommand, SendMessageCommand, ReceiveMessageCommand, DeleteMessageCommand, ChangeMessageVisibilityCommand, type Message } from '@aws-sdk/client-sqs';

@Injectable()
export class SqsGateway implements OnModuleDestroy {
  private readonly client?: SQSClient;
  readonly enabled: boolean;
  readonly requestQueueUrl?: string;
  readonly eventsQueueUrl?: string;

  constructor(config: ConfigService) {
    this.enabled = config.get<string>('SQS_ENABLED') === 'true';
    this.requestQueueUrl = config.get<string>('SQS_REQUEST_QUEUE_URL');
    this.eventsQueueUrl = config.get<string>('SQS_EVENTS_QUEUE_URL');
    if (this.enabled) {
      if (!this.requestQueueUrl || !this.eventsQueueUrl) {
        throw new Error('SQS_ENABLED=true exige SQS_REQUEST_QUEUE_URL e SQS_EVENTS_QUEUE_URL.');
      }
      this.client = new SQSClient({
        region: config.get<string>('AWS_REGION') ?? 'us-east-1',
        endpoint: config.get<string>('SQS_ENDPOINT') || undefined,
        credentials: {
          accessKeyId: config.get<string>('AWS_ACCESS_KEY_ID') ?? 'test',
          secretAccessKey: config.get<string>('AWS_SECRET_ACCESS_KEY') ?? 'test',
        },
      });
    }
  }

  async sendEvent(body: Record<string, unknown>): Promise<void> {
    if (!this.enabled) return;
    if (!this.client || !this.eventsQueueUrl) throw new Error('SQS de eventos não está configurado.');
    await this.client.send(new SendMessageCommand({ QueueUrl: this.eventsQueueUrl, MessageBody: JSON.stringify(body) }));
  }

  async receiveRequests(): Promise<Message[]> {
    if (!this.enabled) return [];
    if (!this.client || !this.requestQueueUrl) throw new Error('SQS de entrada não está configurado.');
    const result = await this.client.send(new ReceiveMessageCommand({
      QueueUrl: this.requestQueueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 10,
      VisibilityTimeout: 60, MessageAttributeNames: ['All'], AttributeNames: ['ApproximateReceiveCount'],
    }));
    return result.Messages ?? [];
  }

  async acknowledge(message: Message): Promise<void> {
    if (!this.client || !this.requestQueueUrl || !message.ReceiptHandle) return;
    await this.client.send(new DeleteMessageCommand({ QueueUrl: this.requestQueueUrl, ReceiptHandle: message.ReceiptHandle }));
  }

  async retryLater(message: Message): Promise<void> {
    if (!this.client || !this.requestQueueUrl || !message.ReceiptHandle) return;
    const receives = Number(message.Attributes?.ApproximateReceiveCount ?? '1');
    const delay = Math.min(900, 2 ** Math.min(Math.max(receives, 1), 9));
    await this.client.send(new ChangeMessageVisibilityCommand({ QueueUrl: this.requestQueueUrl, ReceiptHandle: message.ReceiptHandle, VisibilityTimeout: delay }));
  }

  async checkConnection(): Promise<boolean> {
    if (!this.enabled) return true;
    if (!this.client) return false;
    try {
      if (this.requestQueueUrl) await this.client.send(new GetQueueAttributesCommand({ QueueUrl: this.requestQueueUrl, AttributeNames: ['QueueArn'] }));
      if (this.eventsQueueUrl) await this.client.send(new GetQueueAttributesCommand({ QueueUrl: this.eventsQueueUrl, AttributeNames: ['QueueArn'] }));
      return Boolean(this.requestQueueUrl && this.eventsQueueUrl);
    } catch { return false; }
  }

  async onModuleDestroy(): Promise<void> { await this.client?.destroy(); }
}
