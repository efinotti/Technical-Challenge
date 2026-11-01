import { Controller, Get } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';

@Controller('ops')
export class MetricsController {
  constructor(private readonly em: EntityManager) {}

  @Get('metrics')
  async metrics() {
    const statuses = await this.em.getConnection().execute<{ status: string; total: string }>(
      `SELECT status, COUNT(*)::text AS total FROM wager_transaction GROUP BY status ORDER BY status`,
    );
    const outbox = await this.em.getConnection().execute<{ pending: string; dead_lettered: string; oldest_pending_seconds: string | null; attempts: string }>(
      `SELECT
        COUNT(*) FILTER (WHERE published_at IS NULL AND dead_lettered_at IS NULL)::text AS pending,
        COUNT(*) FILTER (WHERE dead_lettered_at IS NOT NULL)::text AS dead_lettered,
        COALESCE(EXTRACT(EPOCH FROM (now() - MIN(occurred_at) FILTER (WHERE published_at IS NULL AND dead_lettered_at IS NULL))), 0)::text AS oldest_pending_seconds,
        COALESCE(SUM(attempts), 0)::text AS attempts
       FROM outbox_message`,
    );
    const inbox = await this.em.getConnection().execute<{ processed: string; pending: string }>(
      `SELECT COUNT(*) FILTER (WHERE processed_at IS NOT NULL)::text AS processed, COUNT(*) FILTER (WHERE processed_at IS NULL)::text AS pending FROM inbox_message`,
    );
    return {
      transactionsByStatus: statuses.map((row) => ({ status: row.status, count: Number(row.total) })),
      outbox: {
        pending: Number(outbox[0]?.pending ?? 0),
        deadLettered: Number(outbox[0]?.dead_lettered ?? 0),
        oldestPendingSeconds: Number(outbox[0]?.oldest_pending_seconds ?? 0),
        publishAttempts: Number(outbox[0]?.attempts ?? 0),
      },
      inbox: { processed: Number(inbox[0]?.processed ?? 0), pending: Number(inbox[0]?.pending ?? 0) },
    };
  }
}
