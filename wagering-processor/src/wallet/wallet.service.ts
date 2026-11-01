import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager, EntityRepository, UniqueConstraintViolationException } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { createHash, randomUUID } from 'node:crypto';
import { Money } from '../domain/money.js';
import { Wallet } from './entities/wallet.entity.js';
import { WagerTransaction } from '../wagering/entities/wager-transaction.entity.js';
import { LedgerEntry } from '../wagering/entities/ledger-entry.entity.js';
import { OutboxMessage } from '../messaging/entities/outbox-message.entity.js';
import type { CreateWalletDto } from './dto/create-wallet-dto.js';

@Injectable()
export class WalletService {
  constructor(@InjectRepository(Wallet) private readonly repository: EntityRepository<Wallet>, private readonly em: EntityManager) {}

  async getWallet(id: string): Promise<Wallet> {
    const wallet = await this.repository.findOne({ id });
    if (!wallet) throw new NotFoundException('Carteira não encontrada.');
    return wallet;
  }

  async createWallet(data: CreateWalletDto): Promise<Wallet> {
    const playerId = data.playerId?.trim();
    if (!playerId) throw new BadRequestException('playerId é obrigatório.');
    let money: Money;
    try { money = Money.from(data.initialBalance); }
    catch (error) { throw new BadRequestException(error instanceof Error ? error.message : 'Saldo inválido.'); }
    if (money.isNegative()) throw new BadRequestException('Saldo inicial não pode ser negativo.');
    const now = new Date();
    try {
      const requestEm = this.em.fork({ clear: true });
      return await requestEm.transactional(async (em) => {
        const wallet = em.create(Wallet, { playerId, currency: money.currency, balance: money.toString(), version: 1, createdAt: now, updatedAt: now });
        em.persist(wallet);
        await em.flush(); // Ensure the wallet row exists before scalar-FK dependent rows are inserted.
        if (money.isPositive()) {
          const payloadHash = createHash('sha256').update(JSON.stringify({ playerId, initialBalance: money.toJSON() })).digest('hex');
          const opening = em.create(WagerTransaction, {
            providerId: 'INTERNAL',
            idempotencyKey: `OPENING:${playerId}:${money.currency}`,
            payloadHash,
            externalTransactionId: `OPENING:${playerId}:${money.currency}`,
            walletId: wallet.id,
            playerId,
            currency: money.currency,
            type: 'OPENING',
            amount: money.toString(),
            status: 'PROCESSED',
            processedAt: now,
            referenceAttempts: 0,
            createdAt: now,
            });
          em.persist(opening);
          await em.flush(); // Ensure the opening transaction exists before inserting its ledger row.
          const entry = em.create(LedgerEntry, {
            walletId: wallet.id, transactionId: opening.id, direction: 'CREDIT', amount: money.toString(),
            balanceBefore: '0.00', balanceAfter: money.toString(), createdAt: now,
          });
          const processedEventId = randomUUID();
          const balanceEventId = randomUUID();
          const processedEvent = em.create(OutboxMessage, {
            eventId: processedEventId, aggregateId: wallet.id, eventType: 'WagerTransactionProcessed',
            payload: { eventId: processedEventId, eventType: 'WagerTransactionProcessed', aggregateId: wallet.id, correlationId: opening.id, causationId: opening.id, occurredAt: now.toISOString(), version: 1, data: { transactionId: opening.id, status: 'PROCESSED', type: 'OPENING' } },
            occurredAt: now, attempts: 0, nextAttemptAt: now,
          });
          const balanceEvent = em.create(OutboxMessage, {
            eventId: balanceEventId, aggregateId: wallet.id, eventType: 'WalletBalanceChanged',
            payload: { eventId: balanceEventId, eventType: 'WalletBalanceChanged', aggregateId: wallet.id, correlationId: opening.id, causationId: opening.id, occurredAt: now.toISOString(), version: 1, data: { walletId: wallet.id, transactionId: opening.id, direction: 'CREDIT', amount: money.toJSON(), balanceBefore: { amount: '0.00', currency: money.currency }, balanceAfter: money.toJSON(), walletVersion: 1 } },
            occurredAt: now, attempts: 0, nextAttemptAt: now,
          });
          em.persist([entry, processedEvent, balanceEvent]);
        }
        await em.flush();
        return wallet;
      });
    } catch (error) {
      if (error instanceof UniqueConstraintViolationException) throw new ConflictException('Já existe uma carteira para este jogador e esta moeda.');
      throw error;
    }
  }

  async getLedger(walletId: string, limit = 50, cursor?: string) {
    await this.getWallet(walletId);
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    let cursorDate: Date | undefined;
    let cursorId: string | undefined;
    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { createdAt: string; id: string };
        cursorDate = new Date(decoded.createdAt); cursorId = decoded.id;
        if (Number.isNaN(cursorDate.getTime()) || !cursorId) throw new Error('bad cursor');
      } catch { throw new BadRequestException('Cursor inválido.'); }
    }
    const where: any = { walletId };
    if (cursorDate && cursorId) {
      where.$or = [
        { createdAt: { $lt: cursorDate } },
        { createdAt: cursorDate, id: { $lt: cursorId } },
      ];
    }
    const rows = await this.em.find(LedgerEntry, where, { orderBy: { createdAt: 'DESC', id: 'DESC' }, limit: safeLimit + 1 });
    const hasMore = rows.length > safeLimit;
    const items = rows.slice(0, safeLimit);
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last ? Buffer.from(JSON.stringify({ createdAt: last.createdAt.toISOString(), id: last.id })).toString('base64url') : null,
    };
  }

  async reconcile(walletId: string) {
    const rows = await this.em.getConnection().execute<{ wallet_balance: string; ledger_balance: string; currency: string; version: number }>(
      `SELECT w.balance::text AS wallet_balance,
        COALESCE(SUM(CASE WHEN le.direction = 'CREDIT' THEN le.amount ELSE -le.amount END), 0)::text AS ledger_balance,
        w.currency, w.version
       FROM wallet w LEFT JOIN ledger_entry le ON le.wallet_id = w.id
       WHERE w.id = ? GROUP BY w.id, w.balance, w.currency, w.version`,
      [walletId],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException('Carteira não encontrada.');
    const matches = Money.from({ amount: row.ledger_balance, currency: row.currency })
      .equals(Money.from({ amount: row.wallet_balance, currency: row.currency }));
    return { walletId, walletBalance: row.wallet_balance, ledgerBalance: row.ledger_balance, matches, version: row.version };
  }
}
