import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager, LockMode, UniqueConstraintViolationException } from '@mikro-orm/core';
import { createHash, randomUUID } from 'node:crypto';
import { Money } from '../domain/money.js';
import { LedgerEntryDraft } from '../domain/ledger-entry.js';
import { WalletAccount } from '../domain/wallet.aggregate.js';
import { Wallet } from '../wallet/entities/wallet.entity.js';
import { LedgerEntry } from './entities/ledger-entry.entity.js';
import { WagerTransaction, type TransactionType } from './entities/wager-transaction.entity.js';
import { InboxMessage } from '../messaging/entities/inbox-message.entity.js';
import { OutboxMessage } from '../messaging/entities/outbox-message.entity.js';
import type { CreateWagerTransactionDto } from './dto/create-wager-transaction.dto.js';

const CONSUMER_NAME = 'wager-transaction-consumer';
const MAX_REFERENCE_ATTEMPTS = 10;

type QueueRequest = {
  messageId: string;
  type: 'WagerTransactionRequested';
  occurredAt?: string;
  data: {
    providerId: string; idempotencyKey: string; externalTransactionId: string;
    walletId: string; playerId?: string; roundId?: string; gameId?: string;
    type?: CreateWagerTransactionDto['type']; kind?: CreateWagerTransactionDto['type'];
    amount?: string; currency?: string; money?: { amount: string; currency: string };
    referenceExternalTransactionId?: string;
  };
};

@Injectable()
export class WageringService {
  constructor(private readonly em: EntityManager) {}

  async createTransaction(dto: CreateWagerTransactionDto, idempotencyKey: string) {
    const normalizedKey = idempotencyKey?.trim();
    if (!normalizedKey) throw new BadRequestException('O cabeçalho Idempotency-Key é obrigatório.');
    const normalized = this.normalize(dto);
    const hash = this.hashPayload(normalized);

    const requestEm = this.em.fork({ clear: true });
    const previous = await requestEm.findOne(WagerTransaction, { providerId: normalized.providerId, idempotencyKey: normalizedKey });
    if (previous) return { transaction: this.resolveReplay(previous, hash), idempotentReplay: true };

    try {
      const transaction = await requestEm.transactional(async (em) => {
        const created = await this.createPendingInTransaction(em, normalized, normalizedKey, hash);
        return created;
      });
      return { transaction, idempotentReplay: false };
    } catch (error) {
      if (!(error instanceof UniqueConstraintViolationException)) throw error;
      const freshEm = this.em.fork({ clear: true });
      const duplicateByKey = await freshEm.findOne(WagerTransaction, { providerId: normalized.providerId, idempotencyKey: normalizedKey });
      if (duplicateByKey) return { transaction: this.resolveReplay(duplicateByKey, hash), idempotentReplay: true };
      const duplicateExternal = await freshEm.findOne(WagerTransaction, { providerId: normalized.providerId, externalTransactionId: normalized.externalTransactionId });
      if (duplicateExternal) {
        if (duplicateExternal.payloadHash === hash) return { transaction: duplicateExternal, idempotentReplay: true };
        throw new ConflictException('O identificador externo já foi utilizado com outro payload.');
      }
      throw new ConflictException('Conflito de unicidade ao registrar a transação.');
    }
  }

  async getTransaction(id: string) {
    const transaction = await this.em.fork({ clear: true }).findOne(WagerTransaction, { id });
    if (!transaction) throw new NotFoundException('Transação não encontrada.');
    return transaction;
  }

  async getProviderTransaction(providerId: string, externalTransactionId: string) {
    const transaction = await this.em.fork({ clear: true }).findOne(WagerTransaction, { providerId, externalTransactionId });
    if (!transaction) throw new NotFoundException('Transação do provedor não encontrada.');
    return transaction;
  }

