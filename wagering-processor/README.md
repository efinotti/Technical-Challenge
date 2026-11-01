# Processador Distribuído de Apostas (Distributed Wagering Processor)

Aplicação desenvolvida com NestJS, Bun, TypeScript, MikroORM, PostgreSQL e AWS SQS/LocalStack.

Implementa precisão monetária, bloqueio pessimista por carteira, idempotência persistente, ledger auditável, operações de reversão, Inbox/Outbox, agendamento de novas tentativas, verificações de saúde e reconciliação financeira.

## 1. Requisitos

- Bun 1.x
- Docker Desktop com Docker Compose
- PostgreSQL 17 e LocalStack, iniciados pelo arquivo Docker Compose incluído no projeto.

## 2. Configuração e inicialização da infraestrutura

No PowerShell:

```powershell
Copy-Item .env.example .env
docker compose up -d
```

O arquivo Compose disponibiliza:

- PostgreSQL na porta `5434` do computador, mantendo a configuração anterior na porta `5433` intacta.
- LocalStack na porta `4566`.

A inicialização do LocalStack cria as seguintes filas:

- `wager-transactions.fifo`: fila de entrada das transações.
- `wager-transactions-dlq.fifo`: fila de mensagens que excederam o limite de tentativas.
- `wager-events`: fila de eventos de integração publicados pela Outbox.

O arquivo `.env` é exclusivo do ambiente local. Nunca o versione no Git nem o inclua em arquivos de compartilhamento do código-fonte.

## 3. Instalação e execução das migrations

```powershell
bun install
bun run migration:up
```

Não utilize `schema:create` ou `schema:update` em bancos de dados que já contenham dados. As alterações estruturais do banco devem ser realizadas por meio de migrations versionadas.

## 4. Execução da aplicação

Para iniciar a aplicação:

```powershell
bun run start:dev
```

Abra outras duas janelas do PowerShell para iniciar mais dois processos da API.

**Segunda janela:**

```powershell
$env:PORT = '3001'
bun run start:dev
```

**Terceira janela:**

```powershell
$env:PORT = '3002'
bun run start:dev
```

As três instâncias utilizarão o mesmo PostgreSQL e LocalStack.

Os workers são habilitados quando `SQS_ENABLED=true`.

Para executar um teste real de concorrência entre três processos, utilize:

```powershell
./scripts/distributed-race.ps1
```

Execute o script somente depois de confirmar que as três instâncias passaram nas verificações de saúde.

## 5. API

### 5.1. Criação de carteira

Endpoint:

```http
POST /wallets
```

Exemplo no PowerShell:

```powershell
$walletBody = @{
    playerId = 'player-001'
    initialBalance = @{
        amount = '100.00'
        currency = 'BRL'
    }
} | ConvertTo-Json

$wallet = Invoke-RestMethod `
    -Uri 'http://localhost:3000/wallets' `
    -Method Post `
    -ContentType 'application/json' `
    -Body $walletBody

$wallet
```

Quando o saldo inicial for maior que zero, será criada uma transação interna do tipo `OPENING`, acompanhada de um lançamento `CREDIT` correspondente no ledger.

A criação da carteira, da transação `OPENING` e do lançamento financeiro ocorre atomicamente na mesma transação SQL.

### 5.2. Criação de transação

A chave de idempotência é obrigatória no cabeçalho HTTP `Idempotency-Key`, e não no corpo JSON.

Exemplo:

```powershell
$body = @{
    providerId = 'provider-a'
    externalTransactionId = 'wager-0001'
    walletId = $wallet.id
    currency = 'BRL'
    type = 'BET'
    amount = '25.00'
    roundId = 'round-01'
    gameId = 'game-01'
} | ConvertTo-Json

$transaction = Invoke-RestMethod `
    -Uri 'http://localhost:3000/wagering/transactions' `
    -Method Post `
    -Headers @{
        'Idempotency-Key' = 'provider-a:wager-0001'
    } `
    -ContentType 'application/json' `
    -Body $body
```

### 5.3. Processamento da transação

Depois de criar uma transação, utilize seu identificador para solicitar o processamento:

```powershell
Invoke-RestMethod `
    -Uri "http://localhost:3000/wagering/transactions/$($transaction.transaction.id)/process" `
    -Method Post
```

### 5.4. Operações de reversão

As operações `REFUND` e `ROLLBACK` exigem o campo `referenceExternalTransactionId`.

A transação referenciada deve pertencer ao mesmo provedor, jogador, carteira, moeda e rodada da operação de reversão.

Quando a referência ainda não existir, a transação será mantida com o status `PENDING_REFERENCE` e submetida a novas tentativas pelo worker.

### 5.5. Consultas, reconciliação e ledger

Os seguintes endpoints estão disponíveis:

```http
GET /wallets/:id
GET /wallets/:id/ledger?limit=50&cursor=...
GET /wallets/:id/reconciliation
GET /wagering/transactions/:id
GET /health/live
GET /health/ready
GET /ops/metrics
```

O ledger é imutável no nível do banco de dados.

A reconciliação verifica se o saldo materializado da carteira corresponde à soma dos lançamentos financeiros registrados.

Divergências não são corrigidas silenciosamente: elas devem ser identificadas e reportadas.

## 6. Mensagens de entrada pelo SQS

Envie um envelope de mensagem para a fila `wager-transactions.fifo`.

Exemplo de mensagem:

```json
{
  "messageId": "provider-a-message-0001",
  "type": "WagerTransactionRequested",
  "occurredAt": "2026-11-01T16:00:00.000Z",
  "data": {
    "providerId": "provider-a",
    "idempotencyKey": "provider-a:wager-0001",
    "externalTransactionId": "wager-0001",
    "playerId": "player-001",
    "walletId": "00000000-0000-0000-0000-000000000001",
    "kind": "BET",
    "money": {
      "amount": "25.00",
      "currency": "BRL"
    },
    "roundId": "round-01",
    "gameId": "game-01"
  }
}
```

As mensagens enviadas para uma fila FIFO devem incluir o campo `MessageGroupId`.

O consumidor utiliza o registro persistente na Inbox para controlar o processamento das mensagens.

O fluxo de processamento é o seguinte:

1. Recebe a mensagem do SQS.
2. Registra a identificação da mensagem na Inbox.
3. Processa a transação e aplica as alterações financeiras na mesma transação SQL.
4. Confirma o processamento no PostgreSQL.
5. Exclui a mensagem da fila do SQS somente após o commit.

Os erros são classificados conforme sua natureza:

- **Erros de negócio:** são terminais e a mensagem é confirmada após o commit.
- **Erros transitórios de infraestrutura:** não são confirmados; o SQS poderá entregar a mensagem novamente.
- **Erros permanentes:** seguem para a DLQ conforme a política de redrive.

A configuração da fila encaminha mensagens para a DLQ após cinco recebimentos.

Esse mecanismo permite trabalhar com entrega *at-least-once*, evitando que mensagens duplicadas provoquem débitos ou créditos repetidos.
