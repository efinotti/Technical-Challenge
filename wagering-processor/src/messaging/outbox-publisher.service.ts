import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { SqsGateway } from './sqs-gateway.service.js';

type ClaimedOutboxRow = { id: string; payload: Record<string, unknown>; attempts: number };

@Injectable()
export class OutboxPublisher {
  private readonly logger = new Logger(OutboxPublisher.name);
  constructor(private readonly em: EntityManager, private readonly sqs: SqsGateway) {}

  async publishBatch(limit = 20): Promise<number> {
    if (!this.sqs.enabled) return 0;
    // Claim uses SKIP LOCKED and a lease in one atomic UPDATE. Multiple instances can run this safely.
    const rows = await this.em.getConnection().execute<ClaimedOutboxRow>(`
      WITH picked AS (
        SELECT id FROM outbox_message
        WHERE published_at IS NULL AND dead_lettered_at IS NULL
          AND next_attempt_at <= now()
          AND (locked_until IS NULL OR locked_until < now())
        ORDER BY occurred_at, id
        LIMIT ?
        FOR UPDATE SKIP LOCKED
      )
      UPDATE outbox_message o
      SET locked_until = now() + interval '60 seconds', attempts = attempts + 1
      FROM picked WHERE o.id = picked.id
      RETURNING o.id, o.payload, o.attempts
    `, [limit]);

    let published = 0;
    for (const row of rows) {
      try {
        await this.sqs.sendEvent(row.payload);
        await this.em.getConnection().execute(
          `UPDATE outbox_message SET published_at = now(), locked_until = NULL, last_error = NULL WHERE id = ?`, [row.id],
        );
        published += 1;
      } catch (error) {
        const message = (error instanceof Error ? error.message : 'SQS publish error').slice(0, 1900);
        if (row.attempts >= 12) {
          await this.em.getConnection().execute(
            `UPDATE outbox_message SET dead_lettered_at = now(), locked_until = NULL, last_error = ? WHERE id = ?`, [message, row.id],
          );
          this.logger.error(`Outbox ${row.id} foi marcada para investigação após 12 tentativas.`);
        } else {
          const delay = Math.min(900, 2 ** Math.min(row.attempts, 9));
          await this.em.getConnection().execute(
            `UPDATE outbox_message SET next_attempt_at = now() + (? * interval '1 second'), locked_until = NULL, last_error = ? WHERE id = ?`, [delay, message, row.id],
          );
        }
      }
    }
    return published;
  }
}