  async processTransaction(transactionId: string): Promise<WagerTransaction> {
    const processEm = this.em.fork({ clear: true });
    return processEm.transactional(async (em) => {
      // Lock ordering is always wallet -> transaction. This prevents a reversal from
      // holding a wallet while waiting on a reference transaction that holds the same wallet.
      const probe = await em.findOne(WagerTransaction, { id: transactionId });
      if (!probe) throw new NotFoundException('Transação não encontrada.');
      if (probe.status !== 'PENDING' && probe.status !== 'PENDING_REFERENCE') return probe;
      const wallet = await em.findOne(Wallet, { id: probe.walletId }, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true });
      if (!wallet) throw new NotFoundException('Carteira não encontrada.');
      const transaction = await em.findOne(WagerTransaction, { id: transactionId }, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true });
      if (!transaction) throw new NotFoundException('Transação não encontrada.');
      await this.applyTransaction(em, transaction, wallet);
      await em.flush();
      return transaction;
    });
  }

  /** Processes inbound SQS message with Inbox + financial effects + Outbox in one SQL transaction. */
  async consumeQueueRequest(message: QueueRequest): Promise<void> {
    if (!message?.messageId || message.type !== 'WagerTransactionRequested' || !message.data) {
      throw new BadRequestException('Mensagem SQS inválida.');
    }
    const raw = message.data;
    const idempotencyKey = raw.idempotencyKey?.trim();
    if (!idempotencyKey) throw new BadRequestException('Mensagem sem idempotencyKey.');
    const data = this.normalize({
      providerId: raw.providerId,
      externalTransactionId: raw.externalTransactionId,
      walletId: raw.walletId,
      currency: raw.currency ?? raw.money?.currency,
      type: raw.type ?? raw.kind,
      amount: raw.amount ?? raw.money?.amount,
      roundId: raw.roundId,
      gameId: raw.gameId,
      referenceExternalTransactionId: raw.referenceExternalTransactionId,
    } as CreateWagerTransactionDto);
    const payloadHash = this.hashPayload(data);
    const inboxHash = createHash('sha256').update(JSON.stringify(message)).digest('hex');

    const queueEm = this.em.fork({ clear: true });
    await queueEm.transactional(async (em) => {
      let inbox = await em.findOne(InboxMessage, { consumerName: CONSUMER_NAME, messageId: message.messageId });
      if (inbox && inbox.payloadHash !== inboxHash) {
        throw new ConflictException('O messageId foi reutilizado com payload diferente.');
      }
      if (inbox?.processedAt) return;
      if (!inbox) {
        inbox = em.create(InboxMessage, {
          consumerName: CONSUMER_NAME, messageId: message.messageId,
          payloadHash: inboxHash, receivedAt: new Date(),
        });
        em.persist(inbox);
      }

      let transaction = await em.findOne(WagerTransaction, { providerId: data.providerId, idempotencyKey });
      if (!transaction) {
        // The provider's external id is an independent durable deduplication key.
        const byExternalId = await em.findOne(WagerTransaction, {
          providerId: data.providerId, externalTransactionId: data.externalTransactionId,
        });
        if (byExternalId) {
          transaction = this.resolveReplay(byExternalId, payloadHash);
        }
      }
      if (transaction) {
        this.resolveReplay(transaction, payloadHash);
        if (raw.playerId && raw.playerId !== transaction.playerId) throw new ConflictException('playerId da mensagem não corresponde à transação existente.');
      } else {
        transaction = await this.createPendingInTransaction(em, data, idempotencyKey, payloadHash, raw.playerId);
      }
      if (transaction.status === 'PENDING' || transaction.status === 'PENDING_REFERENCE') {
        const wallet = await em.findOne(Wallet, { id: transaction.walletId }, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true });
        if (!wallet) throw new NotFoundException('Carteira não encontrada.');
        const lockedTransaction = await em.findOne(WagerTransaction, { id: transaction.id }, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true });
        if (!lockedTransaction) throw new NotFoundException('Transação não encontrada.');
        await this.applyTransaction(em, lockedTransaction, wallet);
      }
      inbox.processedAt = new Date();
      await em.flush();
    });
  }

  async retryPendingReferences(batchSize = 50): Promise<number> {
    const workerEm = this.em.fork({ clear: true });
    const candidates = await workerEm.find(WagerTransaction,
      { status: 'PENDING_REFERENCE', referenceNextAttemptAt: { $lte: new Date() } },
      { fields: ['id'], orderBy: { referenceNextAttemptAt: 'ASC' }, limit: batchSize },
    );
    let processed = 0;
    for (const candidate of candidates) {
      try { await this.processTransaction(candidate.id); processed += 1; }
      catch { /* transient DB failures are retried on the next poll */ }
    }
    return processed;
  }

  private normalize(dto: CreateWagerTransactionDto): CreateWagerTransactionDto {
    if (!dto || typeof dto !== 'object') throw new BadRequestException('Payload de transação inválido.');
    if (typeof dto.providerId !== 'string' || !dto.providerId.trim() || typeof dto.externalTransactionId !== 'string' || !dto.externalTransactionId.trim()) {
      throw new BadRequestException('providerId e externalTransactionId são obrigatórios.');
    }
    if (typeof dto.walletId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(dto.walletId)) {
      throw new BadRequestException('walletId deve ser um UUID válido.');
    }
    if (!['BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK'].includes(dto.type)) {
      throw new BadRequestException('Tipo de transação inválido ou não permitido.');
    }
    let money: Money;
    try { money = Money.from({ amount: dto.amount, currency: dto.currency }); }
    catch (error) { throw new BadRequestException(error instanceof Error ? error.message : 'Valor monetário inválido.'); }
    if (!money.isPositive()) throw new BadRequestException('O valor deve ser positivo.');
    if (dto.type === 'REFUND' || dto.type === 'ROLLBACK') {
      if (!dto.referenceExternalTransactionId?.trim()) throw new BadRequestException(`${dto.type} exige referenceExternalTransactionId.`);
    }
    return {
      ...dto,
      providerId: dto.providerId.trim(),
      externalTransactionId: dto.externalTransactionId.trim(),
      walletId: dto.walletId.toLowerCase(),
      currency: money.currency,
      amount: money.toString(),
      roundId: dto.roundId?.trim(),
      gameId: dto.gameId?.trim(),
      referenceExternalTransactionId: dto.referenceExternalTransactionId?.trim(),
    };
  }

  private hashPayload(dto: CreateWagerTransactionDto): string {
    const canonical: Record<string, string> = {
      // Preserve the original key order and fields for existing non-reference transaction hashes.
      providerId: dto.providerId,
      walletId: dto.walletId,
      currency: dto.currency,
      type: dto.type,
      amount: dto.amount,
      externalTransactionId: dto.externalTransactionId,
    };
    if (dto.roundId) canonical.roundId = dto.roundId;
    if (dto.gameId) canonical.gameId = dto.gameId;
    if (dto.referenceExternalTransactionId) canonical.referenceExternalTransactionId = dto.referenceExternalTransactionId;
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  }

  private resolveReplay(existing: WagerTransaction, requestedHash: string): WagerTransaction {
    if (existing.payloadHash !== requestedHash) {
      console.info(JSON.stringify({ event: 'idempotency_payload_conflict', transactionId: existing.id, walletId: existing.walletId, providerId: existing.providerId }));
      throw new ConflictException('A chave de idempotência já foi utilizada com outro payload.');
    }
    console.info(JSON.stringify({ event: 'idempotency_replay', transactionId: existing.id, walletId: existing.walletId, providerId: existing.providerId }));
    return existing;
  }

  private async createPendingInTransaction(em: EntityManager, dto: CreateWagerTransactionDto, idempotencyKey: string, payloadHash: string, expectedPlayerId?: string) {
    const wallet = await em.findOne(Wallet, { id: dto.walletId });
    if (!wallet) throw new NotFoundException('Carteira não encontrada.');
    if (wallet.currency !== dto.currency) throw new BadRequestException('A moeda informada não corresponde à moeda da carteira.');
    if (expectedPlayerId && wallet.playerId !== expectedPlayerId) throw new BadRequestException('playerId da mensagem não corresponde à carteira.');
    const allowedTypes: readonly string[] = [
    'BET',
    'WIN',
    'LOSS',
    'REFUND',
    'ROLLBACK',
    ];  

if (!allowedTypes.includes(dto.type)) {
  throw new BadRequestException('Tipo de transação inválido.');
}
    const transaction = em.create(WagerTransaction, {
        providerId: dto.providerId,
        idempotencyKey,
        payloadHash,
        externalTransactionId: dto.externalTransactionId,
        walletId: wallet.id,
        playerId: wallet.playerId,
        currency: dto.currency,
        type: dto.type as TransactionType,
        amount: dto.amount,
        roundId: dto.roundId,
        gameId: dto.gameId,
        referenceExternalTransactionId: dto.referenceExternalTransactionId,
        status: 'PENDING',
        referenceAttempts: 0,
        createdAt: new Date(),
});
    em.persist(transaction);
    await em.flush();
    return transaction;
  }

  private async markPendingReference(em: EntityManager, transaction: WagerTransaction): Promise<void> {
    transaction.referenceAttempts += 1;
    if (transaction.referenceAttempts >= MAX_REFERENCE_ATTEMPTS) {
      await this.reject(em, transaction, 'REFERENCE_NOT_FOUND');
      return;
    }
    const delaySeconds = Math.min(300, 2 ** transaction.referenceAttempts);
    transaction.status = 'PENDING_REFERENCE';
    transaction.referenceNextAttemptAt = new Date(Date.now() + delaySeconds * 1000);
    if (transaction.referenceAttempts === 1) {
      this.enqueueEvent(em, 'WagerTransactionPendingReference', transaction, {
        transactionId: transaction.id,
        referenceExternalTransactionId: transaction.referenceExternalTransactionId,
      });
    }
  }

  private async applyTransaction(em: EntityManager, transaction: WagerTransaction, wallet: Wallet): Promise<void> {
    if (transaction.status !== 'PENDING' && transaction.status !== 'PENDING_REFERENCE') return;
    if (wallet.currency !== transaction.currency) return this.reject(em, transaction, 'CURRENCY_MISMATCH');

    const amount = Money.from({ amount: transaction.amount, currency: transaction.currency });
    const before = Money.from({ amount: wallet.balance, currency: wallet.currency });
    let direction: 'CREDIT' | 'DEBIT' | undefined;
    let reference: WagerTransaction | null = null;

    if (transaction.type === 'LOSS') {
      transaction.status = 'PROCESSED'; transaction.processedAt = new Date();
      this.enqueueEvent(em, 'WagerTransactionProcessed', transaction, { transactionId: transaction.id, status: transaction.status, type: transaction.type });
      return;
    }
    if (transaction.type === 'BET') direction = 'DEBIT';
    else if (transaction.type === 'WIN') {
      direction = 'CREDIT';
      if (transaction.referenceExternalTransactionId) {
        reference = await em.findOne(WagerTransaction, {
          providerId: transaction.providerId,
          externalTransactionId: transaction.referenceExternalTransactionId,
        });
        if (!reference || reference.status === 'PENDING' || reference.status === 'PENDING_REFERENCE') {
          await this.markPendingReference(em, transaction);
          return;
        }
        if (reference.status !== 'PROCESSED' || reference.type !== 'BET' || reference.playerId !== transaction.playerId || reference.walletId !== transaction.walletId || reference.currency !== transaction.currency || (reference.roundId ?? null) !== (transaction.roundId ?? null)) {
          await this.reject(em, transaction, 'INVALID_WIN_REFERENCE'); return;
        }
      }
    }
    else if (transaction.type === 'REFUND' || transaction.type === 'ROLLBACK') {
      reference = await em.findOne(WagerTransaction, {
        providerId: transaction.providerId,
        externalTransactionId: transaction.referenceExternalTransactionId,
      });
      if (!reference || reference.status === 'PENDING' || reference.status === 'PENDING_REFERENCE') {
        await this.markPendingReference(em, transaction);
        return;
      }
      if (reference.status !== 'PROCESSED' || reference.playerId !== transaction.playerId || reference.walletId !== transaction.walletId || reference.currency !== transaction.currency || (reference.roundId ?? null) !== (transaction.roundId ?? null)) {
        await this.reject(em, transaction, 'INVALID_REFERENCE'); return;
      }
      if (transaction.type === 'REFUND' && reference.type !== 'BET') { await this.reject(em, transaction, 'REFUND_REQUIRES_BET'); return; }
      if (transaction.type === 'ROLLBACK' && !['BET', 'WIN', 'REFUND'].includes(reference.type)) { await this.reject(em, transaction, 'ROLLBACK_TYPE_NOT_SUPPORTED'); return; }
      if (!Money.from({ amount: reference.amount, currency: reference.currency }).equals(amount)) { await this.reject(em, transaction, 'REVERSAL_AMOUNT_MISMATCH'); return; }
      const duplicateReversal = await em.findOne(WagerTransaction, { referenceTransactionId: reference.id, type: { $in: ['REFUND', 'ROLLBACK'] } });
      if (duplicateReversal && duplicateReversal.id !== transaction.id) { await this.reject(em, transaction, 'ALREADY_REVERSED'); return; }
      const originalEntry = await em.findOne(LedgerEntry, { transactionId: reference.id });
      if (!originalEntry) { await this.reject(em, transaction, 'REFERENCE_HAS_NO_LEDGER'); return; }
      direction = originalEntry.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT';
    }

    if (!direction) { await this.reject(em, transaction, 'UNSUPPORTED_TRANSACTION_TYPE'); return; }
    if (direction === 'DEBIT' && before.isLessThan(amount)) {
      await this.reject(em, transaction, transaction.type === 'ROLLBACK' ? 'INSUFFICIENT_FUNDS_ROLLBACK' : 'INSUFFICIENT_FUNDS');
      return;
    }

    const account = WalletAccount.rehydrate({ id: wallet.id, currency: wallet.currency, balance: wallet.balance, version: wallet.version });
    const result = direction === 'CREDIT' ? account.credit(amount) : account.debit(amount);
    const after = result.movement.balanceAfter;
    const entryDraft = LedgerEntryDraft.create({ direction, amount, balanceBefore: before, balanceAfter: after });
    if (reference) transaction.referenceTransactionId = reference.id;
    wallet.balance = result.account.balance.toString(); wallet.version = result.account.version; wallet.updatedAt = new Date();
    const entry = em.create(LedgerEntry, {
      walletId: wallet.id, transactionId: transaction.id, direction,
      amount: entryDraft.amount.toString(), balanceBefore: entryDraft.balanceBefore.toString(),
      balanceAfter: entryDraft.balanceAfter.toString(), createdAt: new Date(),
    });
    em.persist(entry);
    transaction.status = 'PROCESSED'; transaction.processedAt = new Date(); transaction.referenceNextAttemptAt = undefined;
    this.enqueueEvent(em, 'WagerTransactionProcessed', transaction, { transactionId: transaction.id, status: transaction.status, type: transaction.type });
    console.info(JSON.stringify({ event: 'wager_transaction_processed', transactionId: transaction.id, walletId: wallet.id, providerId: transaction.providerId, type: transaction.type }));
    this.enqueueEvent(em, 'WalletBalanceChanged', transaction, {
      walletId: wallet.id, transactionId: transaction.id, direction,
      amount: amount.toJSON(), balanceBefore: before.toJSON(), balanceAfter: after.toJSON(), walletVersion: wallet.version,
    });
  }

  private async reject(em: EntityManager, transaction: WagerTransaction, failureCode: string) {
    transaction.status = 'REJECTED'; transaction.failureCode = failureCode; transaction.processedAt = new Date();
    transaction.referenceNextAttemptAt = undefined;
    this.enqueueEvent(em, 'WagerTransactionRejected', transaction, { transactionId: transaction.id, failureCode });
    console.info(JSON.stringify({ event: 'wager_transaction_rejected', transactionId: transaction.id, walletId: transaction.walletId, providerId: transaction.providerId, failureCode }));
  }

  private enqueueEvent(em: EntityManager, eventType: string, transaction: WagerTransaction, data: Record<string, unknown>) {
    const eventId = randomUUID();
    const occurredAt = new Date();
    const payload = {
      eventId, eventType, aggregateId: transaction.walletId,
      correlationId: transaction.id, causationId: transaction.id,
      occurredAt: occurredAt.toISOString(), version: 1, data,
    };
    em.persist(em.create(OutboxMessage, { eventId, aggregateId: transaction.walletId, eventType, payload, occurredAt, attempts: 0, nextAttemptAt: occurredAt }));
  }
}
