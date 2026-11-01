# Architecture and decisions

## Overview

The service accepts provider transactions over HTTP or SQS, stores them in PostgreSQL, applies balance-affecting operations under a row lock on the wallet, records an immutable ledger row, and writes integration events into a transactional outbox.

## Money

- HTTP and SQS amounts are decimal strings, never JavaScript `number`.
- The `Money` value object stores integer minor units as `bigint` and serializes with two decimal places.
- PostgreSQL columns use `numeric(19,2)`.
- Currency is part of the value and mixed-currency arithmetic fails.

## Concurrency

- Every processor uses the same lock order: read a non-locking transaction probe, lock the wallet with `PESSIMISTIC_WRITE`, then lock and refresh the transaction row. This serializes all balance changes for one wallet and avoids deadlocks between a reversal and its referenced operation.
- PostgreSQL coordinates these row locks across processes and hosts; no process-local mutex is relied upon.
- The database additionally enforces `wallet.balance >= 0`, unique provider idempotency keys, unique external transaction IDs, and at most one reversal per referenced transaction.
- No process-local mutex or cache is used as a correctness guarantee.

## Idempotency

- HTTP requires `Idempotency-Key`.
- `(provider_id, idempotency_key)` and `(provider_id, external_transaction_id)` are unique in PostgreSQL.
- A canonical SHA-256 hash of the business payload differentiates replay from key reuse with changed content.
- SQS consumers persist `(consumer_name, message_id)` in the Inbox in the same database transaction as the financial effects.

## Ledger

- Every balance-changing transaction writes one ledger row in the same SQL transaction as the wallet update.
- A rejected transaction and a `LOSS` do not write a ledger row.
- Each ledger row stores direction, amount, balance before and after.
- CHECK constraints validate positive amounts, nonnegative balances and arithmetic.
- A database trigger rejects UPDATE and DELETE on ledger rows.
- `GET /wallets/:id/reconciliation` compares the materialized wallet balance with the signed sum of ledger rows.

## Reversals

- `REFUND` references a processed `BET`; `ROLLBACK` references a processed `BET`, `WIN`, or `REFUND`.
- References must match provider, player, wallet, currency and round.
- Reversal amount must equal the referenced amount.
- A partial unique index allows at most one reversal (`REFUND` or `ROLLBACK`) for a referenced transaction, preventing a BET from being refunded and separately rolled back.
- Missing references enter `PENDING_REFERENCE`, get exponential retry scheduling, and are eventually rejected with `REFERENCE_NOT_FOUND` after the configured attempt limit.

## Transactional outbox and SQS

- The transaction, wallet, ledger, Inbox (for queue input), and Outbox rows are committed together.
- The outbox publisher claims work using PostgreSQL `FOR UPDATE SKIP LOCKED` and a lease, so multiple instances can publish concurrently.
- SQS publication happens only after the outbox row is committed.
- A crash after SQS accepted a message but before `published_at` is recorded can cause a duplicate; event consumers must deduplicate using `eventId` (at-least-once delivery).
- Publisher errors retry with exponential backoff. After 12 attempts the row is marked `dead_lettered_at` for operator investigation; it is not silently deleted.
- The inbound FIFO queue has an SQS redrive policy to a FIFO DLQ after five receives. The consumer deletes/acks only after the Inbox and business transaction commit.
- On SIGTERM the poller stops and waits for in-flight handlers; a message that did not finish is left for visibility timeout/redelivery.

## Trade-offs and limitations

- The sample uses a single-currency-per-wallet model while keeping currency explicit in `Money`.
- The API accepts the operation and exposes a separate `/process` endpoint for deterministic/manual processing; queue ingestion processes within the Inbox transaction.
- The outbox publisher is at-least-once, not exactly-once. Downstream consumers must be idempotent.
- Outbox rows marked dead-lettered require operator intervention/replay; this repository provides durable status and diagnostics but does not automate a human approval workflow.
- Auth is intentionally not implemented: the challenge makes it optional and requests documenting the extension point.
- Observability uses JSON audit log records (identifiers/status only), `/health/live`, `/health/ready`, and `/ops/metrics` (durable transaction, Inbox and Outbox aggregates). Vendor-specific metrics/exporters and lock-conflict instrumentation can be extended without changing domain invariants.
