import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { WageringController } from './wagering.controller.js';
import { WageringService } from './wagering.service.js';
import { ProviderTransactionController } from './provider-transaction.controller.js';
import { WagerTransaction } from './entities/wager-transaction.entity.js';
import { LedgerEntry } from './entities/ledger-entry.entity.js';
import { Wallet } from '../wallet/entities/wallet.entity.js';
import { InboxMessage } from '../messaging/entities/inbox-message.entity.js';
import { OutboxMessage } from '../messaging/entities/outbox-message.entity.js';

@Module({
  imports: [MikroOrmModule.forFeature([WagerTransaction, LedgerEntry, Wallet, InboxMessage, OutboxMessage])],
  controllers: [WageringController, ProviderTransactionController],
  providers: [WageringService],
  exports: [WageringService],
})
export class WageringModule {}
